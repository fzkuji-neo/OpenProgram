"""Task-local call identity and recording shared by Python entry points."""
from __future__ import annotations

import asyncio
import functools
import inspect
import time
import threading
import uuid
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar

capture_suspended = ContextVar("openprogram_capture_suspended", default=False)


def execution_task_id():
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    return f'asyncio:{id(task)}' if task is not None else f'thread:{threading.get_ident()}'


class CallScope:
    def __init__(self, function_name, *, docstring='', arguments=None, expose='full',
                 render_range=None, capture_io=False, pending_id=None, context=None):
        self.function_name = function_name
        self.docstring = docstring
        self.arguments = arguments or {}
        self.expose = expose
        self.render_range = render_range
        self.capture_io = capture_io
        self.id = pending_id
        self.context = context
        self.parent_id = ''
        self.output = None
        self.error = None
        self.status = 'running'
        self._stack = ExitStack()

    def __enter__(self):
        from . import function as f
        from openprogram.context.model import Context
        self.parent_id = f.current_call_id()
        occurrence = f.current_tool_call_occurrence_id()
        tool_id = f.current_tool_call_id()
        identity = occurrence or (tool_id if not f.tool_call_identity_consumed() else '')
        if self.id is None:
            if identity and self.parent_id:
                self.id = f.tool_node_id(self.parent_id, identity)
            elif f._forced_node_id.get() and not self.parent_id:
                self.id = f._forced_node_id.get()
            else:
                self.id = uuid.uuid4().hex[:12]
        self.started_at = time.time()
        parent = self.context if self.context is not None else Context.current()
        if parent is None:
            parent = Context()
        excluded = set(parent.excluded_call_ids)
        from openprogram.store import _store, SessionNodeWriter
        writer = _store.get()
        task_id = execution_task_id()
        if isinstance(writer, SessionNodeWriter):
            for node in writer.load().nodes.values():
                metadata = node.metadata or {}
                if (node.caller == self.parent_id and node.id != self.id
                        and metadata.get('task_id') not in (None, task_id)
                        and metadata.get('status') in ('running', 'pending', 'streaming')):
                    excluded.add(node.id)
        try:
            f._append_function_call_entry(
                pending_id=self.id, function_name=self.function_name,
                arguments=self.arguments if self.capture_io else {}, expose=self.expose,
                render_range=self.render_range, started_at=self.started_at,
                docstring=self.docstring)
            if isinstance(writer, SessionNodeWriter) and self.expose != 'hidden':
                writer.update(self.id, metadata={'task_id': task_id})
            if occurrence or tool_id:
                from openprogram.programs._runtime import (
                    _current_tool_call_occurrence_id, _tool_call_identity_consumed)
                token = _tool_call_identity_consumed.set(True)
                self._stack.callback(_tool_call_identity_consumed.reset, token)
                if occurrence:
                    token = _current_tool_call_occurrence_id.set(None)
                    self._stack.callback(_current_tool_call_occurrence_id.reset, token)
            token = f._call_id.set(self.id)
            self._stack.callback(f._call_id.reset, token)
            self.context = parent.derive(call_id=self.id, excluded_call_ids=excluded)
            self._stack.enter_context(self.context.bind())
            return self
        except BaseException:
            self._stack.close()
            raise

    def __exit__(self, exc_type, exc, tb):
        from . import function as f
        from .continuation import FunctionSuspended
        if isinstance(exc, FunctionSuspended):
            self.status = 'paused'
        elif isinstance(exc, (asyncio.CancelledError, f.CancelledError)):
            self.status, self.error = 'cancelled', 'Cancelled by user'
        elif exc is not None:
            self.status, self.error = 'error', str(exc)
        elif self.status == 'running':
            self.status = 'completed'
        try:
            f._update_function_call_exit(
                pending_id=self.id, output=self.output if self.capture_io else None,
                error=self.error, status=self.status, expose=self.expose,
                started_at=self.started_at, ended_at=time.time())
        finally:
            self._stack.close()
        return False


def managed_function(fn, *, context_factory=None, name=None, expose="full",
                     render_range=None, capture_io=False, input=None):
    """Bind a structural call scope before a synchronous or async body runs.

    Generators remain unwrapped because creation does not execute their body.
    ``context_factory`` receives the invocation's positional and keyword values.
    """
    if isinstance(fn, (staticmethod, classmethod)):
        return type(fn)(managed_function(fn.__func__, context_factory=context_factory, name=name,
                                               expose=expose, render_range=render_range,
                                               capture_io=capture_io, input=input))
    if (not inspect.isfunction(fn) or inspect.isgeneratorfunction(fn)
            or inspect.isasyncgenfunction(fn)
            or any(getattr(fn, marker, False) for marker in
                   ('_is_managed_function', '_is_agentic', '_is_traced'))):
        return fn
    label = name or f'{fn.__module__}.{fn.__qualname__}'

    def scope(args, kwargs):
        context = context_factory(args, kwargs) if context_factory else None
        arguments = {}
        if capture_io:
            bound = inspect.signature(fn).bind(*args, **kwargs)
            bound.apply_defaults()
            arguments = {key: value for key, value in bound.arguments.items()
                         if key not in ('self', 'cls')}
        return CallScope(label, docstring=inspect.getdoc(fn) or '', context=context,
                         arguments=arguments, expose=expose, render_range=render_range,
                         capture_io=capture_io)

    @contextmanager
    def invocation_scope(args, kwargs):
        from .runtime_scope import execution_scope
        call = scope(args, kwargs)
        with ExitStack() as stack:
            if call.context is not None:
                stack.enter_context(call.context.bind())
            stack.enter_context(execution_scope())
            stack.enter_context(call)
            yield call

    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            if capture_suspended.get():
                return await fn(*args, **kwargs)
            from .runtime_scope import execution_scope
            from .function import _run_pre_invocation_hooks
            _run_pre_invocation_hooks()
            with invocation_scope(args, kwargs) as call:
                call.output = await fn(*args, **kwargs)
                return call.output
    else:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            if capture_suspended.get():
                return fn(*args, **kwargs)
            from .runtime_scope import execution_scope
            from .function import _run_pre_invocation_hooks
            _run_pre_invocation_hooks()
            with invocation_scope(args, kwargs) as call:
                call.output = fn(*args, **kwargs)
                return call.output
    wrapper._is_managed_function = True
    return wrapper
