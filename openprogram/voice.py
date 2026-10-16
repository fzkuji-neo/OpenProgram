"""Speech to text for the composer's voice input.

The browser records 16 kHz mono WAV, cuts it at pauses and posts each
phrase to ``POST /api/voice/transcribe``; this module turns one phrase
into text with the engine chosen in Settings → Voice.

Engines (one function each, same signature):

* ``openai`` — ``/v1/audio/transcriptions`` with the OpenAI provider key.
* ``groq``   — Groq's OpenAI-compatible transcription endpoint (Whisper).
* ``local``  — whisper.cpp's ``whisper-cli`` on this computer. Audio never
  leaves the machine. The ggml model is downloaded into the state
  directory on first use.

``auto`` picks a local engine whose model is already downloaded, then
OpenAI, then Groq, then a local engine that still has to download.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

ENGINES = ("openai", "groq", "local")
LANGUAGES = ("auto", "zh", "en", "ja", "ko", "fr", "de", "es")

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini-transcribe",
    "groq": "whisper-large-v3-turbo",
    "local": "large-v3-turbo-q5_0",
}

_API_BASES = {
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
}

# One phrase is a few seconds; a 10-minute cap keeps a stuck recording
# from posting hundreds of megabytes.
MAX_AUDIO_BYTES = 20 * 1024 * 1024

# Whisper writes Chinese in traditional characters unless the context
# leans simplified; a short prompt in the target script fixes that.
_LANGUAGE_PROMPTS = {"zh": "以下是普通话的句子，使用简体中文。"}

_LOCAL_CLI_NAMES = ("whisper-cli", "whisper-cpp")
_LOCAL_CLI_DIRS = ("/opt/homebrew/bin", "/usr/local/bin")
_MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin"


class VoiceError(RuntimeError):
    """A failure the composer shows to the user as is."""


@dataclass(frozen=True)
class VoiceSettings:
    engine: str = "auto"
    language: str = "auto"
    model: str = ""


def model_for(engine: str, settings: VoiceSettings) -> str:
    """The model override applies only to the engine it was chosen for."""
    if settings.engine == engine and settings.model:
        return settings.model
    return DEFAULT_MODELS[engine]


def read_settings() -> VoiceSettings:
    try:
        from openprogram.setup import _read_config
        cfg = (_read_config().get("voice") or {})
    except Exception:
        cfg = {}
    engine = cfg.get("engine") if cfg.get("engine") in ("auto", *ENGINES) else "auto"
    language = cfg.get("language") if cfg.get("language") in LANGUAGES else "auto"
    model = cfg.get("model") if isinstance(cfg.get("model"), str) else ""
    return VoiceSettings(engine=engine, language=language, model=model.strip())


# ---------------------------------------------------------------- engines


def _provider_key(provider_id: str) -> str | None:
    try:
        from openprogram.providers.env_api_keys import resolve_provider_key
        return resolve_provider_key(provider_id)
    except Exception:
        return None


def local_cli() -> str | None:
    """Path of whisper.cpp's command-line tool, or None."""
    for name in _LOCAL_CLI_NAMES:
        found = shutil.which(name)
        if found:
            return found
        for folder in _LOCAL_CLI_DIRS:
            candidate = Path(folder) / name
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def local_model_path(model: str) -> Path:
    from openprogram.paths import get_state_dir
    return get_state_dir() / "voice" / "models" / f"ggml-{model}.bin"


def _download_local_model(model: str) -> Path:
    import httpx

    target = local_model_path(model)
    if target.is_file() and target.stat().st_size > 0:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".part")
    try:
        with httpx.stream("GET", _MODEL_URL.format(model=model),
                          follow_redirects=True, timeout=120) as response:
            if response.status_code != 200:
                raise VoiceError(f"Could not download the Whisper model {model} "
                                 f"(HTTP {response.status_code}).")
            with partial.open("wb") as fh:
                for chunk in response.iter_bytes(1 << 20):
                    fh.write(chunk)
        partial.replace(target)
    except httpx.HTTPError as exc:
        raise VoiceError(f"Could not download the Whisper model {model}: {exc}") from exc
    finally:
        partial.unlink(missing_ok=True)
    return target


def _transcribe_local(audio: bytes, *, model: str, language: str) -> str:
    cli = local_cli()
    if not cli:
        raise VoiceError("whisper.cpp is not installed. Install it with "
                         "`brew install whisper-cpp`, or pick another engine in Settings → Voice.")
    model_file = _download_local_model(model)
    with tempfile.TemporaryDirectory(prefix="openprogram-voice-") as tmp:
        wav = Path(tmp) / "phrase.wav"
        wav.write_bytes(audio)
        argv = [cli, "-m", str(model_file), "-f", str(wav), "-nt", "-np",
                "-l", language]
        if language in _LANGUAGE_PROMPTS:
            argv += ["--prompt", _LANGUAGE_PROMPTS[language]]
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired as exc:
            raise VoiceError("Local transcription took longer than 5 minutes.") from exc
    if done.returncode != 0:
        tail = (done.stderr or done.stdout).strip().splitlines()[-1:] or ["no output"]
        raise VoiceError(f"whisper.cpp failed: {tail[0]}")
    return " ".join(line.strip() for line in done.stdout.splitlines() if line.strip())


def _transcribe_http(engine: str, audio: bytes, *, model: str, language: str) -> str:
    import httpx

    key = _provider_key(engine)
    if not key:
        name = "OpenAI" if engine == "openai" else "Groq"
        raise VoiceError(f"No {name} API key. Add one in Settings → Providers, "
                         "or pick another engine in Settings → Voice.")
    data: dict[str, Any] = {"model": model, "response_format": "json"}
    if language != "auto":
        data["language"] = language
    if language in _LANGUAGE_PROMPTS:
        data["prompt"] = _LANGUAGE_PROMPTS[language]
    try:
        response = httpx.post(
            f"{_API_BASES[engine]}/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            data=data,
            files={"file": ("phrase.wav", audio, "audio/wav")},
            timeout=120,
        )
    except httpx.HTTPError as exc:
        raise VoiceError(f"Transcription request failed: {exc}") from exc
    if response.status_code != 200:
        try:
            detail = response.json().get("error", {}).get("message") or response.text
        except Exception:
            detail = response.text
        raise VoiceError(f"Transcription failed (HTTP {response.status_code}): {detail[:300]}")
    return str(response.json().get("text") or "").strip()


_RUNNERS: dict[str, Callable[..., str]] = {
    "openai": lambda audio, **kw: _transcribe_http("openai", audio, **kw),
    "groq": lambda audio, **kw: _transcribe_http("groq", audio, **kw),
    "local": _transcribe_local,
}


# ---------------------------------------------------------------- selection


def engine_status(settings: VoiceSettings | None = None) -> list[dict[str, Any]]:
    """Per-engine availability, in the order ``auto`` tries them."""
    settings = settings or read_settings()
    cli = local_cli()
    local_model = model_for("local", settings)
    model_ready = local_model_path(local_model).is_file()
    return [
        {"id": "openai", "available": bool(_provider_key("openai")),
         "detail": "API key set" if _provider_key("openai") else "no API key"},
        {"id": "groq", "available": bool(_provider_key("groq")),
         "detail": "API key set" if _provider_key("groq") else "no API key"},
        {"id": "local", "available": bool(cli),
         "detail": ("model ready" if model_ready else f"downloads ggml-{local_model}.bin on first use")
         if cli else "whisper.cpp not installed", "model_ready": model_ready},
    ]


def resolve_engine(settings: VoiceSettings | None = None) -> str | None:
    settings = settings or read_settings()
    if settings.engine != "auto":
        return settings.engine
    status = {row["id"]: row for row in engine_status(settings)}
    if status["local"]["available"] and status["local"]["model_ready"]:
        return "local"
    for engine in ("openai", "groq", "local"):
        if status[engine]["available"]:
            return engine
    return None


def status() -> dict[str, Any]:
    settings = read_settings()
    engine = resolve_engine(settings)
    return {
        "engine": settings.engine,
        "language": settings.language,
        "model": settings.model,
        "resolved_engine": engine,
        "resolved_model": model_for(engine, settings) if engine else "",
        "engines": engine_status(settings),
        "default_models": DEFAULT_MODELS,
    }


def transcribe(audio: bytes) -> dict[str, str]:
    """Text of one recorded phrase, with the engine and model that made it."""
    if not audio:
        return {"text": "", "engine": "", "model": ""}
    if len(audio) > MAX_AUDIO_BYTES:
        raise VoiceError("The recording is too long to transcribe in one piece.")
    settings = read_settings()
    engine = resolve_engine(settings)
    if engine is None:
        raise VoiceError("No speech engine is set up. Add an OpenAI or Groq key in "
                         "Settings → Providers, or install whisper.cpp.")
    model = model_for(engine, settings)
    text = _RUNNERS[engine](audio, model=model, language=settings.language)
    return {"text": text, "engine": engine, "model": model}
