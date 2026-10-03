"""Own standalone execution resources without constructing a provider early."""
from contextlib import ExitStack, contextmanager
from tempfile import TemporaryDirectory
import uuid


class _LazyRuntime:
    """Resolve the existing provider Runtime only when it is used."""
    def __init__(self):
        object.__setattr__(self, '_runtime', None)
        object.__setattr__(self, '_settings', {})

    def _resolve(self, model=None):
        if self._runtime is None:
            from openprogram.providers.registry import create_runtime
            if not model:
                from .runtime import shared
                options_var = getattr(shared, '_current_agent_options', None)
                options = options_var.get() if options_var is not None else None
                model = (options or {}).get('model')
            if not model:
                model = self._settings.get('model')
            if model and ':' in model:
                provider, model_id = model.split(':', 1)
                runtime = create_runtime(provider=provider, model=model_id)
            elif model and '/' in model:
                provider, model_id = model.split('/', 1)
                runtime = create_runtime(provider=provider, model=model_id)
            elif model:
                runtime = create_runtime(model=model)
            else:
                runtime = create_runtime()
            for key, value in self._settings.items():
                setattr(runtime, key, value)
            object.__setattr__(self, '_runtime', runtime)
        return self._runtime

    def exec(self, *args, **kwargs):
        return self._resolve(kwargs.get('model')).exec(*args, **kwargs)

    async def async_exec(self, *args, **kwargs):
        return await self._resolve(kwargs.get('model')).async_exec(*args, **kwargs)

    def __getattr__(self, name):
        if name in self._settings:
            return self._settings[name]
        if name == 'system' and self._runtime is None:
            return None
        return getattr(self._resolve(), name)

    def __setattr__(self, name, value):
        self._settings[name] = value
        if self._runtime is not None:
            setattr(self._runtime, name, value)

    def close(self):
        if self._runtime is not None:
            self._runtime.close()


@contextmanager
def execution_scope(runtime=None):
    """Reuse ambient resources; release only resources owned by this entry."""
    from .function import _close_owned_runtime, _current_runtime
    from openprogram.store import _store, SessionNodeWriter, SessionStore
    from openprogram.agent.turn_request_context import current_turn_request
    from openprogram.agent.dispatcher.types import TurnRequest
    with ExitStack() as stack:
        current = runtime if runtime is not None else _current_runtime.get(None)
        if current is None:
            current = _LazyRuntime()
            stack.callback(_close_owned_runtime, current)
        if current is not _current_runtime.get(None):
            token = _current_runtime.set(current)
            stack.callback(_current_runtime.reset, token)
        writer = _store.get()
        if writer is None:
            directory = stack.enter_context(TemporaryDirectory(prefix='openprogram-execution-'))
            store = SessionStore(directory)
            stack.callback(store.close)
            session_id = uuid.uuid4().hex
            store.create_session(session_id, 'standalone', source='python')
            writer = SessionNodeWriter(store, session_id)
            token = _store.set(writer)
            stack.callback(_store.reset, token)
        if current_turn_request.get() is None:
            request = TurnRequest(session_id=getattr(writer, "session_id", "standalone"), user_text='',
                                  agent_id='standalone', source='python', permission_mode='ask')
            token = current_turn_request.set(request)
            stack.callback(current_turn_request.reset, token)
        yield current


runtime_scope = execution_scope
