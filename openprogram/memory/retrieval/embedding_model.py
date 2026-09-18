"""Lightweight lifecycle checks for the fixed local embedding model."""

from __future__ import annotations

import platform
import sys
from pathlib import Path


MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_FILES = (
    "1_Pooling/config.json",
    "config.json",
    "config_sentence_transformers.json",
    "modules.json",
    "model.safetensors",
    "sentence_bert_config.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
)

_INTEL_MACOS_UNAVAILABLE = (
    "semantic memory embeddings are unavailable on Intel macOS because no "
    "patched PyPI torch wheel is available; use BM25 on Intel macOS or run "
    "embeddings on macOS arm64/Linux"
)


def platform_unavailable_reason() -> str | None:
    """Return the embedding platform limitation, or ``None`` if supported."""
    if sys.platform == "darwin" and platform.machine() == "x86_64":
        return _INTEL_MACOS_UNAVAILABLE
    return None


def _snapshot_is_complete(snapshot: str | Path) -> bool:
    root = Path(snapshot)
    return all(
        (root / relative).is_file() and (root / relative).stat().st_size > 0
        for relative in MODEL_FILES
    )


def default_model_is_cached() -> bool:
    """Whether every required file exists without loading model code."""
    if platform_unavailable_reason() is not None:
        return False
    try:
        from huggingface_hub import snapshot_download

        snapshot = snapshot_download(
            MODEL_ID,
            allow_patterns=MODEL_FILES,
            local_files_only=True,
        )
        return _snapshot_is_complete(snapshot)
    except Exception:
        return False


def install_default_model() -> None:
    """Download and verify the fixed encoder snapshot."""
    reason = platform_unavailable_reason()
    if reason is not None:
        raise RuntimeError(reason)
    from huggingface_hub import snapshot_download

    snapshot = snapshot_download(MODEL_ID, allow_patterns=MODEL_FILES)
    if not _snapshot_is_complete(snapshot):
        raise OSError("Embedding model download is incomplete")
