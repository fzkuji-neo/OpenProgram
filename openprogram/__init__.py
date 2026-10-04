"""Public entries for configured Agents and task-local Context.

Imports are lazy. Importing openprogram does not create a Runtime, session,
provider, tool registration, or user interface.
"""

__all__ = ["Runtime", "decision", "Session", "Agent", "Context", "agent", "agent_async"]

_LAZY = {
    "Agent": ("openprogram.agentic_programming.agent_class", "Agent"),
    "Context": ("openprogram.context", "Context"),
    "agent": ("openprogram.agent", None),
    "agent_async": ("openprogram.agentic_programming.agent", "agent_async"),
    "Runtime": ("openprogram.agentic_programming.runtime", "Runtime"),
    "Session": ("openprogram.agentic_programming.session", "Session"),
    "decision": ("openprogram.agentic_programming.decision", None),
}


def __getattr__(name):
    target = _LAZY.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib
    module_path, attr = target
    module = importlib.import_module(module_path)
    value = module if attr is None else getattr(module, attr)
    globals()[name] = value  # cache: later lookups skip __getattr__
    return value


def __dir__():
    return sorted(list(globals()) + __all__)
