<div id="plugins"></div>

# 插件

插件是打包好的扩展：一个带 manifest 的 pip / npm / git / 本地包，装进宿主后向 OpenProgram 贡献 commands、skills、MCP server、providers、hooks、agents、侧边栏项、web 页面等。这一页讲插件怎么装、怎么管，以及插件长什么样。

## 安装与管理

```bash
openprogram plugins list                 # 已安装插件
openprogram plugins search <query>       # 在配置的 marketplace 里搜索
openprogram plugins install pip <package>       # 来源四选一：pip / npm / git / path
openprogram plugins install git <url> --ref v1.2
openprogram plugins install path /abs/path/to/plugin
openprogram plugins update --all         # 重装升级 pip / npm 来源的插件（也可以只传一个名字）
openprogram plugins enable <name>
openprogram plugins disable <name>
openprogram plugins reload <name>         # 改完代码后重新导入
openprogram plugins uninstall <name>       # 链接进来的本地插件只删链接
```

git 克隆和 npm 包落在 `~/.openprogram/plugins/` 下，本地路径以链接形式放在这里，改动在 `reload` 后生效（npm 在其 `node_modules/` 里）；pip 插件装进当前 Python 环境，靠 `openprogram.plugins` entry-point group 被发现。信任等级（`verified` / `community` / `untrusted`，未登记的插件默认 `untrusted`，本地 `path` 安装记为 `community`）持久化在 `~/.openprogram/plugin-trust.json`。Web UI 通过插件路由暴露同一套管理 API。

## 插件是什么形态

一个目录（或已安装的包），带三种 manifest 之一，解析优先级从高到低：

1. `plugin.json`（顶级文件，claude-code / hermes 风格）
2. `pyproject.toml` 里的 `[tool.openprogram.plugin]`
3. `package.json` 里的 `"openprogram"` 字段（opencode 风格）

manifest 字段包括 `name`、`version`、`description`、`trust`（community / verified）、`entrypoints`、`sidebar`、`options`、`requires`。`requires` 声明插件间依赖：加载器按拓扑序决定 enable 顺序，缺依赖时报 `missing dependencies: ...`。

加载时导入 `entrypoints` 指向的模块（pip entry point 的 `module:obj`、或 manifest 里的 `python` / `module` 键），插件由此向贡献注册表暴露自己的 commands / skills / mcpServers / providers / hooks / agents / sidebar / web 入口，宿主各子系统从注册表读取并接合。

## 写一个插件

最快的插件是一个目录：一个 `plugin.json`，加一个 Python 文件，在 `setup(ctx)` 里经 context 注册东西。插件被停用或重载时，每一项注册都会撤销，所以 `reload` 不重启 worker 就能换上改过的代码。

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

    # 系统提示词的一段（层级 L0、L1 或 L2）。
    ctx.context("style", lambda agent: "Answer in short sentences.")

    # 改写模型从工具看到的内容；返回 None 则保留原样。
    ctx.transform("tool.result", lambda event, text: text.replace("SECRET", "***"))

    ctx.on("turn.end", lambda event: ctx.log.info("turn finished"))
    ctx.command("summarize", "Summarize the conversation so far.", "Short summary")
```

```bash
openprogram plugins install path /abs/path/to/word-tools   # 链接这个目录
openprogram plugins enable word-tools
openprogram plugins reload word-tools                      # 改完文件后
openprogram plugins inspect                                # ctx 能注册的全部内容
```

`ctx` 还提供 `skills(dir)`、`mcp_server(name, config)`、`provider_root(dir)`、`api_provider(api, provider)`、在插件间共享对象的 `provide(name, value)` / `service(name)`、撤销其它任何事情的 `effect(dispose)`，以及插件已保存选项 `ctx.options`。`openprogram plugins inspect --json` 列出每个方法及签名、每个事件及其 kind（notify 事件用 `ctx.on`，gate 事件用 `ctx.gate`，transform 事件用 `ctx.transform`），以及可用的服务。

这些也可以不写代码、直接在 manifest 里声明：`tools`（带 `PROGRAM_ENTRIES` 的模块或包）、`skills`、`commands`、`hooks`、`mcpServers`（接受 Claude Code 的 `.mcp.json` 形式）、`providers`、`agents`、`client`、`web` 和 `sidebar`。插件声明的 agent 在插件停用后保留，因为删除 agent 会删除它的会话。

### Web 界面

`client` 模块是一个 ES module，默认导出接收页面的插件 API，把 React 组件放进插槽：

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

| 插槽 | 位置 | Props |
|---|---|---|
| `sidebar.nav` | 侧栏主导航下方 | — |
| `sidebar.footer` | 账号行上方 | — |
| `tabstrip.actions` | 顶部标签栏右端 | — |
| `tool.result` | 每个已完成的工具调用下方；其它工具返回 `null` | `tool`、`args`、`result`、`isError` |
| `plugin.settings` | Plugins 页里该插件自己的详情 | `plugin` |

API 还有 `api.useTranslation()`、向后端发带鉴权请求的 `api.fetch(path)` / `api.json(path)`，以及 `api.navigate(href)`。`setup` 可以返回一个清理函数。插件启用、停用或重载时，已打开的页面里的模块随之重新加载。manifest 里的 `sidebar` 项（`{"label": "Word tools", "label_zh": "词工具", "page": "index.html"}`）会加一行，打开插件的 `web` 目录 `/plugin/<name>/`。

### 让 agent 来写

agent 有一个 `plugin` 工具（需要审批；聊天渠道和 plan 模式下不提供）。`guide` 返回上面的编写指南，由当前运行的版本生成；写好文件后，用目录的绝对路径调用 `install`，一步完成链接、信任和启用，之后的修改用 `reload` 生效。
