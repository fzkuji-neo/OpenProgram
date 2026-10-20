"""What a plugin can register, read from the live registries.

``describe()`` is the machine form the ``plugin`` tool and
``openprogram plugins inspect --json`` return; ``guide()`` is the same
facts as a short authoring guide. Both list the events from the event
registry and the services from the service registry as they are now, so
an Agent writing a plugin sees the extension points this build has.
"""
from __future__ import annotations

import inspect as _inspect
from typing import Any

#: Web slots: where a plugin's client module can place a React component.
#: The Web page renders ``<PluginSlot name=…>`` at each of these places
#: (apps/web/lib/plugins/slots.ts keeps the same list).
CLIENT_SLOTS: dict[str, str] = {
    "sidebar.nav": "Rows under the sidebar's main navigation. props: {}",
    "sidebar.footer": "Above the account row at the bottom of the sidebar. props: {}",
    "tabstrip.actions": "Buttons at the right end of the top tab strip. props: {}",
    "tool.result": "Under every finished tool call in the conversation; return null for "
                   "tools you do not handle. props: {tool, args, result, isError}",
    "plugin.settings": "Inside this plugin's detail on the Plugins page. props: {plugin}",
}

#: Manifest ``entrypoints`` keys (also accepted at the top level).
MANIFEST_KEYS: dict[str, str] = {
    "python": "Setup code: './plugin.py', 'pkg.module' or 'pkg.module:setup'. "
              "Its setup(ctx) runs on enable.",
    "tools": "A package directory or module whose PROGRAM_ENTRIES become tools.",
    "skills": "A directory of SKILL.md skills.",
    "commands": "Slash commands: {name: {description, prompt}} or a directory of .md files.",
    "hooks": "'module:name' resolving to {event: handler} (or a factory returning it).",
    "mcpServers": "{name: {command, args, env} | {url}} inline, or a .mcp.json path.",
    "providers": "A directory whose children each hold a provider.json.",
    "agents": "A list of {name, description, prompt, tools} or a directory of .md agents.",
    "client": "A JavaScript module (or list) the Web page imports; see slots.",
    "web": "A static directory served as a full page at /plugin/<name>/.",
    "sidebar": "Top-level list of {label, label_zh, page | href} sidebar entries.",
    "requires": "Top-level list of plugins that must load first.",
    "options": "Top-level JSON schema of options; values reach setup as ctx.options.",
}

CLIENT_API = {
    "setup(api)": "The module's default export (or named setup); may return a cleanup.",
    "api.slot(name, Component, {order})": "Render a component in a slot; returns its removal.",
    "api.React": "The page's React; write components with React.createElement.",
    "api.plugin": "This plugin's name.",
    "api.text(en, zh)": "The string for the page's language.",
    "api.useTranslation()": "Hook returning {text, locale}; re-renders when the language changes.",
    "api.fetch(path, init)": "Authenticated fetch against the OpenProgram backend.",
    "api.json(path, init)": "The same, parsed as JSON; throws on an error status.",
    "api.navigate(href)": "Open a page inside the app, e.g. /plugin/<name>/.",
}


def _signature(fn) -> str:
    """``fn``'s signature without ``self`` and with annotations unquoted."""
    sig = _inspect.signature(fn)
    params = [param.replace(annotation=_inspect.Parameter.empty
                            if param.annotation is _inspect.Parameter.empty
                            else _Annotation(param.annotation))
              for name, param in sig.parameters.items() if name != "self"]
    text = str(sig.replace(parameters=params, return_annotation=_inspect.Signature.empty))
    if sig.return_annotation is not _inspect.Signature.empty:
        text += f" -> {_Annotation(sig.return_annotation)!r}"
    return text


class _Annotation:
    def __init__(self, value: Any):
        self.value = value

    def __repr__(self) -> str:
        return self.value if isinstance(self.value, str) else _inspect.formatannotation(self.value)


def _ctx_methods() -> list[dict[str, str]]:
    from .context import PluginContext
    rows = []
    for name, member in _inspect.getmembers(PluginContext, predicate=_inspect.isfunction):
        if name.startswith("_") or name in ("dispose",):
            continue
        doc = (_inspect.getdoc(member) or "").splitlines()
        signature = _signature(member)
        rows.append({"name": f"ctx.{name}{signature}", "doc": doc[0] if doc else ""})
    rows += [
        {"name": "ctx.name", "doc": "The plugin's name."},
        {"name": "ctx.root", "doc": "The plugin directory (pathlib.Path)."},
        {"name": "ctx.options", "doc": "The options saved for this plugin."},
        {"name": "ctx.log", "doc": "A logging.Logger for this plugin."},
    ]
    return rows


def describe() -> dict[str, Any]:
    from openprogram.events.registry import EVENTS
    from . import services
    return {
        "setup": "def setup(ctx): ... — every ctx registration is undone on disable or reload",
        "context_api": _ctx_methods(),
        "manifest": MANIFEST_KEYS,
        "events": [{"name": name, "kind": spec.kind, "payload": spec.payload_doc,
                    "register_with": {"notify": "ctx.on", "gate": "ctx.gate",
                                      "transform": "ctx.transform"}[spec.kind]}
                   for name, spec in sorted(EVENTS.items())],
        "services": services.describe(),
        "client_slots": CLIENT_SLOTS,
        "client_api": CLIENT_API,
    }


def guide() -> str:
    facts = describe()
    lines = [
        "OpenProgram plugin",
        "",
        "A directory with plugin.json, for example:",
        '  {"name": "word-tools", "python": "./plugin.py", "client": "./client.js"}',
        "plugin.py defines setup(ctx); every registration below is undone when",
        "the plugin is disabled or reloaded. Install a local directory with",
        "`openprogram plugins install path <dir>`, then enable and reload it.",
        "",
        "setup(ctx) API:",
        *[f"  {row['name']}\n      {row['doc']}" for row in facts["context_api"]],
        "",
        "Manifest keys:",
        *[f"  {key}: {doc}" for key, doc in facts["manifest"].items()],
        "",
        "Events:",
        *[f"  {row['name']} [{row['kind']} → {row['register_with']}]: {row['payload']}"
          for row in facts["events"]],
        "",
        "Services (ctx.service(name)):",
        *[f"  {row['name']} ({row['provider']}): {row['doc']}" for row in facts["services"]],
        "",
        "Web client module (client.js, an ES module):",
        *[f"  {key}: {doc}" for key, doc in facts["client_api"].items()],
        "Slots:",
        *[f"  {key}: {doc}" for key, doc in facts["client_slots"].items()],
    ]
    return "\n".join(lines)
