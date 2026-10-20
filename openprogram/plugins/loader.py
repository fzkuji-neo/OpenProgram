"""四来源 plugin 扫描与加载。

来源优先级：project-pinned > path (~/.openprogram/plugins/<name>/) >
npm (~/.openprogram/plugins/node_modules/<name>/) > pip entry_points。
名字冲突时高优先级覆盖。
"""
from __future__ import annotations

import importlib
import importlib.metadata as md
import importlib.util
import json
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Any, Optional

from . import paths, registry, trust as _trust
from .context import PluginContext, call_setup
from .manifest import (
    PluginManifest,
    check_compatibility,
    from_entry_point_metadata,
    parse_manifest_dir,
)


# ---------- 数据 ----------

@dataclass
class Plugin:
    manifest: PluginManifest
    enabled: bool = False
    loaded: bool = False
    error: str = ""
    module: Any = None  # in-process import 拿到的 module/object
    contrib: dict[str, Any] = field(default_factory=dict)
    ctx: Optional[PluginContext] = None  # registrations of the running plugin

    @property
    def name(self) -> str:
        return self.manifest.name


_lock = RLock()
_plugins: dict[str, Plugin] = {}
_errors: dict[str, str] = {}  # name → error 字符串 (扫描期失败也记)


# ---------- 启用持久化 ----------

def _enabled_file() -> Path:
    return paths.root() / "plugins-enabled.json"


def _load_enabled() -> set[str]:
    f = _enabled_file()
    if not f.exists():
        return set()
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return {str(x) for x in data}
    except Exception:
        pass
    return set()


def _save_enabled(s: set[str]) -> None:
    _enabled_file().write_text(json.dumps(sorted(s), indent=2), encoding="utf-8")


# ---------- 扫描 ----------

def _scan_pip() -> list[PluginManifest]:
    out: list[PluginManifest] = []
    try:
        eps = md.entry_points(group="openprogram.plugins")
    except Exception:
        eps = []  # py<3.10 兼容
    for ep in eps:
        name = ep.name
        try:
            dist = ep.dist
            root = ""
            if dist and getattr(dist, "locate_file", None):
                try:
                    root = str(dist.locate_file(""))
                except Exception:
                    root = ""
            meta = {}
            try:
                if dist and dist.metadata:
                    meta = {"version": dist.version, "summary": dist.metadata.get("Summary", "")}
            except Exception:
                pass
            # 试着解析包目录内的 plugin.json / pyproject 等
            mf: Optional[PluginManifest] = None
            if root:
                mf = parse_manifest_dir(Path(root))
            if not mf:
                mf = from_entry_point_metadata(name, meta, root=root)
            mf.source_kind = "pip"
            # 把 entry_point target 存进 entrypoints 供后续 import
            mf.entrypoints.setdefault("_pip_entry", f"{ep.value}")
            out.append(mf)
        except Exception as e:
            _errors[name] = f"pip scan: {e}"
    return out


def _scan_npm() -> list[PluginManifest]:
    out: list[PluginManifest] = []
    mods = paths.npm_modules_dir()
    if not mods.is_dir():
        return out
    for child in sorted(mods.iterdir()):
        if not child.is_dir():
            continue
        # 跳 scoped 索引
        if child.name.startswith("@"):
            for sub in sorted(child.iterdir()):
                if sub.is_dir():
                    mf = parse_manifest_dir(sub)
                    if mf:
                        mf.source_kind = "npm"
                        out.append(mf)
            continue
        mf = parse_manifest_dir(child)
        if mf:
            mf.source_kind = "npm"
            out.append(mf)
    return out


def _scan_local() -> list[PluginManifest]:
    out: list[PluginManifest] = []
    base = paths.plugins_dir()
    for child in sorted(base.iterdir()):
        if not child.is_dir() or child.name == "node_modules":
            continue
        mf = parse_manifest_dir(child)
        if mf:
            mf.source_kind = "link" if child.is_symlink() else "path"
            out.append(mf)
    return out


def _scan_project(cwd: Path | None = None) -> list[PluginManifest]:
    out: list[PluginManifest] = []
    pin = paths.project_pins(cwd)
    if not pin.is_file():
        return out
    try:
        data = json.loads(pin.read_text(encoding="utf-8"))
    except Exception as e:
        _errors["__project_pins__"] = f"parse {pin}: {e}"
        return out
    entries = data.get("plugins") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        return out
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        path_s = entry.get("path") or entry.get("source")
        if not path_s:
            continue
        p = Path(path_s).expanduser()
        if not p.is_absolute():
            p = (pin.parent / p).resolve()
        mf = parse_manifest_dir(p)
        if mf:
            mf.source_kind = "project"
            out.append(mf)
        else:
            _errors[str(p)] = "no manifest found"
    return out


def rescan(cwd: Path | None = None) -> dict[str, Plugin]:
    """重新扫描所有来源。来源优先级越后越高，覆盖之前同名。

    A plugin that is running keeps its runtime state across a rescan when
    it still resolves to the same directory; one that disappeared or moved
    is unloaded first, so nothing it registered outlives it.
    """
    global _plugins
    with _lock:
        enabled_persist = _load_enabled()
        merged: dict[str, Plugin] = {}
        for mf in _scan_pip() + _scan_npm() + _scan_local() + _scan_project(cwd):
            merged[mf.name] = Plugin(manifest=mf, enabled=mf.name in enabled_persist)
        for name, old in list(_plugins.items()):
            if not old.loaded:
                continue
            new = merged.get(name)
            if new is not None and new.manifest.root == old.manifest.root:
                new.loaded, new.enabled, new.ctx = True, True, old.ctx
                new.module, new.contrib, new.error = old.module, old.contrib, old.error
            else:
                _deactivate(old)
        _plugins = merged
        return dict(_plugins)


# ---------- 加载 ----------

def _host_version() -> str:
    """真实 host 版本，用于 plugin compatibility 门控。

    openprogram 没有模块级 ``__version__``，但安装后 dist metadata 有；
    读不到时退回 ``0.0.0`` 让 compatibility 检查保守通过。"""
    try:
        return md.version("openprogram")
    except Exception:
        return "0.0.0"


_HOST_VERSION = _host_version()


def _options(name: str) -> dict[str, Any]:
    f = paths.options_dir() / f"{name}.json"
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _module_name(plugin: str, part: str) -> str:
    return f"openprogram_plugin_{plugin.replace('-', '_')}.{part}"


def _import_file(plugin: str, part: str, target: Path):
    """Import a file or package directory of the plugin under a private name."""
    init = target / "__init__.py" if target.is_dir() else target
    if not init.is_file():
        raise FileNotFoundError(f"{target} is not a Python file or package")
    name = _module_name(plugin, part)
    spec = importlib.util.spec_from_file_location(
        name, init, submodule_search_locations=[str(target)] if target.is_dir() else None,
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot import {target}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def _resolve_python(plugin: Plugin, target: str):
    """``pkg.module:attr``, ``pkg.module`` or a path inside the plugin."""
    base = Path(plugin.manifest.root) if plugin.manifest.root else Path.cwd()
    if target.endswith(".py") or target.startswith(("./", "../")) or "/" in target:
        path = (base / target).resolve()
        if not path.is_relative_to(base.resolve()):
            raise ValueError(f"{target} is outside the plugin directory")
        return _import_file(plugin.name, "main", path)
    mod_name, _, attr = target.partition(":")
    module = importlib.import_module(mod_name)
    return getattr(module, attr) if attr else module


def _rel(plugin: Plugin, value: str) -> Path:
    base = Path(plugin.manifest.root) if plugin.manifest.root else Path.cwd()
    path = (base / value).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError(f"{value} is outside the plugin directory")
    return path


def _md_commands(directory: Path) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for md_file in sorted(directory.rglob("*.md")) if directory.is_dir() else []:
        try:
            text = md_file.read_text(encoding="utf-8")
        except OSError:
            continue
        fm, body = _split_frontmatter(text)
        out.append({"name": fm.get("name", md_file.stem),
                    "description": fm.get("description", ""), "prompt": body.strip()})
    return out


def _agent_definitions(plugin: Plugin, value: Any) -> list[dict[str, Any]]:
    """Agents as a list of objects or a directory of Claude-style ``.md``."""
    if isinstance(value, list):
        return [dict(item) for item in value if isinstance(item, dict)]
    if not isinstance(value, str):
        return []
    rows = []
    directory = _rel(plugin, value)
    for md_file in sorted(directory.glob("*.md")) if directory.is_dir() else []:
        fm, body = _split_frontmatter(md_file.read_text(encoding="utf-8"))
        rows.append({"name": fm.get("name", md_file.stem), "description": fm.get("description", ""),
                     "prompt": body.strip(), "tools": fm.get("tools", "")})
    return rows


def _install_agents(ctx: PluginContext, plugin: Plugin, value: Any) -> None:
    """Create the plugin's Agents that do not exist yet.

    Agents are user records with their own sessions, so they stay when the
    plugin is disabled; enabling again reuses them untouched.
    """
    import re
    from openprogram.agent.management import manager
    for definition in _agent_definitions(plugin, value):
        label = str(definition.get("name") or "").strip()
        if not label:
            continue
        agent_id = re.sub(r"[^a-z0-9_-]+", "-", f"{plugin.name}-{label}".lower()).strip("-")[:40]
        if not agent_id[:1].isalpha():
            agent_id = f"p-{agent_id}"[:40]
        if manager.get(agent_id) is None:
            manager.create(agent_id, name=label, system_prompt=str(definition.get("prompt") or ""))
            patch: dict[str, Any] = {"description": str(definition.get("description") or "")}
            tools = definition.get("tools")
            if isinstance(tools, str) and tools.strip():
                tools = [t.strip().lower() for t in tools.split(",") if t.strip()]
            if isinstance(tools, list) and tools:
                patch["tools"] = {"mode": "selected", "allowed": [str(t) for t in tools]}
            elif isinstance(tools, dict):
                patch["tools"] = tools
            manager.update(agent_id, patch, replace_tool_policy="tools" in patch)
        ctx._record("agents", agent_id)


def _mcp_entries(plugin: Plugin, value: Any) -> dict[str, dict[str, Any]]:
    """``mcpServers`` inline or as a ``.mcp.json``-style file."""
    if isinstance(value, str):
        value = json.loads(_rel(plugin, value).read_text(encoding="utf-8"))
    if isinstance(value, dict) and isinstance(value.get("mcpServers"), dict):
        value = value["mcpServers"]
    if not isinstance(value, dict):
        return {}
    return {str(k): dict(v) for k, v in value.items() if isinstance(v, dict)}


def _activate(plugin: Plugin) -> None:
    """Run the plugin's setup and wire its manifest contributions.

    Everything goes through one :class:`PluginContext`; a failure part way
    undoes what already registered, so a broken plugin leaves no trace.
    """
    mf = plugin.manifest
    ctx = PluginContext(mf.name, mf.root, _options(mf.name))
    plugin.ctx = ctx
    ep = dict(mf.entrypoints)
    contrib: dict[str, Any] = {}
    root = mf.root
    if root and mf.source_kind in ("path", "link", "project") and root not in sys.path:
        sys.path.insert(0, root)
        ctx.effect(lambda: root in sys.path and sys.path.remove(root), "sys.path")
    ctx.effect(lambda: _evict(plugin), "modules")
    try:
        target = ep.get("_pip_entry") or ep.get("python") or ep.get("module") or ep.get("setup")
        if isinstance(target, str) and target:
            obj = _resolve_python(plugin, target)
            plugin.module = obj
            setup = obj if callable(obj) and not isinstance(obj, type) else getattr(obj, "setup", None)
            if callable(setup):
                call_setup(setup, ctx)

        if isinstance(ep.get("tools"), str):
            target = ep["tools"]
            module = (_import_file(mf.name, "tools", _rel(plugin, target))
                      if "/" in target or target.startswith(".") else importlib.import_module(target))
            ctx.tools_from(module)
        if isinstance(ep.get("skills"), str):
            ctx.skills(ep["skills"])
            contrib["skills"] = str(_rel(plugin, ep["skills"]))
        cmds = ep.get("commands")
        if isinstance(cmds, dict):
            for cname, cdef in cmds.items():
                if isinstance(cdef, dict):
                    ctx.command(str(cname), str(cdef.get("prompt", "")), str(cdef.get("description", "")))
        elif isinstance(cmds, str) and "*" not in cmds:
            for c in _md_commands(_rel(plugin, cmds)):
                ctx.command(c["name"], c["prompt"], c["description"])
        hooks_ep = ep.get("hooks")
        if isinstance(hooks_ep, str) and ":" in hooks_ep and not hooks_ep.endswith(".json"):
            from . import hooks as _hooks
            mapping = _resolve_python(plugin, hooks_ep)
            if callable(mapping):
                mapping = mapping()
            if isinstance(mapping, dict):
                _hooks.register_plugin_hooks(mf.name, mapping)
                ctx.effect(lambda: _hooks.unregister_plugin_hooks(mf.name), "hooks")
                for event_name in mapping:
                    ctx._record("events", str(event_name))
        for server, entry in _mcp_entries(plugin, ep.get("mcpServers")).items():
            ctx.mcp_server(server, entry)
        if isinstance(ep.get("providers"), str) and _rel(plugin, ep["providers"]).is_dir():
            ctx.provider_root(ep["providers"])
        if ep.get("agents"):
            _install_agents(ctx, plugin, ep["agents"])
        if isinstance(ep.get("web"), str):
            contrib["web"] = str(_rel(plugin, ep["web"]))
        clients = ep.get("client")
        for module_path in ([clients] if isinstance(clients, str) else clients or []):
            ctx.client(module_path)
        if mf.sidebar:
            contrib["sidebar"] = list(mf.sidebar)
    except BaseException:
        ctx.dispose()
        plugin.ctx = None
        raise
    if ctx.commands:
        contrib["_commands"] = ctx.commands
    plugin.contrib = contrib
    registry.set_plugin_contrib(mf.name, contrib)


def _evict(plugin: Plugin) -> None:
    """Forget every module the plugin brought, so the next import is fresh."""
    root = Path(plugin.manifest.root).resolve() if plugin.manifest.root else None
    prefixes = (f"openprogram_plugin_{plugin.name.replace('-', '_')}.",
                f"openprogram_plugin_tools.{plugin.name}.")
    for name, module in list(sys.modules.items()):
        if name.startswith(prefixes):
            sys.modules.pop(name, None)
            continue
        if root is None or plugin.manifest.source_kind == "pip":
            continue
        origin = getattr(module, "__file__", None)
        try:
            if origin and Path(origin).resolve().is_relative_to(root):
                sys.modules.pop(name, None)
        except (OSError, ValueError):
            continue
    importlib.invalidate_caches()


def _deactivate(plugin: Plugin) -> list[str]:
    """Undo everything the plugin registered. Returns undo errors."""
    from openprogram.events import emit_safe
    emit_safe("plugin.disable", "system", {"plugin": plugin.name})
    errors = plugin.ctx.dispose() if plugin.ctx is not None else []
    registry.clear_plugin_contrib(plugin.name)
    plugin.ctx = None
    plugin.loaded = False
    plugin.module = None
    plugin.contrib = {}
    return errors


def _announce(name: str) -> None:
    """Refresh what reads plugin contributions and tell the Web page."""
    try:
        from openprogram.commands import registry as commands
        commands.reload()
    except Exception:
        pass
    from openprogram.events import emit_ws_frame
    emit_ws_frame({"type": "plugins:changed", "data": {"plugin": name}})


def _split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Very small YAML-ish frontmatter parser — same shape as the
    skills loader's parser. Returns ``(dict, body)``."""
    if not text.startswith("---"):
        return {}, text
    lines = text.split("\n")
    if len(lines) < 2:
        return {}, text
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end < 0:
        return {}, text
    fm: dict[str, str] = {}
    for line in lines[1:end]:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        fm[k.strip()] = v.strip().strip("\"'")
    return fm, "\n".join(lines[end + 1:])


def _check(p: Plugin) -> None:
    """Refuse a plugin whose trust, compatibility or dependencies fail."""
    name = p.name
    level = _trust.get_trust(name)
    if level == "untrusted":
        p.error = "trust=untrusted; please elevate trust before enabling"
        raise PermissionError(p.error)
    ok, reason = check_compatibility(p.manifest.compatibility, _HOST_VERSION)
    if not ok:
        p.error = f"incompatible: {reason}"
        raise RuntimeError(p.error)
    # Dependency resolution — every plugin in ``requires`` must be
    # installed AND loaded. We don't auto-enable upstream deps;
    # that would be too magical. We just report the gap.
    missing: list[str] = []
    not_enabled: list[str] = []
    for dep in p.manifest.requires:
        dep_p = _plugins.get(dep)
        if dep_p is None:
            missing.append(dep)
        elif not dep_p.loaded:
            not_enabled.append(dep)
    if missing or not_enabled:
        parts: list[str] = []
        if missing:
            parts.append(f"missing dependencies: {', '.join(missing)}")
        if not_enabled:
            parts.append(f"deps not enabled: {', '.join(not_enabled)}")
        p.error = "; ".join(parts)
        raise RuntimeError(p.error)


def load_plugin(name: str) -> Plugin:
    """加载并启用单个 plugin。trust 不足时拒绝。"""
    paths.sanitize_name(name)
    with _lock:
        p = _plugins.get(name)
        if not p:
            raise KeyError(f"unknown plugin: {name}")
        if p.loaded:
            return p
        p.error = ""
        try:
            _check(p)
            _activate(p)
        except Exception as e:
            p.enabled = False
            p.loaded = False
            if not p.error:
                p.error = f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"
            _errors[name] = p.error
            raise
        p.loaded = True
        p.enabled = True
        p.error = "deprecated" if p.manifest.deprecated else ""
        _errors.pop(name, None)
        s = _load_enabled()
        s.add(name)
        _save_enabled(s)
        from openprogram.events import emit_safe
        emit_safe("plugin.enable", "system", {"plugin": name})
    _announce(name)
    return p


def unload_plugin(name: str) -> Plugin:
    paths.sanitize_name(name)
    with _lock:
        p = _plugins.get(name)
        if not p:
            raise KeyError(f"unknown plugin: {name}")
        errors = _deactivate(p) if p.loaded else []
        p.enabled = False
        p.error = "; ".join(errors)
        s = _load_enabled()
        s.discard(name)
        _save_enabled(s)
    _announce(name)
    return p


def reload_plugin(name: str) -> Plugin:
    """Unload, re-read the manifest and code from disk, load again.

    A plugin that fails to come back stays enabled with its error, so the
    next fix and reload (or restart) brings it back.
    """
    paths.sanitize_name(name)
    with _lock:
        p = _plugins.get(name)
        if not p:
            raise KeyError(f"unknown plugin: {name}")
        if p.loaded:
            _deactivate(p)
        rescan()
        p = _plugins.get(name)
        if p is None:
            raise KeyError(f"plugin {name} is no longer installed")
    try:
        return load_plugin(name)
    except Exception:
        with _lock:
            s = _load_enabled()
            s.add(name)
            _save_enabled(s)
        raise


def load_enabled() -> dict[str, str]:
    """Load every plugin the profile has enabled, dependencies first.

    Called once at worker startup. Returns ``{name: error}`` for the ones
    that could not load; they stay enabled so a fix takes effect on reload.
    """
    with _lock:
        rescan()
        wanted = [p for p in _plugins.values() if p.enabled and not p.loaded]
    failures: dict[str, str] = {}
    pending = {p.name: p for p in wanted}
    while pending:
        ready = [n for n, p in pending.items()
                 if all(dep not in pending for dep in p.manifest.requires)]
        if not ready:  # a dependency cycle: try them anyway, each reports why
            ready = list(pending)
        for name in sorted(ready):
            pending.pop(name)
            try:
                load_plugin(name)
            except Exception as exc:
                failures[name] = str(exc)
                with _lock:
                    s = _load_enabled()
                    s.add(name)
                    _save_enabled(s)
                    if name in _plugins:
                        _plugins[name].enabled = True
    return failures


# ---------- 公共 getter ----------

def list_plugins() -> list[Plugin]:
    with _lock:
        if not _plugins:
            try:
                rescan()
            except Exception as e:
                _errors["__scan__"] = str(e)
        return list(_plugins.values())


def get_plugin(name: str) -> Plugin | None:
    with _lock:
        if not _plugins:
            try:
                rescan()
            except Exception:
                pass
        return _plugins.get(name)


def all_errors() -> dict[str, str]:
    with _lock:
        out = dict(_errors)
        for p in _plugins.values():
            if p.error:
                out.setdefault(p.name, p.error)
        return out


def clear_error(name: str) -> None:
    with _lock:
        _errors.pop(name, None)
