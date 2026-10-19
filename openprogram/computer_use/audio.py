"""Record the sound one application plays, in the background.

ScreenCaptureKit captures an application's audio without capturing its
pixels for anyone and without touching the output device: the user keeps
hearing what they hear, and nothing else on the computer is recorded.
The stream asks for 16 kHz mono float samples, which is what speech
recognition wants, and is turned into a 16-bit WAV when it stops.
"""
from __future__ import annotations

import contextlib
from array import array
from dataclasses import dataclass, field
import io
import struct
import threading
import time
from typing import Any, Callable

SAMPLE_RATE = 16_000
DEFAULT_SECONDS = 60.0
MAX_SECONDS = 300.0
# Below this peak the recording is treated as silence (about -80 dBFS).
SILENCE_PEAK = 1e-4


def seconds(value: Any) -> float:
    """The recording limit: 60 seconds by default, at most 300."""
    if value in (None, ""):
        return DEFAULT_SECONDS
    try:
        limit = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("max_duration must be a number of seconds") from exc
    if not 0 < limit <= MAX_SECONDS:
        raise ValueError(f"max_duration must be between 0 and {MAX_SECONDS:g} seconds")
    return limit


def wav(samples: bytes, rate: int = SAMPLE_RATE) -> tuple[bytes, float]:
    """16-bit mono WAV of native float32 ``samples``, and the peak level (0..1)."""
    floats = array("f")
    floats.frombytes(samples[: len(samples) - len(samples) % 4])
    peak = 0.0
    ints = array("h", bytes(2 * len(floats)))
    for i, value in enumerate(floats):
        value = -1.0 if value < -1.0 else 1.0 if value > 1.0 else value
        if value > peak:
            peak = value
        elif -value > peak:
            peak = -value
        ints[i] = int(value * 32767)
    if ints.itemsize != 2 or struct.pack("=h", 1) != struct.pack("<h", 1):
        ints.byteswap()
    data = ints.tobytes()
    out = io.BytesIO()
    out.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE")
    out.write(b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16))
    out.write(b"data" + struct.pack("<I", len(data)) + data)
    return out.getvalue(), peak


@dataclass
class Recording:
    """One running capture of one application's sound."""
    app: str
    pid: int
    limit: float
    started: float = field(default_factory=time.monotonic)
    stream: Any = None
    output: Any = None
    timer: threading.Timer | None = None
    chunks: list[bytes] = field(default_factory=list)
    frames: int = 0
    stopped: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def take(self, data: bytes) -> None:
        """Keep samples up to the limit; later ones are dropped."""
        with self.lock:
            room = int(self.limit * SAMPLE_RATE) - self.frames
            if self.stopped or room <= 0:
                return
            data = data[: room * 4]
            self.chunks.append(data)
            self.frames += len(data) // 4

    @property
    def seconds(self) -> float:
        return self.frames / SAMPLE_RATE


def _wait(start: Callable, timeout: float = 8.0):
    """Run a call that reports through a completion handler: (value, error) or (error)."""
    done, box = threading.Event(), []

    def callback(*args):
        box.extend(args)
        done.set()

    start(callback)
    if not done.wait(timeout):
        raise RuntimeError("the audio capture did not answer in time")
    value, error = (box[0], box[1]) if len(box) == 2 else (None, box[0] if box else None)
    if error is not None:
        raise RuntimeError(str(error))
    return value


_output_class = None


def _output(sc, appkit, cm, sink: Callable[[bytes], None]):
    """An SCStreamOutput that hands each audio buffer's bytes to ``sink``."""
    global _output_class
    if _output_class is None:
        import objc

        class _AudioOutput(appkit.NSObject, protocols=[objc.protocolNamed("SCStreamOutput")]):
            def stream_didOutputSampleBuffer_ofType_(self, stream, buffer, kind):
                if kind != sc.SCStreamOutputTypeAudio:
                    return
                block = cm.CMSampleBufferGetDataBuffer(buffer)
                if block is None:
                    return
                length = cm.CMBlockBufferGetDataLength(block)
                status, data = cm.CMBlockBufferCopyDataBytes(block, 0, length, None)
                if status == 0 and data:
                    self.sink(bytes(data))

        _output_class = _AudioOutput
    output = _output_class.alloc().init()
    output.sink = sink
    return output


def start(pid: int, app: str, limit: float) -> Recording:
    """Begin capturing what ``pid`` plays, for at most ``limit`` seconds."""
    import AppKit as appkit
    import CoreMedia as cm
    import ScreenCaptureKit as sc

    content = _wait(lambda cb: sc.SCShareableContent
                   .getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler_(True, False, cb))
    target = next((a for a in content.applications() if int(a.processID()) == pid), None)
    if target is None:
        raise RuntimeError(f"{app} has no audio ScreenCaptureKit can capture; it needs a window")
    displays = list(content.displays())
    if not displays:
        raise RuntimeError("no display to attach the audio capture to")
    content_filter = sc.SCContentFilter.alloc().initWithDisplay_includingApplications_exceptingWindows_(
        displays[0], [target], [])
    config = sc.SCStreamConfiguration.alloc().init()
    config.setCapturesAudio_(True)
    config.setSampleRate_(SAMPLE_RATE)
    config.setChannelCount_(1)
    config.setExcludesCurrentProcessAudio_(True)
    # Audio only: the smallest frame, once a second, with no screen output attached.
    config.setWidth_(2)
    config.setHeight_(2)
    config.setMinimumFrameInterval_(cm.CMTimeMake(1, 1))
    config.setShowsCursor_(False)
    recording = Recording(app=app, pid=pid, limit=limit)
    recording.output = _output(sc, appkit, cm, recording.take)
    stream = sc.SCStream.alloc().initWithFilter_configuration_delegate_(content_filter, config, None)
    added, error = stream.addStreamOutput_type_sampleHandlerQueue_error_(
        recording.output, sc.SCStreamOutputTypeAudio, None, None)
    if not added:
        raise RuntimeError(f"audio capture could not start: {error}")
    _wait(lambda cb: stream.startCaptureWithCompletionHandler_(cb))
    recording.stream = stream
    recording.started = time.monotonic()
    # Release the capture at the limit even if stop is never called.
    recording.timer = threading.Timer(limit + 0.5, lambda: halt(recording))
    recording.timer.daemon = True
    recording.timer.start()
    return recording


def halt(recording: Recording) -> None:
    """Stop the stream; samples taken so far are kept."""
    with recording.lock:
        if recording.stopped:
            return
        recording.stopped = True
    if recording.timer is not None:
        recording.timer.cancel()
    stream, recording.stream = recording.stream, None
    if stream is not None:
        with contextlib.suppress(Exception):
            _wait(lambda cb: stream.stopCaptureWithCompletionHandler_(cb))


def finish(recording: Recording) -> tuple[bytes, float]:
    """Stop and return the WAV and its peak level."""
    halt(recording)
    with recording.lock:
        samples = b"".join(recording.chunks)
        recording.chunks = []
    return wav(samples)


__all__ = ["DEFAULT_SECONDS", "MAX_SECONDS", "Recording", "SAMPLE_RATE", "SILENCE_PEAK", "finish", "halt",
           "seconds", "start", "wav"]
