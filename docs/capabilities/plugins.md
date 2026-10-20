# Plugins

A plugin is a packaged extension: a pip / npm / git / local package with a manifest that, once installed into the host, contributes commands, skills, MCP servers, providers, hooks, agents, sidebar items, web pages, and more to OpenProgram. This page covers installing and managing plugins, and what a plugin looks like.

## Install and manage

```bash
openprogram plugins list                 # installed plugins
openprogram plugins search <query>       # search the configured marketplaces
openprogram plugins install pip <package>       # source is one of four: pip / npm / git / path
openprogram plugins install git <url> --ref v1.2
openprogram plugins install path /abs/path/to/plugin
openprogram plugins update --all         # reinstall-upgrade pip / npm plugins (or pass one name)
openprogram plugins enable <name>
openprogram plugins disable <name>
openprogram plugins reload <name>         # re-import its code after editing
openprogram plugins uninstall <name>       # for a linked local plugin, removes only the link
```

Git clones and npm packages land under `~/.openprogram/plugins/`, and a local path is linked there so edits apply on `reload` (npm under its `node_modules/`); pip plugins install into the running Python environment and are discovered via the `openprogram.plugins` entry-point group. Trust levels (`verified` / `community` / `untrusted`; unlisted plugins default to `untrusted`, and a local `path` install is trusted as `community`) persist in `~/.openprogram/plugin-trust.json`. The web UI exposes the same management API through the plugin routes.

## What a plugin looks like

A directory (or installed package) carrying one of three manifests, resolved in this priority order:

1. `plugin.json` (top-level file, claude-code / hermes style)
2. `[tool.openprogram.plugin]` in `pyproject.toml`
3. the `"openprogram"` field in `package.json` (opencode style)

Manifest fields include `name`, `version`, `description`, `trust` (community / verified), `entrypoints`, `sidebar`, `options`, and `requires`. `requires` declares inter-plugin dependencies: the loader enables plugins in topological order and reports `missing dependencies: ...` when one is absent.

At load time the module named by `entrypoints` is imported (a pip entry point's `module:obj`, or the `python` / `module` key in the manifest). Through that import the plugin exposes its commands / skills / mcpServers / providers / hooks / agents / sidebar / web entries to the contribution registry, and each host subsystem reads from the registry and wires them in.

## Write a plugin

The quickest plugin is a directory with `plugin.json` and a Python file whose `setup(ctx)` registers things through the context. Every registration is undone when the plugin is disabled or reloaded, so `reload` swaps in edited code without restarting the worker.

```json
{"name": "word-tools", "version": "0.1.0", "python": "./plugin.py", "client": "./client.js"}
```

```python
# plugin.py
def setup(ctx):
    @ctx.tool
    def word_count(text: str) -> int:
        """Count the words in a text."""
        return len(text.split())

    # A section of the system prompt (layer L0, L1 or L2).
    ctx.context("style", lambda agent: "Answer in short sentences.")

    # Rewrite what the model sees from a tool; return None to keep it.
    ctx.transform("tool.result", lambda event, text: text.replace("SECRET", "***"))

    ctx.on("turn.end", lambda event: ctx.log.info("turn finished"))
    ctx.command("summarize", "Summarize the conversation so far.", "Short summary")
```

```bash
openprogram plugins install path /abs/path/to/word-tools   # links the directory
openprogram plugins enable word-tools
openprogram plugins reload word-tools                      # after editing its files
openprogram plugins inspect                                # everything ctx can register
```

`ctx` also offers `skills(dir)`, `mcp_server(name, config)`, `provider_root(dir)`, `api_provider(api, provider)`, `provide(name, value)` / `service(name)` for sharing objects between plugins, `effect(dispose)` for undoing anything else, and `ctx.options` for the plugin's saved options. `openprogram plugins inspect --json` lists every method with its signature, every event with its kind (notify events take `ctx.on`, gate events `ctx.gate`, transform events `ctx.transform`), and the available services.

The same things can be declared in the manifest instead of code: `tools` (a module or package with `PROGRAM_ENTRIES`), `skills`, `commands`, `hooks`, `mcpServers` (Claude Code's `.mcp.json` shape is accepted), `providers`, `agents`, `client`, `web` and `sidebar`. Agents a plugin declares stay after it is disabled, because deleting an agent would delete its sessions.

### Web UI

A `client` module is an ES module whose default export receives the page's plugin API and places React components into slots:

```js
// client.js
export default function setup(api) {
  const { React } = api;
  api.slot("tool.result", ({ tool, result }) =>
    tool === "word_count"
      ? React.createElement("div", { className: "text-xs" }, api.text(`${result} words`, `${result} 个词`))
      : null);
}
```

| Slot | Where | Props |
|---|---|---|
| `sidebar.nav` | under the sidebar's main navigation | — |
| `sidebar.footer` | above the account row | — |
| `tabstrip.actions` | right end of the top tab strip | — |
| `tool.result` | under every finished tool call; return `null` for other tools | `tool`, `args`, `result`, `isError` |
| `plugin.settings` | in the plugin's own detail on the Plugins page | `plugin` |

The API also has `api.useTranslation()`, `api.fetch(path)` / `api.json(path)` for authenticated requests to the backend, and `api.navigate(href)`. `setup` may return a cleanup function. Modules reload in the open page whenever the plugin is enabled, disabled or reloaded. A `sidebar` entry in the manifest (`{"label": "Word tools", "label_zh": "词工具", "page": "index.html"}`) adds a row that opens the plugin's `web` directory at `/plugin/<name>/`.

### Let an agent write it

Agents have a `plugin` tool (approval required, not offered on chat channels or in plan mode). `guide` returns the authoring guide above, generated from the running build; after writing the files, `install` with the directory's absolute path links, trusts and enables the plugin in one step, and `reload` applies later edits.
