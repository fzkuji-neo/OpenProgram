# 操控电脑与浏览器

OpenProgram 给模型两个处理"屏幕上的事"的工具。`web_use` 驱动 App 内置浏览器和无头 Chromium 里的网页；`computer_use` 在后台驱动其他任何 macOS 应用。这份记录解释为什么恰好是两个、`computer_use` 怎么实现，以及两者相对 Codex 和 Claude 桌面 App 还缺什么。

## 为什么是两个工具，为什么是这两个

Codex（ChatGPT.app）只暴露一个工具 `cua_repl`：模型针对一个 `cua` 对象写 JavaScript，它的目标——`cua.getApp(name)` 得到的应用、`cua.createBrowserTab(...)` 得到的标签页——共用一套 API（`getAXState`、`click`、`drag`、`scroll`、`selectText`、`setValue`、`performSecondaryAction`，应用额外有 `paste`、`pressKey`、`typeText`）。哪个后端处理哪个目标由目标种类决定，不由模型挑选。

Claude 桌面 App 暴露成组的多个工具：`app_*` 后台控制单个应用（列窗口、截图、放大、点击、输入、按键、滚动、拖拽、菜单、AX 查找、聚焦、批量），接管真实指针和键盘的显示器级"完全控制"一组，浏览器工具，虚拟机用的 `framebuffer_*`，以及按应用的申请/释放一对。

OpenProgram 取 Codex 的形态、Claude App 的词汇：

- **每个表面一个工具，结构化参数。**模型不写代码来驱动窗口。`computer_use(action=…, app=…, …)` 和 `web_use(command=…, …)` 都是带 JSON schema 的普通函数调用，harness 的其余部分——审批卡片、权限规则、工具展示、延迟加载——本来就认识这种形态。
- **模型不选后端。**网页是 `web_use` 的目标，应用是 `computer_use` 的目标。旧 GUI Agent 方案里那个在桌面、浏览器、虚拟机后端之间挑选的 planner，普通任务不需要；它的工作流原样保留，不是这两个工具的入口。
- **一切在后台。**经 Accessibility API 的元素动作和路由到进程的指针事件不移动用户的光标、不改 key window、不把窗口提到前面。像 Claude App 那样的前台"完全控制"档位有意不做：后台通道已经覆盖了坐标点击、拖拽和滚轮。
- **按应用审批。**用户心里的单位是"能不能碰备忘录"，不是"能不能点击"。规则是 `computer_use(<app>)`，可以授予一次、授予本对话或授予本项目。

## `computer_use`

### 形态

```
computer_use(action, app, element_index | x,y, …)
```

动作分三组：

- **读取：**`list_apps`、`list_windows`、`get_app_state`（`include` = all / tree / screenshot，`window` 或 `window_id`）、`zoom`（以完整像素密度查看上一张截图的一块区域）、`find`（在上一棵树里按文字和角色查找）。
- **执行**，即 Codex 的目标 API：`click`（按钮、次数、按住的修饰键、按住时长）、`type_text`、`press_key`、`set_value`、`scroll`（按页或按像素）、`drag`、`perform_secondary_action`、`select_text`、`paste`；以及来自 Claude App `app_*` 一组的 `copy`、`focus`、`menu`、`show_window`。
- **`batch`：**对同一个应用按顺序执行至多 20 个执行类步骤，遇到第一个错误即停止；最后只等待稳定一次、只返回一次状态。

只有 `list_apps` 免审批。批量里的步骤不能指定别的应用，因为这次调用携带的审批只点名批量本身的应用。

每个执行动作的调用返回 `Done: <摘要>`，后面跟 Accessibility 树相对模型上次所见状态的 **diff**：`- 行` 是消失的元素，`+ 序号 行` 是新增或变化的。变化行数超过一半（且至少十二行）时改为返回整棵树，因为重建后视图的 diff 比视图本身还长。`get_app_state(full=true)` 按需返回全树。树上限 1500 个节点，每元素一行：序号、角色（`AXTextField` → `text field`，子角色放括号里）、标签、值、占位符、标记（`focused`、`selected`、`checked`、`disabled`、`secure`、`settable`……）以及除主按压之外的次级动作。有些应用给数字包上的双向文字标记会从渲染和 `find` 中去掉。

树覆盖窗口、它旁边的菜单、弹出框和对话框，以及只展开已打开菜单的菜单栏。未打开的菜单由 `menu` 动作读取，所以每次读取的范围一致，diff 里不会出现整条菜单栏凭空出现或消失。

没有改变任何东西的结果会被标记：`menu` 的列表、`copy` 和窗口本已可见时的 `show_window` 返回 `Report`，工具直接返回它，不等待稳定，也不再读取状态。

### 稳定序号

`tree.number` 参照窗口上一次的 `Snapshot`（不含序号的各行、它们的序号和下一个未用序号）分配序号。相同的行，或被同深度同角色的行替换（值变了、按钮改名），保留原序号；其他新行取下一个未用序号。被移除元素释放的序号永不复用。因此模型先前拿到的序号在其上方插入新元素后也不会指向别的元素——Codex 按位置编号做不到这一点。

### 等待稳定

动作之后，工具从 0.3 秒起每 0.2 秒对前 400 个元素取一次轻量指纹，两次指纹一致即停止；最多 1.5 秒，存在忙碌指示器或未完成的进度指示器时最多 5 秒——对应 Codex 的"约一秒，加载时最多五秒"。

### 菜单栏

`menu` 按标题遍历 `AXMenuBar`，不分大小写，忽略末尾的 `…` 或 `...`。路径停在子菜单时列出其菜单项，带快捷键符号（由 `AXMenuItemCmdModifiers` 得到 `⌃⌥⇧⌘`）、`[checked]` 和 `[disabled]`；末端项用 `AXPress` 按下。经 Accessibility 读菜单树不会在屏幕上打开任何东西。`copy` 按下应用自己快捷键为 ⌘C 的菜单项——按快捷键而非本地化标题查找——找不到时退回发送 ⌘C；该菜单项存在但被禁用（没有选区，或焦点在控件上）时立即如实报告。否则它等待粘贴板的 change count 变化，读出字符串，再恢复先前的粘贴板。

不带 `element_index` 的 `copy`、`press_key`、`type_text` 和 `paste` 作用于应用当前的焦点，不需要先 `get_app_state`；`menu` 和 `show_window` 从不需要。`focus` 设置 `AXFocused` 并最多等半秒让应用报告它，因为应用会在之后的 run loop 轮次才应用焦点。

截图是经 ScreenCaptureKit 抓取的窗口自身图像，缩放到长边至多 1568 像素；模型发来的坐标是这张图上的像素，用生成它的比例映射回屏幕点。

### 模块布局

| 模块 | 职责 |
|---|---|
| `openprogram/computer_use/keys.py` | xdotool 组合键解析为 macOS 键码和修饰键标志（`super+shift+z`、`ctrl++`、`KP_0`、单独修饰键） |
| `openprogram/computer_use/tree.py` | `Node`、渲染、签名、稳定编号（`Snapshot`、`number`）和 diff |
| `openprogram/computer_use/skylight.py` | SkyLight 的 ctypes 绑定，用于后台指针和键盘路由 |
| `openprogram/computer_use/macos.py` | `MacComputer`：应用解析、窗口选择、抓图、树遍历、全部动作 |
| `openprogram/programs/tools/system/computer_use.py` | 注册的工具：schema、含确认策略的说明、审批理由、批量、结果拼装 |

### 后台投递

元素动作走 Accessibility：`AXPress` / `AXConfirm` / `AXPick`，然后 `AXSelected`，然后聚焦，最后才在元素中心做一次指针点击；右键用 `AXShowMenu`；`set_value` 用 `AXValue`；`select_text` 用 `AXSelectedTextRange`（UTF-16 偏移）；`scroll` 先用翻页动作，再用滚动条的值，再用滚轮事件。

必须真实发生的指针事件（坐标点击、拖拽、滚轮）按开源 cua-driver 确立的配方投递：向目标进程序列号发一条不提升窗口的聚焦记录、一个 `mouseMoved` 预热事件、给事件打上点击状态、按钮、子类型 3、目标 pid、窗口 id 和点击组，`CGEventSetWindowLocation` 设定窗口相对位置，`SLEventPostToPid` 送达。键盘事件附带 `SLSEventAuthenticationMessage` 以便接收进程接受；没有 SkyLight 时回退到 `CGEventPostToPid`。结果是应用把这次点击当成用户点击来处理，而真实光标留在原地、前台应用不变。

窗口由 `window`（标题子串或序号）或 `window_id` 选定；两者都不给时，模型上次读过的窗口只要还开着就保持选中，否则取焦点窗口或主窗口。最小化的窗口或被隐藏的应用仍然给出树；截图要等 `show_window` 取消最小化（`AXMinimized`）或取消隐藏应用后才有，这两者都不会激活应用。在另一个桌面空间的窗口会如实报告，不会被移动。

`paste` 写入粘贴板（纯文本，或用 `markdown-it` 从 Markdown 渲染出的 HTML），向目标进程发 Cmd+V，并在 change count 表明期间没有别人写入时恢复先前的粘贴板内容。

### 拒绝

工具从不向 `AXSecureTextField` 元素输入，macOS 报告安全键盘输入（`kCGSSessionSecureInputPID`）期间也不输入，并拒绝以钥匙串访问、密码、loginwindow、SecurityAgent 和 OpenProgram 自身的 bundle 为目标。拒绝以错误返回并请用户来做这一步；任何审批范围都不能覆盖它。

### 权限与审批

`requires_approval` 对除 `list_apps` 外的每个动作返回 `computer_use controls <app>`。`parse_command` 把一次调用归约为规范化的应用名，于是 `exact_rule_for_call` 得到 `computer_use(calculator)`，`rule_to_string` 以常规形式打印。审批卡片提供四个范围：

| 范围 | 规则保存在哪 |
|---|---|
| once | 不保存 |
| session | 会话的 run config（`permission_rules.allow`）——`computer_use` 是 `_SESSION_SCOPE_TOOLS` 里的第一个工具 |
| always | 项目规则 |
| deny | 不保存 |

这项授权在所有权限模式下都是强制的。`permission_decision` 把 `computer_use` 当作按应用授权的工具（`_APP_GRANT_TOOLS`）：当工具自身的 `requires_approval` 表明这次调用需要审批、且没有允许规则点名该应用时，决定是 `ask`，理由 `APP_GRANT_REQUIRED`，先于 Auto 分类和 Bypass。因此无人值守的来源会拒绝这类调用，允许规则是越过卡片的唯一途径。

权限规则在每个操作边界重新加载（全局 < 项目 < 会话），所以会话规则对下一次调用立即生效，无需重启。

系统访问：`computer_use:desktop` 同时是 `accessibility` 和 `screen_recording` 两项能力的操作；`_desktop_operation` 把除 `list_apps` 外的每次调用映射到它，于是缺少授权时调用进入标准的"等待"状态并走设置 → 系统访问流程，与 GUI Agent 的桌面表面完全一致。

工具在 `DEFAULT_TOOLS` 里但被延迟加载（`DEFERRED_DEFAULT_TOOLS`）：schema 留在目录中直到模型加载它。`unsafe_in` 在微信、Telegram 渠道和规划模式下隐藏它。

### Web 展示

`tool-presentation.ts` 用显示器图标和 system 色调渲染 `computer_use` 调用；标题写动作和应用（"在 Calculator 中点击"），目标行在给了按键、文本、动作名或窗口时显示它们。审批卡片的范围按钮在"允许一次"和"始终允许"之间加入"允许此对话"，答案摘要打印"允许此对话"。GUI Agent 内部的桌面 capability 也叫 `computer_use`；Web 按参数形状区分两者（`isGuiToolCall`）：只有不带 `action` 参数的调用才是由 GUI 视图渲染的 GUI Agent 步骤。

## 浏览器：`web_use` 有什么、缺什么

`web_use` 现状：`observe`，`act` 含 `screenshot`、`navigate`、`click`、`type`、`press`、`scroll`、`hover`、`select`、`upload`，`verify` 含文本、URL、标题、元素和文件断言，三个后端（Playwright MCP、Chrome DevTools MCP、App 自带 Chrome）。

相对 Codex 目标 API 的差距：

| 能力 | Codex | `web_use` |
|---|---|---|
| 右键/中键/双击、带修饰键点击 | `click(target, {mouseButton, clickCount, key})` | 仅左键单击 |
| 拖拽 | `drag(from, to)` | — |
| 按 ref 滚动指定元素 | `scroll(index, direction, pages)` | 按量滚动页面 |
| 追加输入 vs 替换值 | `typeText` / `setValue` | 仅 `type` |
| 粘贴文本、Markdown 或 HTML | `paste(text, {format})` | — |
| 选中文本或放置光标 | `selectText` | — |
| 带时长的按键、无目标的按键 | `pressKey(key, {durationMs})` | 带 ref 的 `press` |
| 后退/前进/刷新 | 标签页方法 | 仅 `navigate(url)` |
| 新标签页，可见或隐藏 | `createBrowserTab(kind, url, {visible})` | 每会话一个页面 |
| 受控的 JavaScript 求值 | `evaluate` | — |
| 以 diff 形式观察 | `getAXState({diff: true})` | 每次全量快照 |

这些逐项加进 `web_use` 的 `act` 词汇，复用 `computer_use` 已有的参数名（`mouse_button`、`click_count`、`key`、`pages`、`format`、`selection_type`），让两个工具读起来一致。

## 界面工作

计划中，先出预览：

- 一个"操控电脑"设置页，列出项目允许的应用并可移除，以及当前对话的会话级允许；
- 浏览器标注模式和落到输入框的区域截图；
- 输入框里 `@` 提及打开的标签页和运行中的应用，让"这个标签页"无需模型猜测。

Windows 和 Linux 后端（UI Automation；AT-SPI 加 xdotool）沿用同一个 `MacComputer` 接口，尚未开始。

## 与 GUI Agent 的关系

GUI Agent 工作流（`gui_agent`）、它的 grounding 流水线和能力 planner 保持不变。`computer_use` 不调用它，它也不调用 `computer_use`。该工作流日后是否变成一个经通用 `agent` 工具运行在 `computer_use` 之上的轻量子 agent，是悬而未决的决定，只在基础工具完备后再做。

## 实现状态

- 已实现：macOS 上 `computer_use` 的上述读取、执行与批量动作，稳定序号，自适应等待，后台指针与键盘投递，树 diff，四个范围的按应用审批，系统访问门控，Web 展示，按键/树编号/菜单匹配/批量/规则/审批接线的单元测试。
- 未实现：浏览器差距表的每一行；电脑音频录制；把窗口从另一个桌面空间移过来；设置页、标注模式、区域截图和 `@` 提及；Windows 与 Linux 后端；给 Accessibility 树为空的应用准备的感知回退（目标检测与 OCR）。
