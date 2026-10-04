"""Own standalone execution resources without constructing a provider early."""
from contextlib import ExitStack, contextmanager
from tempfile import TemporaryDirectory
import uuid

from .runtime.questions import QuestionsOperations


class _LazyRuntime(QuestionsOperations):
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

    def can_ask(self):
        if self._runtime is not None:
            return self._runtime.can_ask()
        return super().can_ask()

    def ask(self, *args, **kwargs):
        if self._runtime is not None:
            return self._runtime.ask(*args, **kwargs)
        return super().ask(*args, **kwargs)

    @contextmanager
    def _active_runtime(self, model=None):
        from .call_state import _current_runtime
        runtime = self._resolve(model)
        token = _current_runtime.set(runtime)
        try:
            yield runtime
        finally:
            _current_runtime.reset(token)

    def exec(self, *args, **kwargs):
        with self._active_runtime(kwargs.get('model')) as runtime:
            return runtime.exec(*args, **kwargs)

    async def async_exec(self, *args, **kwargs):
        with self._active_runtime(kwargs.get('model')) as runtime:
            return await runtime.async_exec(*args, **kwargs)

    def __getattr__(self, name):
        if name in self._settings:
            return self._settings[name]
        if self._runtime is None:
            if name in ('system', 'last_usage', 'api_model', '_question_transport',
                        'on_stream', '_skills_config', '_skills_cache_key', 'api_key'):
                return None
            if name == 'last_blocks':
                return []
            if name == 'last_agent_iteration_count':
                return 0
            if name in ('usage_is_cumulative', 'has_session', '_closed'):
                return False
            if name in ('model', 'provider_id'):
                from .runtime.shared import _current_agent_options
                model = _current_agent_options.get().get('model') or self._settings.get('model')
                if model and (':' in model or '/' in model):
                    delimiter = ':' if ':' in model else '/'
                    provider, model_id = model.split(delimiter, 1)
                    return provider if name == 'provider_id' else model_id
                return (model or 'default') if name == 'model' else None
            if name == 'thinking_level':
                return 'off'
            raise AttributeError(name)
        return getattr(self._runtime, name)

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
    from .call_state import _close_owned_runtime, _current_runtime
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
