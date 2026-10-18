"""Which workflow function made a role call.

A role call (``role(prompt)``, ``role.choose(...)``) reads the Python call
stack once, before it runs. The frames whose code lives under a workflow
root form the call site: the nearest one supplies the docstring for that
single request, and the whole list backs the ``call_path`` provider.
Nothing is recorded; plain functions stay plain Python.

The stack breaks at a thread pool, ``create_task`` or ``gather``. The
running workflow entry is also kept in a contextvar, which asyncio tasks and
``asyncio.to_thread`` inherit, so the entry level survives such a break.
"""
from __future__ import annotations

import inspect
import os
import sys
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SiteFrame:
    """One workflow function on the stack."""

    name: str
    doc: str
    module: str
    function: Any = None


@dataclass(frozen=True)
class WorkflowEntry:
    """The workflow entry currently running in this task."""

    function: Any
    writer: Any = None
    call_id: str = ""


@dataclass(frozen=True)
class CallSite:
    """The workflow frames of one role call, outermost first."""

    frames: tuple[SiteFrame, ...] = ()
    entry: WorkflowEntry | None = None
    frame_call_id: str | None = field(default=None, compare=False)

    @property
    def doc(self) -> str:
        """The docstring of the function that made the call."""
        return self.frames[-1].doc if self.frames else ""

    def path(self) -> list[SiteFrame]:
        """Frames from the entry to the caller, adding the entry when the stack broke."""
        frames = list(self.frames)
        entry = self.entry.function if self.entry is not None else None
        if entry is not None:
            entry_code = getattr(inspect.unwrap(entry), "__code__", None)
            if not frames or getattr(frames[0].function, "__code__", None) is not entry_code:
                source = inspect.unwrap(entry)
                frames.insert(0, SiteFrame(
                    name=getattr(source, "__qualname__", getattr(source, "__name__", "")),
                    doc=inspect.getdoc(source) or "",
                    module=getattr(source, "__module__", ""),
                    function=source,
                ))
        return frames


_current_site: ContextVar[CallSite | None] = ContextVar("workflow_call_site", default=None)
_current_entry: ContextVar[WorkflowEntry | None] = ContextVar("workflow_entry", default=None)

_extra_roots: list[str] = []
_file_cache: dict[str, bool] = {}


def builtin_workflow_root() -> str:
    return os.path.realpath(Path(__file__).resolve().parent.parent / "programs" / "workflow")


def user_workflow_root() -> str:
    from openprogram.paths import get_state_dir
    return os.path.realpath(get_state_dir() / "workflows")


def add_workflow_root(path: str | os.PathLike) -> None:
    """Treat functions defined under ``path`` as workflow functions."""
    root = os.path.realpath(path)
    if root not in _extra_roots:
        _extra_roots.append(root)
        _file_cache.clear()


def workflow_roots() -> tuple[str, ...]:
    roots = [builtin_workflow_root(), user_workflow_root(), *_extra_roots]
    return tuple(dict.fromkeys(roots))


def is_workflow_file(filename: str) -> bool:
    cached = _file_cache.get(filename)
    if cached is not None:
        return cached
    if not filename or filename.startswith("<"):
        result = False
    else:
        real = os.path.realpath(filename)
        result = any(real.startswith(root + os.sep) for root in workflow_roots())
    _file_cache[filename] = result
    return result


def _frame_function(frame) -> Any:
    code = frame.f_code
    qualname = getattr(code, "co_qualname", code.co_name)
    if "<locals>" in qualname or "<lambda>" in qualname:
        return None
    value: Any = frame.f_globals
    for index, part in enumerate(qualname.split(".")):
        value = value.get(part) if index == 0 else getattr(value, part, None)
        if value is None:
            return None
    if isinstance(value, (staticmethod, classmethod)):
        value = value.__func__
    source = inspect.unwrap(value) if callable(value) else None
    return source if getattr(source, "__code__", None) is code else None


def capture_frames(start=None) -> tuple[SiteFrame, ...]:
    """Workflow frames on the current stack, outermost first."""
    frame = start if start is not None else sys._getframe(1)
    found: list[SiteFrame] = []
    while frame is not None:
        if is_workflow_file(frame.f_code.co_filename):
            function = _frame_function(frame)
            code = frame.f_code
            found.append(SiteFrame(
                name=getattr(code, "co_qualname", code.co_name),
                doc=(inspect.getdoc(function) or "") if function is not None else "",
                module=frame.f_globals.get("__name__", ""),
                function=function,
            ))
        frame = frame.f_back
    found.reverse()
    return tuple(found)


def capture_site(start=None) -> CallSite | None:
    """The call site of a role call made by the frame ``start`` (default: caller)."""
    frames = capture_frames(start if start is not None else sys._getframe(1))
    entry = _current_entry.get()
    if not frames and entry is None:
        return None
    return CallSite(frames=frames, entry=entry)


def current_site() -> CallSite | None:
    return _current_site.get()


def current_entry() -> WorkflowEntry | None:
    return _current_entry.get()


class bind_site:
    """Make ``site`` the role-call site for the code inside the block."""

    def __init__(self, site: CallSite | None):
        self.site = site
        self.token = None

    def __enter__(self):
        from .call_state import current_call_id
        site = self.site
        if site is not None:
            site = CallSite(site.frames, site.entry, current_call_id() or None)
        self.token = _current_site.set(site)
        return site

    def __exit__(self, *exc):
        _current_site.reset(self.token)
        return False


class bind_entry:
    """Mark ``function`` as the running workflow entry."""

    def __init__(self, function):
        self.function = function
        self.token = None

    def __enter__(self):
        from openprogram.store import _store
        from .call_state import current_call_id
        entry = WorkflowEntry(self.function, _store.get(), current_call_id() or "")
        self.token = _current_entry.set(entry)
        return entry

    def __exit__(self, *exc):
        _current_entry.reset(self.token)
        return False


def in_role_call() -> CallSite | None:
    """The call site when the current frame is a workflow role call."""
    return _in_role_call()


def _in_role_call() -> CallSite | None:
    from .call_state import current_call_id
    site = _current_site.get()
    if site is not None and site.frame_call_id == (current_call_id() or None):
        return site
    return None


def request_doc() -> str:
    """The docstring for the request about to be sent.

    A role call made in the current frame supplies its caller's docstring.
    A deeper frame entered since then (a tool body, a function registered as
    a tool) supplies its own recorded docstring instead.
    """
    site = _in_role_call()
    if site is not None:
        return site.doc
    from .call_state import current_call_id
    from openprogram.store import _store
    frame_id = current_call_id()
    writer = _store.get()
    if not frame_id or writer is None:
        return ""
    try:
        node = writer.load().nodes.get(frame_id)
    except Exception:
        return ""
    return str(((node.metadata or {}).get("doc") if node is not None else "") or "")


def request_history(context, graph_history: list) -> list:
    """The history messages for one request, following ``context.history``.

    A workflow role call without an explicit setting sees no history.
    """
    site = _in_role_call()
    mode = context.history
    if site is not None and not context._history_explicit:
        mode = None
    if mode is None:
        return []
    if mode == "thread":
        return thread_messages(context.thread)
    if site is not None and site.entry is not None:
        return entry_chat_messages(site.entry, context)
    return list(graph_history)


def thread_messages(thread: list[dict]) -> list:
    from openprogram.providers.types import AssistantMessage, TextContent, UserMessage
    import time
    messages = []
    now = int(time.time() * 1000)
    for turn in thread:
        text = str(turn.get("text") or "")
        if turn.get("role") == "assistant":
            messages.append(AssistantMessage(
                role="assistant", content=[TextContent(text=text)], api="messages",
                provider="anthropic", model="history", timestamp=now))
        else:
            messages.append(UserMessage(role="user", content=[TextContent(text=text)], timestamp=now))
    return messages


def entry_chat_messages(entry: WorkflowEntry, context) -> list:
    """The conversation before the workflow entry was called."""
    writer = entry.writer
    if writer is None or not entry.call_id:
        return []
    from openprogram.context.nodes import render_context
    from openprogram.context.render import render_dag_messages
    graph = writer.load()
    node = graph.nodes.get(entry.call_id)
    if node is None:
        return []
    head, seen = node, set()
    while head.caller and head.caller in graph.nodes and head.id not in seen:
        seen.add(head.id)
        head = graph.nodes[head.caller]
    read_ids = render_context(graph, head_id=head.id, head_seq=node.seq - 1)
    if callable(context.history):
        read_ids = [node_id for node_id in read_ids if context.history(graph.nodes[node_id], context)]
    return render_dag_messages(graph, read_ids, None)


def role_name(instance, site: CallSite | None = None) -> str:
    """The module-level name a role instance is bound to, if any."""
    cached = getattr(instance, "_role_name", None)
    if cached is not None:
        return cached
    site = site if site is not None else _current_site.get()
    modules = [frame.module for frame in reversed(site.frames)] if site is not None else []
    for module_name in dict.fromkeys(modules):
        module = sys.modules.get(module_name)
        for key, value in list(vars(module).items()) if module is not None else ():
            if value is instance and not key.startswith("_"):
                try:
                    object.__setattr__(instance, "_role_name", key)
                except Exception:
                    pass
                return key
    return ""


__all__ = [
    "CallSite", "SiteFrame", "WorkflowEntry", "add_workflow_root", "bind_entry",
    "bind_site", "builtin_workflow_root", "in_role_call", "capture_frames", "capture_site",
    "current_entry", "current_site", "entry_chat_messages", "is_workflow_file",
    "request_doc", "request_history", "thread_messages",
    "role_name", "user_workflow_root", "workflow_roots",
]
