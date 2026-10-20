"""Named services plugins share.

A plugin finds what it builds on by name — ``ctx.service("tools")`` — instead
of importing a concrete module, and can offer its own object to other
plugins with ``ctx.provide(name, value)``. The host's own subsystems are
listed here as built-in services, resolved lazily so importing this module
stays cheap.
"""
from __future__ import annotations

import importlib
from threading import RLock
from typing import Any, Callable

#: Built-in services: name → (module path, one-line description).
BUILTIN_SERVICES: dict[str, tuple[str, str]] = {
    "tools": ("openprogram.programs._runtime",
              "The tool registry: get(name), all_tools(), filter_for(...)"),
    "events": ("openprogram.events",
               "The event bus: get_event_bus(), make_event(...), EVENTS"),
    "context": ("openprogram.context.components",
                "System-prompt components: ContextComponent, register, assemble"),
    "skills": ("openprogram.skills.loader",
               "Skills: get_skill(name), resolve(...), user_dir()"),
    "mcp": ("openprogram.mcp.registry",
            "MCP servers: server_status(), get_client(name)"),
    "agents": ("openprogram.agent.management.manager",
               "Agents: list_all(), get(id), get_default()"),
    "commands": ("openprogram.commands.registry",
                 "Slash commands registry"),
    "providers": ("openprogram.providers.api_registry",
                  "Model wire implementations: get_api_provider(api)"),
}

_lock = RLock()
# name → (owner plugin, value)
_provided: dict[str, tuple[str, Any]] = {}


def provide(owner: str, name: str, value: Any) -> Callable[[], None]:
    """Offer ``value`` under ``name``. A name another plugin or the host
    already serves is refused. Returns the function that withdraws it."""
    if not name or not isinstance(name, str):
        raise ValueError("a service needs a name")
    with _lock:
        if name in BUILTIN_SERVICES:
            raise ValueError(f"service {name!r} is built in")
        current = _provided.get(name)
        if current is not None and current[0] != owner:
            raise ValueError(f"service {name!r} is provided by plugin {current[0]}")
        _provided[name] = (owner, value)

    def withdraw() -> None:
        with _lock:
            if _provided.get(name, (None,))[0] == owner:
                _provided.pop(name, None)

    return withdraw


def get(name: str) -> Any:
    """The service called ``name``. Raises ``KeyError`` naming what exists."""
    with _lock:
        if name in _provided:
            return _provided[name][1]
    if name in BUILTIN_SERVICES:
        return importlib.import_module(BUILTIN_SERVICES[name][0])
    raise KeyError(f"no service {name!r}; available: {', '.join(names())}")


def names() -> list[str]:
    with _lock:
        return sorted(set(BUILTIN_SERVICES) | set(_provided))


def describe() -> list[dict[str, str]]:
    """Every service with who serves it, for the inspection tool."""
    with _lock:
        provided = dict(_provided)
    rows = [{"name": n, "provider": "host", "doc": doc} for n, (_m, doc) in BUILTIN_SERVICES.items()]
    for n, (owner, value) in provided.items():
        doc = (getattr(value, "__doc__", "") or "").strip()
        rows.append({"name": n, "provider": f"plugin:{owner}",
                     "doc": doc.splitlines()[0] if doc else ""})
    return sorted(rows, key=lambda r: r["name"])
