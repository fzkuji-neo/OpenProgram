# Plugin Runtime

How an enabled plugin's code runs inside the worker, and how everything it adds is taken back out. The manifest forms, sources, marketplaces and trust levels are covered in [Skills & Plugins](skills-and-plugins.md); this record covers what happens between enable and disable.

The model follows Cordis (the plugin core behind Koishi and DeepSeek Harness), carried over to Python: a plugin is a function of a context, every registration made through that context is an *effect* with a disposer, and disposing the context undoes the plugin completely. Nothing is a separate plugin-only registry: each effect writes into the registry the host already uses for that kind of thing.

## 1. Lifecycle

```
rescan ──► Plugin(manifest)          enabled set: ~/.openprogram/plugins-enabled.json
load_plugin(name)
  _check: trust, compatibility, requires (every dependency loaded first)
  _activate:
     PluginContext(name, root, options)
     manifest keys  ──► ctx effects (tools, skills, commands, hooks, mcpServers,
                                     providers, agents, client, sidebar, web)
     python entry   ──► setup(ctx)   (a returned callable becomes one more effect)
     any exception  ──► ctx.dispose(), modules evicted, error kept on the plugin
  emit plugin.enable, broadcast plugins:changed
unload_plugin(name)
  emit plugin.disable ──► ctx.dispose() (effects in reverse order) ──► evict modules
reload_plugin(name) = unload + rescan + load   (the plugin stays enabled if the new code fails)
```

- **Startup.** `apps/server/openprogram_server/server.py` runs `_load_plugins` after the MCP servers start: it hands the event loop to `plugins.context.set_host_loop` and calls `loader.load_enabled()` on a thread, which loads the enabled set in dependency order and logs each failure without stopping the others.
- **Rescan keeps running plugins.** A rescan that finds a loaded plugin at the same root keeps its context; a changed root deactivates it first.
- **Module eviction.** On deactivate every module whose file lies under the plugin root leaves `sys.modules`, along with the synthetic `openprogram_plugin_<name>.*` modules. A reload therefore imports the code now on disk. Pip plugins are left in place, since their modules live in site-packages.
- **Local plugins are links.** `install path <dir>` symlinks `~/.openprogram/plugins/<name>` to the directory, so edits take effect on reload and uninstall removes only the link.

## 2. The context

`openprogram/plugins/context.py` defines `PluginContext`. Each method registers through an existing host registry and records the undo:

| Effect | Host registry | Undo |
|---|---|---|
| `ctx.tool(fn, **options)` / `ctx.tools_from(module)` | `programs._runtime` via `register_workflow_entries(owner="plugin:<name>")` — the same `PROGRAM_ENTRIES` rules as built-in tools | `unregister` |
| `ctx.on` / `ctx.gate` / `ctx.transform` | `EventBus.subscribe` / `subscribe_gate` / `subscribe_transform`, checked against the event's kind in `events/registry.py` | the subscription's disposer |
| `ctx.context(name, build, layer, order)` | `context.components` (L0–L2) under `plugin:<plugin>:<name>` | `components.unregister` |
| `ctx.provide(name, value)` / `ctx.service(name)` | `plugins/services.py` | withdraw |
| `ctx.command(name, prompt, description)` | `contrib["_commands"]`, read by the commands registry adapter | cleared with the contributions |
| `ctx.skills(dir)` | `skills` plugin source | unregister the source |
| `ctx.mcp_server(name, config)` | `mcp` manager `add_server` as `<plugin>_<name>`, scheduled on the host loop; never written to `mcp_servers.json` | `remove_server` |
| `ctx.provider_root(dir)` | `providers/plugin_dirs.py`, the search path behind `provider.json` lookups | remove the root |
| `ctx.api_provider(api, provider)` | `providers.api_registry` | `unregister_api_provider` |
| `ctx.client(module)` | the list served at `/api/plugins/client` | dropped with the context |
| `ctx.effect(dispose, label)` | anything else | the given callable |

`ctx.dispose()` runs the disposers in reverse order, collects their errors instead of stopping, and empties `ctx.contributions`, the per-kind record the Plugins page and the `plugin` tool show.

Agents declared in the manifest are created as `<plugin>-<name>` when missing and are **not** removed on disable: deleting an agent deletes its sessions. Shipped provider directories win a name clash with a plugin's.

## 3. Events: notify, gate, transform

`events/registry.py` gives every event a kind:

- **notify** — observers; return values are ignored.
- **gate** — may veto (`tool.before`).
- **transform** — each rewriter receives `(event, value)` and returns the new value; `None` keeps it, and a rewriter that raises is skipped.

`tool.result` is a transform event. `agent_loop._rewrite_tool_result` joins the result's text blocks, emits the transform, and replaces the text with the rewritten string while keeping images and audio. When no rewriter is subscribed the result object passes through untouched. Shell hooks cannot subscribe to transform events.

## 4. Services

`plugins/services.py` is a small name → object registry. `BUILTIN_SERVICES` names what the host exposes (the tool registry, the event bus, context components, skills, MCP servers, agents, slash commands and so on). `ctx.provide` refuses a built-in name and a name another plugin owns; `ctx.service` raises a `KeyError` listing the available names. A plugin that needs another plugin's service lists it in `requires`.

## 5. Web slots

A plugin's `client` modules are ES modules served from its directory at `/api/plugins/<name>/client/<path>?rev=<mtime>`; the route serves only files under the declared modules' directories. `apps/web/lib/plugins/slots.ts`:

- fetches `/api/plugins/client` and `/api/plugins/sidebar` when the shell mounts and on every `plugins:changed` frame;
- imports each new URL with `import(/* webpackIgnore: true */ url)` and calls its `setup(api)`;
- unloads modules whose URL disappeared or changed — a changed file has a new `rev`, so a reload swaps the module — by running every `api.slot` removal and the cleanup `setup` returned.

`<PluginSlot name>` renders the components placed in a slot, each inside an error boundary, and renders nothing while the slot is empty. The slots are `sidebar.nav`, `sidebar.footer`, `tabstrip.actions`, `tool.result` (under each finished tool call) and `plugin.settings` (inside the plugin's own detail dialog). The list is shared with `CLIENT_SLOTS` in `openprogram/plugins/inspect.py`; a unit test keeps the two equal.

The API given to `setup` is `{React, plugin, slot, text, useTranslation, fetch, json, navigate}`. Components use the page's React, so hooks work, and requests carry the owner cookie.

## 6. Self-description and the agent tool

`openprogram/plugins/inspect.py` builds `describe()` from the live registries: the context methods with their signatures, manifest keys, every event with its kind and the method to subscribe with, the services, the slots and the client API. `guide()` is the same as text. They back `GET /api/plugins/inspect`, `openprogram plugins inspect [--json]` and the `plugin` tool.

The `plugin` tool (`programs/tools/runtime/plugin.py`) lets an agent extend OpenProgram without editing its source: `guide`, `inspect`, `list`, `install` (link, trust as community, enable), `enable`, `disable`, `reload`, `uninstall`. It runs in the worker process (`_run_in_worker`) so registrations land in the live registries, requires approval, and is unavailable on chat channels and in plan mode.

The CLI's `enable`, `disable`, `install`, `uninstall` and `reload` call the running worker's HTTP API first, so the change takes effect at once, and fall back to editing the state files when no worker is running.

## Implementation status

Implemented as described. Not implemented: per-plugin process isolation (plugin code shares the worker process; the trust gate is the only boundary), and Web slots other than the five above.
