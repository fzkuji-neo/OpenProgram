"""Text read off a screenshot, for windows whose Accessibility tree shows little.

Games, canvas editors, remote desktops and some Electron apps draw their
content without exposing it to Accessibility. Their screenshot still has
the words on it: Vision's text recognizer reads them with a box each, and
the box centre is a coordinate an action can click.
"""
from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import threading
from typing import Any

from .tree import _BIDI_MARKS

MAX_LINES = 150
MAX_LINE_CHARS = 200


@dataclass(frozen=True)
class TextBox:
    """One recognized line, in pixels of the screenshot it was read from."""
    text: str
    x: float
    y: float
    width: float
    height: float

    @property
    def center(self) -> tuple[int, int]:
        return int(round(self.x + self.width / 2)), int(round(self.y + self.height / 2))

    def line(self) -> str:
        cx, cy = self.center
        text = self.text if len(self.text) <= MAX_LINE_CHARS else self.text[:MAX_LINE_CHARS - 1] + "…"
        return f'"{text}" at ({cx}, {cy}), {int(round(self.width))}x{int(round(self.height))}'


def available() -> bool:
    return importlib.util.find_spec("Vision") is not None


def boxes_from_normalized(found: list[tuple[str, tuple[float, float, float, float]]],
                          width: float, height: float) -> list[TextBox]:
    """Vision boxes (0..1, origin bottom-left) as screenshot pixels, top to bottom, left to right."""
    out = []
    for text, (nx, ny, nw, nh) in found:
        text = " ".join(_BIDI_MARKS.sub("", str(text)).split())
        if not text:
            continue
        out.append(TextBox(text, *(round(v, 1) for v in (
            nx * width, (1.0 - ny - nh) * height, nw * width, nh * height))))
    # Rows first (a line is "the same row" within half its height), then left to right.
    out.sort(key=lambda b: (round((b.y + b.height / 2) / max(b.height, 1.0) * 2), b.x))
    return out


def render(boxes: list[TextBox]) -> str:
    lines = [b.line() for b in boxes[:MAX_LINES]]
    if len(boxes) > MAX_LINES:
        lines.append(f"…and {len(boxes) - MAX_LINES} more lines; zoom into a region to read them.")
    return "\n".join(lines)


def matching(boxes: list[TextBox], text: str) -> list[TextBox]:
    needle = " ".join(str(text or "").split()).lower()
    return [b for b in boxes if needle and needle in b.text.lower()]


_lock = threading.Lock()
_languages: list[str] | None = None


# Screens mix scripts whatever the system language is. The first language picks
# the model, so the list is only a hint: language detection chooses per image.
_DEFAULT_LANGUAGES = ("zh-Hans", "zh-Hant", "ja-JP", "ko-KR", "en-US")


def _recognition_languages(request) -> list[str]:
    """The user's preferred languages Vision can read, then Chinese, Japanese, Korean and English."""
    global _languages
    if _languages is None:
        import Foundation
        supported, _ = request.supportedRecognitionLanguagesAndReturnError_(None)
        _languages = pick_languages([str(p) for p in Foundation.NSLocale.preferredLanguages() or []],
                                    [str(s) for s in supported or []])
    return _languages


def pick_languages(preferred: list[str], supported: list[str]) -> list[str]:
    wanted: list[str] = []
    for tag in [*preferred, *_DEFAULT_LANGUAGES]:
        base = tag.split("-")[0]
        if base == "zh" and tag not in _DEFAULT_LANGUAGES:
            tag = "zh-Hant" if any(mark in tag for mark in ("Hant", "TW", "HK", "MO")) else "zh-Hans"
        match = tag if tag in supported else next((s for s in supported if s.split("-")[0] == base), "")
        if match and match not in wanted:
            wanted.append(match)
    return wanted or ["en-US"]


def recognize(png: bytes, width: float, height: float) -> list[TextBox]:
    """Lines of text in a PNG ``width`` x ``height`` pixels; empty when Vision is missing."""
    if not png or not available():
        return []
    import Foundation
    import Vision

    with _lock:
        data = Foundation.NSData.dataWithBytes_length_(png, len(png))
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, {})
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setUsesLanguageCorrection_(True)
        request.setRecognitionLanguages_(_recognition_languages(request))
        if request.respondsToSelector_(b"setAutomaticallyDetectsLanguage:"):
            request.setAutomaticallyDetectsLanguage_(True)
        ok, _error = handler.performRequests_error_([request], None)
        if not ok:
            return []
        found: list[tuple[str, Any]] = []
        for observation in request.results() or []:
            candidates = observation.topCandidates_(1)
            if not candidates:
                continue
            box = observation.boundingBox()
            found.append((str(candidates[0].string()),
                          (box.origin.x, box.origin.y, box.size.width, box.size.height)))
    return boxes_from_normalized(found, width, height)


__all__ = ["MAX_LINES", "TextBox", "available", "boxes_from_normalized", "matching", "pick_languages", "recognize", "render"]
