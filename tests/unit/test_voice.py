"""Speech to text for composer voice input (openprogram.voice)."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openprogram import voice


def _cfg(**values):
    return {"voice": values}


@pytest.fixture
def no_local(monkeypatch):
    monkeypatch.setattr(voice, "local_cli", lambda: None)


def test_settings_fall_back_to_auto_for_unknown_values():
    with patch("openprogram.setup._read_config", return_value=_cfg(engine="nope", language="xx", model=3)):
        settings = voice.read_settings()
    assert settings == voice.VoiceSettings("auto", "auto", "")


def test_auto_prefers_openai_then_groq(monkeypatch, no_local):
    keys = {"openai": "sk-a", "groq": "gk"}
    monkeypatch.setattr(voice, "_provider_key", keys.get)
    with patch("openprogram.setup._read_config", return_value={}):
        assert voice.resolve_engine() == "openai"
        keys.pop("openai")
        assert voice.resolve_engine() == "groq"
        keys.pop("groq")
        assert voice.resolve_engine() is None


def test_auto_prefers_a_local_model_that_is_already_downloaded(monkeypatch, tmp_path):
    monkeypatch.setattr(voice, "_provider_key", lambda _: "sk")
    monkeypatch.setattr(voice, "local_cli", lambda: "/usr/bin/whisper-cli")
    model = tmp_path / "ggml-base.bin"
    monkeypatch.setattr(voice, "local_model_path", lambda name: model)
    with patch("openprogram.setup._read_config", return_value={}):
        assert voice.resolve_engine() == "openai"
        model.write_bytes(b"x")
        assert voice.resolve_engine() == "local"


def test_model_override_applies_only_to_its_engine():
    chosen = voice.VoiceSettings(engine="groq", model="distil-whisper")
    assert voice.model_for("groq", chosen) == "distil-whisper"
    assert voice.model_for("openai", chosen) == voice.DEFAULT_MODELS["openai"]
    assert voice.model_for("openai", voice.VoiceSettings(model="x")) == voice.DEFAULT_MODELS["openai"]


def test_transcribe_posts_wav_to_the_openai_endpoint(monkeypatch, no_local):
    monkeypatch.setattr(voice, "_provider_key", lambda pid: "sk-test" if pid == "openai" else None)
    sent = {}

    class Response:
        status_code = 200

        def json(self):
            return {"text": " 你好 "}

    def fake_post(url, *, headers, data, files, timeout):
        sent.update(url=url, headers=headers, data=data, files=files)
        return Response()

    monkeypatch.setattr("httpx.post", fake_post)
    with patch("openprogram.setup._read_config", return_value=_cfg(language="zh")):
        result = voice.transcribe(b"RIFF....")
    assert result == {"text": "你好", "engine": "openai", "model": "gpt-4o-mini-transcribe"}
    assert sent["url"] == "https://api.openai.com/v1/audio/transcriptions"
    assert sent["headers"]["Authorization"] == "Bearer sk-test"
    assert sent["data"] == {"model": "gpt-4o-mini-transcribe", "response_format": "json", "language": "zh"}
    assert sent["files"]["file"][2] == "audio/wav"


def test_transcribe_without_any_engine_explains_the_fix(monkeypatch, no_local):
    monkeypatch.setattr(voice, "_provider_key", lambda _: None)
    with patch("openprogram.setup._read_config", return_value={}):
        with pytest.raises(voice.VoiceError, match="Settings"):
            voice.transcribe(b"RIFF")


def test_empty_audio_is_empty_text():
    assert voice.transcribe(b"")["text"] == ""


def test_routes_report_status_and_errors(monkeypatch, no_local):
    from openprogram.webui.routes.settings import voice as routes

    app = FastAPI()
    routes.register(app)
    client = TestClient(app)
    monkeypatch.setattr(voice, "_provider_key", lambda _: None)
    with patch("openprogram.setup._read_config", return_value={}):
        status = client.get("/api/voice/status").json()
        assert status["resolved_engine"] is None
        assert [row["id"] for row in status["engines"]] == ["openai", "groq", "local"]
        failed = client.post("/api/voice/transcribe", content=b"RIFF", headers={"Content-Type": "audio/wav"})
    assert failed.status_code == 422
    assert "Settings" in failed.json()["error"]

    monkeypatch.setattr(voice, "transcribe", lambda audio: {"text": "hi", "engine": "openai", "model": "m"})
    ok = client.post("/api/voice/transcribe", content=b"RIFF", headers={"Content-Type": "audio/wav"})
    assert ok.json()["text"] == "hi"
