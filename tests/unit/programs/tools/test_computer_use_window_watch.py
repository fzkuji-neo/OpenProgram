"""The operated window stays under a live capture so macOS marks it, then is released."""
import threading

from openprogram.computer_use import window_watch


def _fake(monkeypatch):
    opened, stopped = [], []
    ready = threading.Event()

    def fake_open(window_id):
        opened.append(window_id)
        ready.set()
        return f"stream-{window_id}"

    def fake_stop(watch):
        if watch.stream is not None:
            stopped.append(watch.stream)
            watch.stream = None

    monkeypatch.setattr(window_watch, "_open", fake_open)
    monkeypatch.setattr(window_watch, "_stop", fake_stop)
    return opened, stopped, ready


def _settle():
    for thread in threading.enumerate():
        if thread is not threading.current_thread() and thread.daemon and not isinstance(thread, threading.Timer):
            thread.join(1)


def test_steps_on_one_window_keep_one_capture(monkeypatch):
    opened, stopped, _ = _fake(monkeypatch)
    watch = window_watch.WindowWatch()
    watch.touch("s", 7)
    watch.touch("s", 7)
    _settle()
    assert opened == [7]
    watch.touch("s", 9)
    _settle()
    assert opened == [7, 9]
    assert stopped == ["stream-7"]
    watch.release("s")
    assert stopped == ["stream-7", "stream-9"]


def test_an_idle_window_is_released(monkeypatch):
    opened, stopped, _ = _fake(monkeypatch)
    watch = window_watch.WindowWatch()
    watch.touch("s", 7)
    _settle()
    watch._watches["s"].last -= window_watch.IDLE_SECONDS
    watch._timer.cancel()
    watch._timer = None
    watch._sweep()
    assert stopped == ["stream-7"]
    assert not watch._watches


def test_no_window_watches_nothing(monkeypatch):
    opened, _, _ = _fake(monkeypatch)
    window_watch.WindowWatch().touch("s", 0)
    _settle()
    assert opened == []
