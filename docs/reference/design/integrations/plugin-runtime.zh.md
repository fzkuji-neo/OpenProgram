# 插件运行时

已启用插件的代码怎样在 worker 里运行，以及它加进来的一切怎样被完整撤掉。manifest 形式、来源、marketplace 和信任级别见 [Skills & Plugins](skills-and-plugins.zh.md)；这份记录讲 enable 到 disable 之间发生的事。

模型沿用 Cordis（Koishi 和 DeepSeek Harness 背后的插件内核），搬到 Python：插件是一个关于 context 的函数，经这个 context 做的每次注册都是一个带 disposer 的 *effect*，dispose 这个 context 就把插件完整撤掉。没有单独的"插件专用注册表"：每个 effect 都写进宿主本来就用于这类东西的注册表。

## 1. 生命周期

```
rescan ──► Plugin(manifest)          启用集合：~/.openprogram/plugins-enabled.json
load_plugin(name)
  _check：信任、兼容性、requires（依赖必须先加载）
  _activate：
     PluginContext(name, root, options)
     manifest 键    ──► ctx effect（tools、skills、commands、hooks、mcpServers、
                                    providers、agents、client、sidebar、web）
     python 入口    ──► setup(ctx)   （返回的 callable 成为又一个 effect）
     任何异常       ──► ctx.dispose()、驱逐模块、错误留在 plugin 上
  发出 plugin.enable，广播 plugins:changed
unload_plugin(name)
  发出 plugin.disable ──► ctx.dispose()（逆序执行 effect）──► 驱逐模块
reload_plugin(name) = unload + rescan + load   （新代码失败时插件仍保持启用）
```

- **启动。** `apps/server/openprogram_server/server.py` 在 MCP server 启动后运行 `_load_plugins`：把事件循环交给 `plugins.context.set_host_loop`，在线程里调用 `loader.load_enabled()`，按依赖顺序加载启用集合，每个失败只记日志，不挡其它插件。
- **rescan 保留运行中的插件。** rescan 找到同一 root 的已加载插件时保留它的 context；root 变了则先停用。
- **模块驱逐。** 停用时，文件位于插件目录下的所有模块和合成的 `openprogram_plugin_<name>.*` 模块都离开 `sys.modules`，所以 reload 导入的是当前磁盘上的代码。pip 插件的模块在 site-packages，不驱逐。
- **本地插件是链接。** `install path <dir>` 把 `~/.openprogram/plugins/<name>` 链接到该目录，改文件后 reload 即生效，uninstall 只删链接。

## 2. Context

`openprogram/plugins/context.py` 定义 `PluginContext`。每个方法经现有宿主注册表注册，并记下撤销：

| Effect | 宿主注册表 | 撤销 |
|---|---|---|
| `ctx.tool(fn, **options)` / `ctx.tools_from(module)` | `programs._runtime`，经 `register_workflow_entries(owner="plugin:<name>")`——与内置工具相同的 `PROGRAM_ENTRIES` 规则 | `unregister` |
| `ctx.on` / `ctx.gate` / `ctx.transform` | `EventBus.subscribe` / `subscribe_gate` / `subscribe_transform`，按 `events/registry.py` 中事件的 kind 校验 | 订阅的 disposer |
| `ctx.context(name, build, layer, order)` | `context.components`（L0–L2），名字为 `plugin:<plugin>:<name>` | `components.unregister` |
| `ctx.provide(name, value)` / `ctx.service(name)` | `plugins/services.py` | 撤回 |
| `ctx.command(name, prompt, description)` | `contrib["_commands"]`，由 commands 注册表适配器读取 | 随 contributions 清空 |
| `ctx.skills(dir)` | `skills` 的插件来源 | 注销该来源 |
| `ctx.mcp_server(name, config)` | `mcp` 管理器 `add_server`，名为 `<plugin>_<name>`，调度到宿主事件循环；不写入 `mcp_servers.json` | `remove_server` |
| `ctx.provider_root(dir)` | `providers/plugin_dirs.py`，`provider.json` 查找背后的搜索路径 | 移除该 root |
| `ctx.api_provider(api, provider)` | `providers.api_registry` | `unregister_api_provider` |
| `ctx.client(module)` | `/api/plugins/client` 返回的列表 | 随 context 丢弃 |
| `ctx.effect(dispose, label)` | 其它任何东西 | 给定的 callable |

`ctx.dispose()` 逆序执行 disposer，收集错误而不中断，并清空 `ctx.contributions`——Plugins 页和 `plugin` 工具展示的按类别记录。

manifest 声明的 agent 在缺失时创建为 `<plugin>-<name>`，停用时**不删除**：删除 agent 会删除它的会话。内置 provider 目录与插件的同名时，内置的优先。

## 3. 事件：notify、gate、transform

`events/registry.py` 给每个事件一个 kind：

- **notify**——观察者，返回值被忽略。
- **gate**——可以否决（`tool.before`）。
- **transform**——每个改写者收到 `(event, value)` 并返回新值；返回 `None` 保留原值，抛异常的改写者被跳过。

`tool.result` 是 transform 事件。`agent_loop._rewrite_tool_result` 拼接结果的文本块、发出 transform，用改写后的字符串替换文本，保留图片和音频。没有订阅者时结果对象原样通过。shell hook 不能订阅 transform 事件。

## 4. 服务

`plugins/services.py` 是一个小的名字 → 对象注册表。`BUILTIN_SERVICES` 列出宿主公开的东西（工具注册表、事件总线、context 组件、skills、MCP server、agents、斜杠命令等）。`ctx.provide` 拒绝内置名字和其它插件占用的名字；`ctx.service` 找不到时抛 `KeyError` 并列出可用名字。需要别的插件服务的插件把它写进 `requires`。

## 5. Web 插槽

插件的 `client` 模块是 ES module，从插件目录经 `/api/plugins/<name>/client/<path>?rev=<mtime>` 提供；该路由只提供已声明模块所在目录下的文件。`apps/web/lib/plugins/slots.ts`：

- 在 shell 挂载时和每个 `plugins:changed` 帧拉取 `/api/plugins/client` 和 `/api/plugins/sidebar`；
- 用 `import(/* webpackIgnore: true */ url)` 导入每个新 URL，并调用它的 `setup(api)`；
- 卸载 URL 消失或变化的模块——文件改了 `rev` 就变，所以 reload 会换掉模块——执行所有 `api.slot` 移除和 `setup` 返回的清理函数。

`<PluginSlot name>` 渲染放进某个插槽的组件，每个包在错误边界里，插槽为空时什么也不画。插槽有 `sidebar.nav`、`sidebar.footer`、`tabstrip.actions`、`tool.result`（每个已完成的工具调用下方）和 `plugin.settings`（插件自己的详情对话框里）。这份列表与 `openprogram/plugins/inspect.py` 的 `CLIENT_SLOTS` 共用，单元测试保持两者一致。

交给 `setup` 的 API 是 `{React, plugin, slot, text, useTranslation, fetch, json, navigate}`。组件使用页面自己的 React，所以 hook 可用，请求带 owner cookie。

## 6. 自描述与 agent 工具

`openprogram/plugins/inspect.py` 从实时注册表构建 `describe()`：context 方法及签名、manifest 键、每个事件的 kind 与订阅方法、服务、插槽和 client API。`guide()` 是同样内容的文本形式。它们支撑 `GET /api/plugins/inspect`、`openprogram plugins inspect [--json]` 和 `plugin` 工具。

`plugin` 工具（`programs/tools/runtime/plugin.py`）让 agent 不改源码就扩展 OpenProgram：`guide`、`inspect`、`list`、`install`（链接、信任设为 community、启用）、`enable`、`disable`、`reload`、`uninstall`。它在 worker 进程里运行（`_run_in_worker`），注册落到实时注册表；需要审批；在聊天渠道和 plan 模式下不可用。

CLI 的 `enable`、`disable`、`install`、`uninstall` 和 `reload` 先调用运行中 worker 的 HTTP API，让改动立即生效；没有 worker 时退回到直接改状态文件。

## 实现状态

按上文实现。未实现：按插件的进程隔离（插件代码与 worker 共用进程，信任闸门是唯一边界），以及上述五个之外的 Web 插槽。
