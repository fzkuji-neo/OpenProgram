"""Task-local context content and DAG history selection."""
from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, MutableMapping
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from copy import deepcopy
import inspect
from typing import Any

UNSET = object()
DELETE = object()
_current: ContextVar[Context | None] = ContextVar("openprogram_context", default=None)


class Context(MutableMapping[str, Any]):
    """Named content with a parent scope and optional history selection.

    Providers must be synchronous callables that accept one Context.
    Local writes persist on this object. Derived scopes copy effective content.
    Content does not change system instructions or tool permissions.
    """

    def __init__(self, blocks: Mapping[str, Any] | None = None, *,
                 parent: Context | None = None,
                 providers: Mapping[str, Callable] | None = None,
                 history_filter: Any = UNSET, call_id: Any = UNSET,
                 store: Any = UNSET, head_id: Any = UNSET,
                 excluded_call_ids: Any = UNSET):
        self.parent = parent
        self.excluded_call_ids = frozenset(parent.excluded_call_ids if parent is not None else ()) if excluded_call_ids is UNSET else frozenset(excluded_call_ids)
        self.store = (parent.store if parent is not None else None) if store is UNSET else store
        self.head_id = (parent.head_id if parent is not None else None) if head_id is UNSET else head_id
        self._store_explicit = store is not UNSET or (parent is not None and parent._store_explicit)
        self._head_explicit = head_id is not UNSET or (parent is not None and parent._head_explicit)
        if self.store is not None and not all(callable(getattr(self.store, name, None)) for name in ("load", "append", "update")):
            raise TypeError("Context store must be a SessionNodeWriter.")
        self._blocks = deepcopy(parent._blocks) if parent is not None else {}
        self._providers = dict(parent._providers) if parent is not None else {}
        self._deleted = set(parent._deleted) if parent is not None else set()
        self._history_explicit = history_filter is not UNSET or (parent is not None and parent._history_explicit)
        self.history_filter = (parent.history_filter if parent is not None else "dag") if history_filter is UNSET else history_filter
        self.call_id = (parent.call_id if parent is not None else None) if call_id is UNSET else call_id
        if self.history_filter not in (None, False, "dag", "current_call") and not callable(self.history_filter):
            raise TypeError("History filter must be 'dag', 'current_call', or a callable.")
        for name, value in (blocks or {}).items():
            if value is DELETE:
                self._blocks.pop(name, None)
                self._providers.pop(name, None)
                self._deleted.add(name)
            else:
                self[name] = deepcopy(value)
        for name, provider in (providers or {}).items():
            if not callable(provider) or inspect.iscoroutinefunction(provider):
                raise TypeError(f"Context provider {name!r} must be a synchronous callable.")
            self._deleted.discard(name)
            self._providers[name] = provider
            self._blocks.pop(name, None)

    @classmethod
    def for_session(cls, store, session_id: str, *, head_id=UNSET, **options):
        """Select a persistent session without creating or loading a provider."""
        from openprogram.store import SessionNodeWriter
        return cls(store=SessionNodeWriter(store, session_id), head_id=head_id, **options)

    @property
    def session_id(self):
        """The selected execution graph, independent of named content."""
        return getattr(self.store, 'session_id', None)

    @classmethod
    def turn_store(cls, session_id):
        """Resolve a turn's store from its explicit Context or the default."""
        current = cls.current()
        if current is not None and current.store is not None:
            if current.session_id != session_id:
                raise ValueError('Context belongs to a different session.')
            return current.store.store
        from openprogram.agent.session_db import default_db
        return default_db()

    def render_blocks(self):
        """Resolve named content once for a provider request."""
        import json
        from openprogram.providers.types import TextContent
        blocks = []
        for name, value in self.resolve_blocks().items():
            if value is None or value == '':
                continue
            value = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
            blocks.append(TextContent(text=f'{name}:\n{value}'))
        return blocks

    def add_to_messages(self, messages, *, blocks=None):
        """Add named content to a user message, never system authority."""
        from openprogram.providers.types import TextContent
        blocks = self.render_blocks() if blocks is None else blocks
        result = list(messages)
        if blocks:
            for index in range(len(result) - 1, -1, -1):
                message = result[index]
                if getattr(message, 'role', None) == 'user':
                    content = list(message.content) if isinstance(message.content, list) else [TextContent(text=message.content)]
                    result[index] = message.model_copy(update={'content': blocks + content})
                    break
        return result

    def filter_history(self, history):
        """Narrow an already authorized branch before model preparation."""
        if self.history_filter is False:
            return []
        if self.store is None or (self.history_filter in (None, 'dag') and not self.excluded_call_ids):
            return list(history)
        graph = self.store.load()
        ids = [row['id'] for row in history if row.get('id') in graph.nodes]
        selected = set(self.select_history(graph, ids))
        return [row for row in history if row.get('id') in selected]

    @classmethod
    def current(cls) -> Context | None:
        """Return the context bound to this task."""
        return _current.get()

    def derive(self, blocks: Mapping[str, Any] | None = None, *,
               providers: Mapping[str, Callable] | None = None,
               history_filter: Any = UNSET, call_id: Any = UNSET,
               store: Any = UNSET, head_id: Any = UNSET,
               excluded_call_ids: Any = UNSET) -> Context:
        """Create a child with an independent content snapshot."""
        return type(self)(blocks, parent=self, providers=providers,
                          history_filter=history_filter, call_id=call_id, store=store, head_id=head_id,
                          excluded_call_ids=excluded_call_ids)

    def merge(self, other: Context) -> Context:
        """Create a child with content and selection from another context."""
        blocks = {name: DELETE for name in other._deleted}
        blocks.update(other._blocks)
        return self.derive(blocks, providers=other._providers,
                           history_filter=other.history_filter if other._history_explicit else UNSET,
                           store=other.store if other._store_explicit else UNSET,
                           head_id=other.head_id if other._head_explicit else UNSET)

    @contextmanager
    def bind(self):
        """Bind this context and restore the previous task binding."""
        from openprogram.store import _store, SessionNodeWriter
        from openprogram.agentic_programming.call_state import _call_id, _forced_predecessor

        with ExitStack() as stack:
            writer = _store.get()
            if self.store is not None:
                if not isinstance(self.store, SessionNodeWriter):
                    raise TypeError("Context store must be a SessionNodeWriter.")
                if writer is not None and writer is not self.store:
                    raise ValueError("Context store differs from the active session writer.")
                if writer is None:
                    writer = self.store
                    token = _store.set(writer)
                    stack.callback(_store.reset, token)
            if self.head_id is not None:
                if writer is None or self.head_id not in writer.load().nodes:
                    raise ValueError(f"Context head {self.head_id!r} does not exist.")
                if not _call_id.get() and _forced_predecessor.get() != self.head_id:
                    token = _forced_predecessor.set(self.head_id)
                    stack.callback(_forced_predecessor.reset, token)
            token = _current.set(self)
            stack.callback(_current.reset, token)
            try:
                yield self
            except GeneratorExit:
                # An abandoned producer's generator may be collected in a
                # different Context. Those tokens cannot reset that Context;
                # close all callbacks without an unraisable GC exception.
                try:
                    stack.close()
                except ValueError:
                    pass
                raise

    def __getitem__(self, name: str) -> Any:
        if name in self._providers:
            return self._providers[name]
        return self._blocks[name]

    def __setitem__(self, name: str, value: Any) -> None:
        if not isinstance(name, str):
            raise TypeError("Context block names must be strings.")
        self._deleted.discard(name)
        self._providers.pop(name, None)
        self._blocks[name] = value

    def __delitem__(self, name: str) -> None:
        if name in self._providers:
            del self._providers[name]
        else:
            del self._blocks[name]
        self._deleted.add(name)

    def __iter__(self) -> Iterator[str]:
        return iter(dict.fromkeys((*self._blocks, *self._providers)))

    def __len__(self) -> int:
        return len(set(self._blocks) | set(self._providers))

    def resolve_blocks(self) -> dict[str, Any]:
        """Resolve and freeze named content for one request."""
        result = deepcopy(self._blocks)
        with self.bind():
            for name, provider in self._providers.items():
                try:
                    value = provider(self)
                    if inspect.isawaitable(value):
                        if inspect.iscoroutine(value):
                            value.close()
                        raise TypeError("The provider returned an awaitable.")
                    result[name] = deepcopy(value)
                except Exception as exc:
                    error = RuntimeError(f"Context provider {name!r} failed: {exc}")
                    error.retryable = False
                    raise error from exc
        return result

    def select_history(self, graph, read_ids: list[str], *, call_id: str | None = None) -> list[str]:
        """Filter IDs already selected by the DAG visibility policy.

        ``current_call`` keeps the scope node and its caller descendants.
        It does not include ancestor or sibling calls. It cannot restore IDs
        excluded by DAG authority, branch, or render-range rules.
        """
        scope_id = self.call_id or call_id
        excluded = set(self.excluded_call_ids)
        scope_node = graph.nodes.get(scope_id)
        task_id = (scope_node.metadata or {}).get("task_id") if scope_node is not None else None
        if task_id:
            branch = scope_node
            visited = set()
            while branch.caller and branch.caller not in visited:
                visited.add(branch.id)
                parent = graph.nodes.get(branch.caller)
                if parent is None or (parent.metadata or {}).get("task_id") != task_id:
                    break
                branch = parent
            ancestors = set()
            current = branch.caller
            while current and current not in ancestors:
                ancestors.add(current)
                node = graph.nodes.get(current)
                current = node.caller if node is not None else None
            # A sibling task can start after this branch entered. Include
            # those new sibling roots in the exclusion snapshot at read time.
            for node in graph.nodes.values():
                other_task = (node.metadata or {}).get("task_id")
                if other_task and other_task != task_id and node.caller in ancestors and node.seq >= branch.seq:
                    excluded.add(node.id)
        def selected(node_id: str) -> bool:
            current = node_id
            seen = set()
            while current and current not in seen:
                if current in excluded:
                    return False
                seen.add(current)
                node = graph.nodes.get(current)
                current = node.caller if node is not None else None
            if callable(self.history_filter):
                value = self.history_filter(graph.nodes[node_id], self)
                if inspect.isawaitable(value):
                    if inspect.iscoroutine(value):
                        value.close()
                    raise TypeError("History filter must return a synchronous value.")
                return bool(value)
            if self.history_filter is False:
                return False
            if self.history_filter != "current_call":
                return True
            current = node_id
            seen = set()
            while current and current not in seen:
                if current == scope_id:
                    return True
                seen.add(current)
                node = graph.nodes.get(current)
                current = node.caller if node is not None else None
            return False
        return list(dict.fromkeys(node_id for node_id in read_ids if selected(node_id)))
