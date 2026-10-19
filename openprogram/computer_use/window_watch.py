"""Keep the window the agent operates under a live capture, as Codex does.

While a ScreenCaptureKit stream is open on a window, macOS marks it: a
purple badge over its title-bar buttons and the screen-sharing icon in
the menu bar. Codex Computer Use keeps such a stream on the window it
controls; this does the same so the system draws the marker. The
stream asks for the smallest frame at one frame a second and attaches
no output, so nothing is recorded or kept.

A window stays watched while steps keep arriving and is released after
``IDLE_SECONDS`` without one, or when the agent moves to another window.
"""
from __future__ import annotations

import contextlib
import threading
import time
from typing import Any

IDLE_SECONDS = 20.0


class _Watch:
    def __init__(self, window_id: int) -> None:
        self.window_id = window_id
        self.stream: Any = None
        self.last = time.monotonic()


class WindowWatch:
    """At most one watched window per session."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._watches: dict[str, _Watch] = {}
        self._timer: threading.Timer | None = None

    def touch(self, session: str, window_id: int) -> None:
        """A step on ``window_id``: watch it, or keep watching it."""
        if not window_id:
            return
        with self._lock:
            watch = self._watches.get(session)
            if watch is not None and watch.window_id == window_id:
                watch.last = time.monotonic()
                return
            old, watch = watch, _Watch(window_id)
            self._watches[session] = watch
            self._schedule()
        if old is not None:
            threading.Thread(target=_stop, args=(old,), daemon=True).start()
        threading.Thread(target=self._start, args=(session, watch), daemon=True).start()

    def release(self, session: str) -> None:
        with self._lock:
            watch = self._watches.pop(session, None)
        if watch is not None:
            _stop(watch)

    def _start(self, session: str, watch: _Watch) -> None:
        try:
            stream = _open(watch.window_id)
        except Exception:
            # The marker is a courtesy; a step never fails because of it.
            return
        with self._lock:
            current = self._watches.get(session) is watch
            watch.stream = stream
        if not current:
            _stop(watch)

    def _schedule(self) -> None:
        if self._timer is None:
            self._timer = threading.Timer(IDLE_SECONDS / 4, self._sweep)
            self._timer.daemon = True
            self._timer.start()

    def _sweep(self) -> None:
        now = time.monotonic()
        with self._lock:
            self._timer = None
            idle = [s for s, w in self._watches.items() if now - w.last >= IDLE_SECONDS]
            stale = [self._watches.pop(s) for s in idle]
            if self._watches:
                self._schedule()
        for watch in stale:
            _stop(watch)


def _wait(start, timeout: float = 8.0):
    done, box = threading.Event(), []

    def callback(*args):
        box.extend(args)
        done.set()

    start(callback)
    if not done.wait(timeout):
        raise RuntimeError("the window capture did not answer in time")
    value, error = (box[0], box[1]) if len(box) == 2 else (None, box[0] if box else None)
    if error is not None:
        raise RuntimeError(str(error))
    return value


def _open(window_id: int):
    import CoreMedia as cm
    import ScreenCaptureKit as sc

    content = _wait(lambda cb: sc.SCShareableContent
                    .getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler_(True, False, cb))
    window = next((w for w in content.windows() if int(w.windowID()) == window_id), None)
    if window is None:
        raise RuntimeError(f"window {window_id} is not capturable")
    content_filter = sc.SCContentFilter.alloc().initWithDesktopIndependentWindow_(window)
    config = sc.SCStreamConfiguration.alloc().init()
    config.setWidth_(2)
    config.setHeight_(2)
    config.setMinimumFrameInterval_(cm.CMTimeMake(1, 1))
    config.setShowsCursor_(False)
    stream = sc.SCStream.alloc().initWithFilter_configuration_delegate_(content_filter, config, None)
    _wait(lambda cb: stream.startCaptureWithCompletionHandler_(cb))
    return stream


def _stop(watch: _Watch) -> None:
    stream, watch.stream = watch.stream, None
    if stream is None:
        return
    with contextlib.suppress(Exception):
        _wait(lambda cb: stream.stopCaptureWithCompletionHandler_(cb))
