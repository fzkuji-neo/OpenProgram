# 操控电脑与浏览器

OpenProgram 给模型一个处理屏幕上所有事情的工具：`computer_use_agent`。它操作 macOS、Linux 和 Windows 上的应用，App 内置浏览器和无头 Chromium 里的网页，以及远程虚拟机。这份记录说明工具的形态、它如何只把需要的说明交给模型、点击目标如何变成屏幕位置、模型如何选择在当前上下文里做还是交给新 agent，以及底下的应用和浏览器后端如何实现。

## 给模型一块屏幕的三种做法

**Codex**（ChatGPT.app）只有一个执行工具，`cua_repl` MCP 服务里的 `js`：模型针对 `sky`（Mac 应用）和 `agent.browsers`（App 内浏览器、Chrome）写 JavaScript。知识放在三个 skill 里，`computer-use`、`control-in-app-browser` 和 `control-chrome`，每个约 3,200–3,400 token。上下文里每个 skill 只有一行；任务需要时模型自己去读 `SKILL.md`，浏览器 skill 还要它在 `js` 里运行 `documentation()` 取浏览器 API 参考。加载要花两三次模型调用，跳过阅读的模型就不知道 API。

**Claude Code** 有许多小工具：内置浏览器的 `navigate`、`read_page`、`find`、`computer`、`form_input` 等二十个左右，完整 schema 常驻上下文；用户自己的 Chrome 另有一组，以名字形式延迟加载，直到 `ToolSearch` 载入。每个参数都有 schema 校验，但两组同名动词容易选错，常驻的一组在每个对话里都占上下文。

**OpenProgram** 取 Codex 的单一入口和 Claude Code 的结构化参数：

- **一个工具。** `computer_use_agent` 是模型看到的唯一屏幕工具。它的 schema 很小，对每个目标都一样；动作及其参数放在各目标的指南里。
- **指南随第一次调用到达。** 工具说明只是目标清单。对某个目标的第一次调用返回该目标的指南和它当前的状态（已安装和运行中的应用、打开的网页），所以指南不需要额外调用，也不依赖模型记得去读。
- **参数或代码。** 简单的步骤是结构化调用（`action` + `args`，或至多 20 个 `actions`）。带循环、条件或数据处理的步骤是一段 Python（`code`），在隔离解释器里运行，变量在调用之间保留。
- **由模型选择上下文。** `context: "inherit"`（默认）在当前对话里执行；`context: "fresh"` 启动一个干净上下文、带书面简报的 agent，只返回它的结果。
- **定位是一层。** 点击目标可以是元素序号、网页 ref、像素，或由视觉检测解析的文字描述。

## `computer_use_agent`

### 形态

```
computer_use_agent(target, action?, args?, actions?, code?, timeout?, context?, brief?)
```

| 参数 | 含义 |
|---|---|
| `target` | `app`、`browser` 或 `vm`；三者总在 schema 里，本机到不了的目标会回答如何配置 |
| `action`、`args` | 一个步骤及其参数；省略时打开该目标 |
| `actions` | 同一目标上至多 20 个 `{action, args}` 步骤，遇到第一个错误即停止；状态只返回一次 |
| `code` | 在隔离解释器里运行的 Python（见“代码”） |
| `timeout` | 代码调用可运行的秒数，至多 120（默认 60） |
| `context` | `inherit`（默认）或 `fresh` |
| `brief` | 配合 `fresh`：目标、已知事实、限制和要交回什么 |

`action`、`actions` 和 `code` 互斥。参数由目标校验，出错时指出正确写法，因为 schema 不列出每个动作的参数。

### 目标与指南

| 目标 | 后端 | 打开时返回 |
|---|---|---|
| `app` | `openprogram/computer_use/`（macOS、Linux X11、Windows） | 给了 `args.app`：它的状态（树和截图）；否则应用列表 |
| `browser` | `web_use` 运行时（App 的 Page、无头 Chromium）；`args.browser` 为 `chrome` 或 `edge` 时，是连接到用户浏览器的扩展模式 Playwright MCP | 网页列表（用户浏览器里是标签页列表） |
| `vm` | `computer_use.vm_url` 指向的 OSWorld 兼容服务 | 一张截图 |

每个目标有一份指南（`guides/<target>.md`；app 指南按 macOS、Linux、Windows 改写）：它的动作、参数、结果长什么样，以及确认策略。工具按对话和 agent 代记住已经发过哪些指南，把指南附在该目标的第一次结果上；`action: "guide"` 再次返回它，例如上下文压缩丢掉它之后。启动 fresh agent 时会忘掉那一代 agent 的指南记录，因为新 agent 只从自己的提示开始。

`app` 的动作就是下文应用后端的动作，参数相同；`browser` 的动作是 `web_use` 运行时的命令：`list_pages`、`observe`、`verify` 和 `close` 保持原名，每个 `act` 动作（`navigate`、`click`、`type`……）各自成为一个动作。与 Codex 一样，先选浏览器，动作不随浏览器改变。不写 `args.browser` 是经由 `web_use` 的内置浏览器；`chrome` 或 `edge` 是用户自己的浏览器，`web_use` 的后端都到达不了它。对这两者，`targets/browser.py` 把每一步交给 `workflow/browser/extension_browser.py`，它通过 `_SyncMCPClient` 运行 `@playwright/mcp --extension --browser chrome|msedge`（与 `web_use` 固定的版本相同），每个会话、每个浏览器一个服务器，在调用之间保持。服务器在该浏览器里打开带有其中继地址的 `chrome-extension://<id>/connect.html`，Playwright Extension 回连，并为用户共享的标签页中继 CDP；设置了 `computer_use.chrome_extension_token` 时，服务器传入 `PLAYWRIGHT_MCP_EXTENSION_TOKEN`，扩展不再询问直接连接。`list_pages`、`observe`、`close`、`screenshot`、`upload`、`evaluate`、日志和 `verify` 映射到服务器的标签页、快照、截图、文件、evaluate 和日志工具；所有元素和指针动作都经过 `OfficialMCPPageBackend._action_call`，即 `playwright_mcp` 后端对 App Page 使用的同一套翻译。ref 是服务器快照里的 ref。代码模式不为用户的浏览器注册资源。

### 定位

`grounding.py` 把步骤的目标变成后端接受的形式：

| 给出 | 解析为 |
|---|---|
| `element_index`（app）/ `ref`（browser） | 原样传递；后端作用在元素上 |
| `x`、`y` | 原样传递，是该目标上一张截图的像素 |
| `describe` | 上一张截图和文字交给 gui_harness 的 `locate_target`（GPA-GUI-Detector 图标、OCR 文字、保存的组件、模型核对、不确定时放大）；它的中心成为 `x`、`y` |

`describe` 只用于 `app` 和 `vm`，并且只在 gui_harness 及其感知依赖可导入时提供；否则指南说明它不可用。它在工具内部要花数次模型调用，所以指南把它排在序号和像素之后。gui_harness 本身不改动，只调用 `planning.component_memory.locate_target`。

### 代码

`code` 在 `backend/gui_runner.py` 的常驻沙箱解释器里运行（macOS 上用 seatbelt，没有文件、网络和进程权限）。命名空间里有 `cu.app`、`cu.browser` 和 `cu.vm`；`await cu.app.click(app="Numbers", element_index=3)` 就是带这些参数的结构化步骤 `click`，由宿主经同样的目标代码、定位和检查派发，每一步一条 effect 回执（`backend/gui_broker.py`）。代码调用要指定 `target`，对 `app` 还要指定 `args.app`；审批覆盖这个应用，作用于其他应用的步骤会被拒绝。代码里不能用 `evaluate`，因为每段页面脚本都需要单独审批。一个解释器服务一次执行尝试，所以变量在本轮剩余时间里保留；失败或超时后解释器会被替换。每次调用最多运行 120 秒、100 步。代码模式需要 macOS 沙箱；在其他系统上代码调用会报告沙箱不可用。

### 上下文

`context: "fresh"` 通过通用的 `agent` 派生（`_agent_impl`，`start_from="clean"`）把任务交给一个干净上下文的 agent：同一会话、同样的模型和思考设置，结果作为这次调用的结果返回。它的提示是简报、一行指明目标（及 `args.app`）、该目标的指南，以及在 `describe` 可用时建议：元素没有序号或 ref 时用它定位。截图和定位调用留在它自己的上下文里。派生深度限制让它不能再启动另一个。

派生出的 agent 无法请求审批，所以 `fresh` 调用替它带上：调用指定目标，对 `app` 还指定 `args.app`，并与直接调用走同样的审批。agent 运行期间，这次调用的确切规则被写成会话规则（已有时不重复写），agent 返回后删除，所以 agent 自己的调用能匹配它，而调用结束后不留下任何东西。

### 审批与访问

| 调用 | 审批 |
|---|---|
| `app`（`list_apps` 除外） | 按应用：规则 `computer_use_agent(<app>)`，在会询问的模式下必须；旧的 `computer_use(<app>)` 规则仍然匹配 |
| `browser` | 对话有 Page 时用本轮的 Page 授权；否则按权限模式；`evaluate` 每次调用单独审批一次 |
| 带 `args.browser` 的 `browser` | 用户的 Chrome 或 Edge，每个会话一次：规则 `computer_use_agent(browser:chrome)`（或 `browser:edge`），从不使用 Page 授权；`evaluate` 每次调用单独审批 |
| `vm` | 按服务地址：规则 `computer_use_agent(vm:<url>)` |
| `fresh` | 与它指定的目标相同 |

系统访问（辅助功能、屏幕录制）照常约束除 `list_apps` 之外的 `app` 调用。

### 模块布局

| 模块 | 作用 |
|---|---|
| `openprogram/programs/tools/system/computer_use_agent/tool.py` | 注册的工具：schema、目标清单、路由、指南记录、审批原因 |
| `…/computer_use_agent/guides/` | 各目标的指南 |
| `…/computer_use_agent/targets/app.py` | 基于 `openprogram/computer_use/` 的应用动作 |
| `…/computer_use_agent/targets/browser.py` | 基于 `web_use` 运行时的网页动作 |
| `…/computer_use_agent/targets/vm.py` | 经虚拟机服务 HTTP API 的截图和 pyautogui 输入 |
| `…/computer_use_agent/grounding.py` | 目标解析，包括 `describe` |
| `…/computer_use_agent/code.py` | 基于 `backend/gui_runner.py` 和 `gui_broker.py` 的代码模式 |
| `…/computer_use_agent/fresh.py` | 干净上下文的 agent |

没有单独的“规划 → 决策 → 执行 → 验证”循环：长任务交给使用同一工具的 `fresh` agent，gui_harness 只通过 `describe` 使用。它的 Program 仍可安装（`entries=False`，不注册自己的工具）。

## 应用后端

### 形态

```
computer_use_agent(target="app", action, args={app, element_index | x,y | describe, …})
```

动作分三组：

- **读取：**`list_apps`、`list_windows`、`get_app_state`（`include` = all / tree / screenshot，`window` 或 `window_id`）、`zoom`（以完整像素密度查看上一张截图的一块区域）、`find`（在上一棵树里按文字和角色查找）。
- **执行**，即 Codex 的目标 API：`click`（按钮、次数、按住的修饰键、按住时长）、`type_text`、`press_key`、`set_value`、`scroll`（按页或按像素）、`drag`、`perform_secondary_action`、`select_text`、`paste`；以及来自 Claude App `app_*` 一组的 `copy`、`focus`、`menu`、`show_window`。
- **多个步骤**（`actions`）：对同一个应用按顺序执行至多 20 个执行类步骤，遇到第一个错误即停止；最后只等待稳定一次、只返回一次状态。

只有 `list_apps` 免审批。`actions` 里的步骤不能指定别的应用，因为这次调用携带的审批只点名调用本身的应用。

每个执行动作的调用返回 `Done: <摘要>`，后面跟 Accessibility 树相对模型上次所见状态的 **diff**：`- 行` 是消失的元素，`+ 序号 行` 是新增或变化的。变化行数超过一半（且至少十二行）时改为返回整棵树，因为重建后视图的 diff 比视图本身还长。`get_app_state(full=true)` 按需返回全树。树上限 1500 个节点，每元素一行：序号、角色（`AXTextField` → `text field`，子角色放括号里）、标签、值、占位符、标记（`focused`、`selected`、`checked`、`disabled`、`secure`、`settable`……）以及除主按压之外的次级动作。有些应用给数字包上的双向文字标记会从渲染和 `find` 中去掉。

树覆盖窗口、它旁边的菜单、弹出框和对话框，以及只展开已打开菜单的菜单栏。未打开的菜单由 `menu` 动作读取，所以每次读取的范围一致，diff 里不会出现整条菜单栏凭空出现或消失。

没有改变任何东西的结果会被标记：`menu` 的列表、`copy` 和窗口本已可见时的 `show_window` 返回 `Report`，工具直接返回它，不等待稳定，也不再读取状态。

### 稳定序号

`tree.number` 参照窗口上一次的 `Snapshot`（不含序号的各行、它们的序号和下一个未用序号）分配序号。相同的行，或被同深度同角色的行替换（值变了、按钮改名），保留原序号；其他新行取下一个未用序号。被移除元素释放的序号永不复用。因此模型先前拿到的序号在其上方插入新元素后也不会指向别的元素——Codex 按位置编号做不到这一点。

### 等待稳定

动作之后，工具从 0.3 秒起每 0.2 秒对前 400 个元素取一次轻量指纹，两次指纹一致即停止；最多 1.5 秒，存在忙碌指示器或未完成的进度指示器时最多 5 秒——对应 Codex 的"约一秒，加载时最多五秒"。

### 菜单栏

`menu` 按标题遍历 `AXMenuBar`，不分大小写，忽略末尾的 `…` 或 `...`。路径停在子菜单时列出其菜单项，带快捷键符号（由 `AXMenuItemCmdModifiers` 得到 `⌃⌥⇧⌘`）、`[checked]` 和 `[disabled]`；末端项用 `AXPress` 按下。经 Accessibility 读菜单树不会在屏幕上打开任何东西。`copy` 按下应用自己快捷键为 ⌘C 的菜单项——按快捷键而非本地化标题查找——找不到时退回发送 ⌘C；该菜单项存在但被禁用（没有选区，或焦点在控件上）时立即如实报告。否则它等待粘贴板的 change count 变化，读出字符串，再恢复先前的粘贴板。

不带 `element_index` 的 `copy`、`press_key`、`type_text` 和 `paste` 作用于应用当前的焦点，不需要先 `get_app_state`；`menu`、`show_window` 和 `wait` 从不需要。来自 Claude computer-use 工具的有 `hover`（向进程投递三个逐步接近目标点的 `mouseMoved` 事件，再停留 0.8 秒；真实光标不动）和 `wait`（最多 10 秒，可取消，之后照常等待稳定并返回树 diff）。`focus` 设置 `AXFocused` 并最多等半秒让应用报告它，因为应用会在之后的 run loop 轮次才应用焦点。

截图是经 ScreenCaptureKit 抓取的窗口自身图像，缩放到长边至多 1568 像素；模型发来的坐标是这张图上的像素，用生成它的比例映射回屏幕点。

### 截图上的文字

窗口自身遍历出的元素少于 12 个（窗框、标题栏按钮之外几乎没有）时，说明它绕开了辅助功能自行绘制。对这样的窗口，每次完整读取或仅截图读取都会对刚拍下的截图运行 Vision 的精确文字识别，把每行列成 `"text" at (cx, cy), WxH`，单位是截图像素，按从上到下、从左到右排列，最多 150 行。识别语言列表的第一项决定 Vision 用哪个模型，所以语言只作提示（用户首选语言，然后是中文、日文、韩文和英文），由语言检测按每张图选择。`find` 带 `text` 时，若没有元素匹配就退回到这些文字行；对不稀疏的窗口，它会以相同比例重新抓取并识别一次，因此位置对动作仍然有效。OCR 文字没有序号，也不进入树的 diff：它是坐标动作的依据，识别器失败时读取结果里就不带它。同样的读取还会列出不带文字的图标和控件（`ocr.detect_shapes`）：Vision 的轮廓检测跑两遍，一遍找浅色窗口上的深色图形，一遍找深色上的浅色，长边最多 1024 像素。相距 3 点以内的顶层轮廓合并成一个形状；形状盖住两个字符以上的识别文字行、短边小于 8 点、长边大于 80 点、长宽比超过 4:1，或贴着截图边缘（窗口的圆角和边框）时丢弃。单字符的文字行不排除形状，因为识别器常把图标读成一个字。两遍都找到的形状只保留一次，按 16 点一行、从左到右排序，最多 60 个。形状没有名字：模型对照截图分辨齿轮和垃圾桶。

### 音频

Codex 用 `start_audio_recording` / `stop_audio_recording` 录电脑声音（默认 60 秒，最多 300 秒），并把录音作为音频输入交给模型。OpenProgram 保留这两个动作及其上限。录音落成磁盘上的 WAV，再加上设置 → 语音引擎给出的转写文字，任何模型都能读。`ToolReturn.audio` 还把 WAV 作为 `AudioContent` 块带上：模型的输入模态里有 `audio` 时，Gemini 转换器把它作为内联音频、Chat Completions 转换器把它作为 `input_audio`，放在那组工具结果之后的用户轮里（工具结果必须连在一起）。由于 `tool` 消息只能放文字，Chat Completions 的这个用户轮也为视觉模型带上那组结果里的截图。Responses 和 Anthropic 转换器跳过音频块，工具结果里的媒体也不写进对话历史，所以对听不了音频的模型没有额外开销。`audio.py` 打开一个 `SCStream`，过滤器是只包含目标应用的显示器，要求 16 kHz 单声道 float 采样，排除 OpenProgram 自身进程，并只挂音频输出：2×2、每秒一帧的视频那一侧从不被消费。超过上限的采样被丢弃，计时器在上限后半秒停掉流，所以忘了停止的录音也会释放采集。每个对话同时只有一段录音；停止时转成 16 位 PCM 并保存在状态目录下，保留最新的 20 个。这个动作沿用按应用的审批：录音里只有所指定应用的声音。峰值始终低于 1e-4 的录音报告为静音，不做转写。没有窗口的应用没有 `SCRunningApplication`，无法录音。

### 模块布局

| 模块 | 职责 |
|---|---|
| `openprogram/computer_use/base.py` | 各后端共用的部分：`ComputerUseError`、`Report`、`Observation`、`AudioClip`、参数检查、录音保存 |
| `openprogram/computer_use/backends.py` | 按主机给出 `support()` 和 `backend()`：Darwin 用 `macos`，Linux 用 `linux`，Windows 用 `windows` |
| `openprogram/computer_use/keys.py` | xdotool 组合键解析为 macOS 键码和修饰键标志（`super+shift+z`、`ctrl++`、`KP_0`、单独修饰键） |
| `openprogram/computer_use/tree.py` | `Node`、渲染、签名、稳定编号（`Snapshot`、`number`）和 diff |
| `openprogram/computer_use/audio.py` | 单个应用的 ScreenCaptureKit 音频采集、采样上限、WAV 编码 |
| `openprogram/computer_use/ocr.py` | Vision 文字识别（Linux 上为 tesseract TSV）、识别框换算为截图像素、阅读顺序、语言提示、轮廓形状 |
| `openprogram/computer_use/skylight.py` | SkyLight 的 ctypes 绑定，用于后台指针和键盘路由 |
| `openprogram/computer_use/macos.py` | `MacComputer`：应用解析、窗口选择、抓图、树遍历、全部动作 |
| `openprogram/computer_use/linux.py` | `LinuxComputer`：同一接口，基于 AT-SPI、xdotool、Gdk 抓图和 PipeWire/PulseAudio |
| `openprogram/computer_use/windows.py` | `WindowsComputer`：同一接口，基于 UI Automation（comtypes）、窗口消息、`SendInput` 和 `PrintWindow` |
| `openprogram/computer_use/windows_audio.py` | 用 WASAPI 进程回环采集一个进程树的声音 |
| `openprogram/programs/tools/system/computer_use_agent/targets/app.py` | `app` 目标：步骤校验、`describe` 解析、多个步骤、结果拼装 |

### 后台投递

元素动作走 Accessibility：`AXPress` / `AXConfirm` / `AXPick`，然后 `AXSelected`，然后聚焦，最后才在元素中心做一次指针点击；右键用 `AXShowMenu`；`set_value` 用 `AXValue`；`select_text` 用 `AXSelectedTextRange`（UTF-16 偏移）；`scroll` 先用翻页动作，再用滚动条的值，再用滚轮事件。

必须真实发生的指针事件（坐标点击、拖拽、滚轮）按开源 cua-driver 确立的配方投递：向目标进程序列号发一条不提升窗口的聚焦记录、一个 `mouseMoved` 预热事件、给事件打上点击状态、按钮、子类型 3、目标 pid、窗口 id 和点击组，`CGEventSetWindowLocation` 设定窗口相对位置，`SLEventPostToPid` 送达。键盘事件附带 `SLSEventAuthenticationMessage` 以便接收进程接受；没有 SkyLight 时回退到 `CGEventPostToPid`。结果是应用把这次点击当成用户点击来处理，而真实光标留在原地、前台应用不变。

窗口由 `window`（标题子串或序号）或 `window_id` 选定；两者都不给时，模型上次读过的窗口只要还开着就保持选中，否则取焦点窗口或主窗口。最小化的窗口或被隐藏的应用仍然给出树；截图要等 `show_window` 取消最小化（`AXMinimized`）或取消隐藏应用后才有，这两者都不会激活应用。在另一个桌面空间的窗口就地读取和操作。`AXWindows` 只列当前桌面空间的窗口，所以应用里不在屏幕上、又没有被已列出窗口对应上的普通窗口（第 0 层，至少 80×60），用 SkyLight 的远程令牌查找：以 pid、`0`、`'coco'` 和元素 id 调用 `_AXUIElementCreateWithRemoteToken`，元素 id 从零开始试（最多 4000），直到每个窗口 id 都找到元素，做法同 AltTab；结果按应用缓存，直到这组窗口 id 变化。ScreenCaptureKit 能截这样的窗口，SkyLight 的指针通道也能送达，但不论走哪条通道，窗口服务器都会丢掉发给它的按键，所以在那里 `type_text` 和 `paste` 改为设置焦点元素的 `AXSelectedText`，`press_key` 报告按键送不到，`show_window` 说明窗口留在原桌面空间。窗口无法移动：macOS 14.5 起只有 Dock 能移动窗口（其他进程调用 `SLSMoveWindowsToManagedSpace` 需要放宽系统完整性保护，yabai 的文档写明了这一点）。

`paste` 写入粘贴板（纯文本，或用 `markdown-it` 从 Markdown 渲染出的 HTML），向目标进程发 Cmd+V，并在 change count 表明期间没有别人写入时恢复先前的粘贴板内容。

### Agent 光标

在一个点名元素或坐标的步骤执行前，`MacOSComputer.act` 先算出它落在哪里（元素的中心取自它的 `AXFrame`，截图坐标则按窗口原点和缩放换算），调用 `native_window_resources.note_action_point`，再等待 `CUE_LEAD_SECONDS`（0.15 秒），让光标先到。这个点以屏幕点为单位、原点在主显示器左上角，与 Electron 的坐标空间相同。worker 把它作为 `native.action` 帧广播（`session_id`、`x`、`y`、`sequence`、`at`、`action`、`app_name`）；agentic 子进程通过与被操作窗口相同的父进程通道转发（`kind: "action"`）。Web 客户端里 `native-window-store.ts` 在**显示操作**没有关闭时把帧交给 `openprogramDesktop.nativeActionCue`。桌面主进程（`main/action-cues.js` 里的 `showNativeActionCue`）维护一个透明、点击穿透、不可聚焦、置顶的窗口，加载与网页光标相同的 `/menu-overlay/action-cue` 页面，从上一个点滑过去、播放点击，并在 `ACTION_CUE_MS` 后隐藏。每个 App 窗口都会收到这一帧，所以主进程按 `session_id`、`sequence` 和 `at` 丢掉已显示过的步骤。Linux 和 Windows 还不发出这些点。

### 窗口标识

被操作的窗口带有 macOS 的屏幕共享标识，与 Codex Computer Use 下一样：标题栏按钮上盖一个紫色徽标，菜单栏出现共享图标。macOS 会给任何处在 ScreenCaptureKit 实时流下的窗口画这两样，所以 `window_watch.WindowWatch` 在它上面保持一个流，做法与 Codex 保持画中画流相同。`MacOSComputer` 在每次 `act` 和每次指明窗口的 `get_state` 时用窗口 id 触碰它。流只过滤这一个窗口（`SCContentFilter.initWithDesktopIndependentWindow`），请求每秒一帧的 2x2 画面且不挂任何输出，因此不录下任何内容。每个会话最多监视一个窗口：转到另一个窗口会释放前一个，`IDLE_SECONDS`（20 秒）内没有步骤的窗口由清理定时器释放。打开流在单独线程上进行，失败被忽略，所以步骤不会因标识而等待或失败。

### 拒绝

工具从不向 `AXSecureTextField` 元素输入，macOS 报告安全键盘输入（`kCGSSessionSecureInputPID`）期间也不输入，并拒绝以钥匙串访问、密码、loginwindow、SecurityAgent 和 OpenProgram 自身的 bundle 为目标。拒绝以错误返回并请用户来做这一步；任何审批范围都不能覆盖它。

### Linux 后端

`LinuxComputer` 保持 `MacComputer` 的接口，工具、服务端的应用查询和测试都通过 `backends.backend()` 驱动任一后端。它只在 X11 会话里运行：Wayland 下任何客户端都不能读取别的客户端的画面或向其注入输入，`support()` 会如实说明。

- **应用。** AT-SPI 桌面下拥有窗口的子节点，加上所属进程不接入无障碍总线的顶层 X 窗口。X 窗口的所属进程取 `_NET_WM_PID`；Xt、Motif 客户端不设置它时，取名称或可执行文件名以窗口 WM_CLASS 实例名开头的最新进程。每个应用按可执行文件或名称匹配桌面条目（`Gio.AppInfo`），由此得到标识（`org.gnome.Calculator`）、显示名，以及在 hicolor 主题里查到的图标。启动通过 `Gio.DesktopAppInfo.launch`，之后既等窗口也等应用的 AT-SPI 根节点，因为 GTK 4 应用在窗口映射之后才加入总线。
- **窗口。** 顶层窗口取窗口管理器的 `_NET_CLIENT_LIST`（用 `xprop` 读取），这样排除了 GTK 10×10 的 client-leader 窗口；没有客户端列表时，跳过 10×10 及更小的窗口。AT-SPI 的 frame 先按标题、再按尺寸与 X 窗口配对。不在已映射集合里的窗口报告为最小化；`show_window` 重新映射它。
- **树。** 角色是 AT-SPI 角色名（`push button`、`text`、`check box`），`role_name` 原样打印。子树在屏幕上时才读：GTK 3 设置 SHOWING，GTK 4 在窗口以下只设置 VISIBLE，所以窗口的子节点只要有一个报告 SHOWING 就按 SHOWING 遍历，否则按 VISIBLE。未展开组合框的弹出项和 GTK 的提示窗口跳过。无名的 filler、panel、section 是透明的。GTK 4 用类名给无名控件命名（`AdwGizmo`、`GtkMenuButton`），这类名字不当作标签。标志来自状态（CHECKED 或 PRESSED、FOCUSED、SELECTED、EXPANDED、非 ENABLED/SENSITIVE），`settable` 来自 EditableText 或 Value，`secure` 来自 `password text` 角色。次要动作是元素的 Action 名称中除 click、press、activate、toggle、jump、open、select 以外的部分。
- **后台的元素动作。** 点击执行元素的主动作；`set_value` 用 `EditableText.set_text_contents`、`Value.set_current_value`，复选框状态不一致时执行切换；`type_text` 和 `paste` 用 `EditableText.insert_text`（UTF-8 字节长度）在光标处插入并替换选区，换行执行输入框的 `activate` 动作；对输入框 `press_key Return` 执行 `activate`；`select_text` 用 `Text.set_selection` 或光标偏移（字符偏移，不是 UTF-16）；`copy` 读取 `Text.get_selection`，不经过剪贴板；按元素 `scroll` 把最近的滚动条的 Value 每页移动其长度的 90%；`menu` 遍历窗口的 `menu bar` 并执行叶子项的动作。`Component.grab_focus` 会让 GTK 把窗口提到前台，所以凡是必须移动焦点的地方，都会把焦点还给原先活动的窗口。
- **前台输入。** GTK 和 Qt 通过 XInput 2 读取指针和按键，会忽略用 `XSendEvent` 发给未聚焦窗口的核心事件，所以按坐标点击、拖拽、滚轮、悬停和按键都通过 XTEST 发送：先激活窗口（`windowactivate`；没有 EWMH 窗口管理器时用 `windowraise` 加 `windowfocus`），执行输入，再恢复指针位置和原先活动的窗口；`hover` 让指针留在原处。组合键用 xdotool 名称，`cmd`、`command`、`meta`、`win` 映射为 `super`，`option` 映射为 `alt`。
- **截图。** 对外部 X 窗口调用 `Gdk.pixbuf_get_from_window`，得到窗口自身按 X 分辨率的像素，长边缩到 1568 像素以内；最小化的窗口没有截图。截图像素通过 `xdotool getwindowgeometry` 给出的窗口位置换算为屏幕像素，与 AT-SPI 屏幕坐标用的是同一个参照系。
- **OCR。** 稀疏窗口（以及 `find` 的回退）用 `tesseract --psm 11 tsv`，语言取 eng、chi_sim、chi_tra、jpn、kor 中已安装的；置信度 30 以上的词拼成行。Linux 上不检测轮廓形状。
- **音频。** `pactl list sink-inputs` 给出每个音频流的 `application.process.id`；录音器轮询，直到出现该应用或其任一子孙进程的音频流（每次轮询都重新读取子孙进程，因为播放器通常是开始录音之后才启动的子进程），然后用 `parec --monitor-stream=<index>` 以 16 kHz 单声道浮点读取。读取持续到 parec 结束，所以停止时它还缓冲着的样本也会保留。PipeWire 下四分之一秒内就收到第一批样本；PulseAudio 的定时调度下，对一个音频流的首次监听会晚 1.2–1.7 秒开始，这段会丢失。
- **拒绝。** `password text` 元素、Seahorse、KWallet、gcr 弹窗、polkit 代理以及 OpenProgram 自身的条目。

app 指南在发送时按 Linux 改写（`targets/app.py` 的 `_LINUX_GUIDE`）：哪些步骤会把窗口切到前台、纯文本 `paste`、不经剪贴板的 `copy`、Linux 上的拒绝列表。`computer_use_apps` 的 WebSocket 回复带上 worker 的 `platform`；在 Linux 上，审批卡片对按坐标输入、拖拽、悬停和回车以外的按键（`needsForeground`）说明这一步会把窗口切到前台。

### Windows 后端

`WindowsComputer` 保持同一个接口。进程设为按显示器感知 DPI（`SetProcessDpiAwarenessContext(-4)`），所以窗口框、UI Automation 的边界和输入坐标都是物理屏幕像素。它调用的每个 Win32 函数都声明了 `restype` 和 `argtypes`，64 位句柄不会被截断。

- **应用。** `EnumWindows` 给出的可见、无所有者、非工具窗口且有标题的顶层窗口，按进程分组。UWP 外框（`ApplicationFrameWindow`）属于 ApplicationFrameHost，它的应用是子窗口 `Windows.UI.Core.CoreWindow` 所在的进程。已安装应用来自 `Get-StartApps`（桌面应用和应用商店应用都在，缓存一分钟）；运行中的进程按可执行文件或名称对应到一行，启动时运行 `explorer.exe shell:AppsFolder\<AppID>`，再等新窗口出现。
- **树。** 对窗口调用 `IUIAutomation.ElementFromHandle`，用控件视图遍历器遍历；屏幕外的子树跳过，菜单项除外。角色是控件类型（50000–50040）的小写名称（`button`、`edit`、`check box`）。没有名字、没有动作的 pane、group 和 custom 是透明的。标志来自模式：Toggle 状态、`IsEnabled`、`HasKeyboardFocus`、SelectionItem、ExpandCollapse、可写的 Value 或 RangeValue（`settable`）、`IsPassword`（`secure`）。值取自 RangeValue、Value 或 Text 模式的文档范围。次要动作是 expand、collapse、scroll、select，以及 LegacyIAccessible 里不是 press、click、invoke、jump 的默认动作。
- **后台元素动作。** 点击依次尝试 Invoke、Toggle、SelectionItem.Select、ExpandCollapse 和 LegacyIAccessible.DoDefaultAction，对输入框则是聚焦；`set_value` 用 Toggle、RangeValue、Value 或 LegacyIAccessible；`select_text` 按字符移动 Text 模式的范围；`copy` 读取 Text 模式的选区；按元素 `scroll` 用最近的 Scroll 模式按大步滚动；`menu` 遍历传统 `HMENU`（`GetMenu`）并投递 `WM_COMMAND`，或展开并调用 UI Automation 菜单项。
- **投递输入。** 按坐标的点击、拖拽、滚轮和悬停，以鼠标消息投递给该点下最深的子窗口（`ChildWindowFromPointEx`），用它的客户区坐标；第二次点击是 `WM_LBUTTONDBLCLK`。不带命名修饰键的按键，以 `WM_KEYDOWN`/`WM_CHAR`/`WM_KEYUP` 发给该线程的焦点窗口（`GetGUIThreadInfo`）；`type_text` 每个 UTF-16 单元投递一个 `WM_CHAR`。向传统 edit 或 rich edit 控件 `paste` 时发送 `WM_PASTE`。
- **前台输入。** 快捷键读的是 `GetKeyState`，投递消息改变不了它；UWP 外框、Chromium 和 Firefox 窗口读取原始输入。所以带修饰键的组合键、对这些窗口类的指针输入，以及其他情况下的 `paste`，都在 `_Forward` 里用 `SendInput`：它先接入前台线程的输入队列（`AttachThreadInput`）以便调用 `SetForegroundWindow`，执行输入，再把光标和原来的前台窗口还回去。
- **截图。** `PrintWindow` 加 `PW_RENDERFULLCONTENT` 把窗口（无论是否被挡住）画进一张外框大小的位图；从中裁出可见框（`DWMWA_EXTENDED_FRAME_BOUNDS`），用 HALFTONE 模式的 `StretchBlt` 缩到长边 1568 像素，再由 `GetDIBits` 取出 BGRA 行，`png_encode` 不借助任何图像库写成 PNG。最小化的窗口没有截图；`show_window` 用 `SW_SHOWNOACTIVATE` 还原它。
- **剪贴板。** `paste` 写入 `CF_UNICODETEXT`，md 和 html 还写入 "HTML Format"（头部偏移由 `cf_html` 计算），之后恢复原来的文字。
- **OCR。** 与 Linux 相同，装了 tesseract 时使用。
- **音频。** 对 `VAD\Process_Loopback` 调用 `ActivateAudioInterfaceAsync`，参数为 `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`，得到一个 `IAudioClient`，以共享回环模式初始化并自动转换为 16 kHz 单声道 float，在独立的 COM 线程上由事件驱动经 `IAudioCaptureClient` 读取。完成回调是 agile COM 对象，因为 Windows 在工作线程上调用它。
- **拒绝。** `IsPassword` 元素、CredentialUIBroker、consent（UAC）、LogonUI、LockApp、credwiz、keymgr 和 OpenProgram。

app 指南在发送时按 Windows 改写（`_WINDOWS_GUIDE`）；对组合键和粘贴（`needsForeground(args, "windows")`），审批卡片说明这一步会把窗口切到前台。

### 权限与审批

对 `app` 目标，`requires_approval` 对除 `list_apps` 外的每个动作返回 `computer_use_agent controls <app>`；带 `code`、`fresh` 或不带动作的调用按读取该应用审批。`parse_command` 把一次调用归约为规范化的应用名（虚拟机为 `vm:<url>`，浏览器没有），于是 `exact_rule_for_call` 得到 `computer_use_agent(calculator)`，`rule_to_string` 以常规形式打印。审批卡片提供四个范围：

| 范围 | 规则保存在哪 |
|---|---|
| once | 不保存 |
| session | 会话的 run config（`permission_rules.allow`）——`computer_use_agent` 在 `_SESSION_SCOPE_TOOLS` 里 |
| always | 项目规则 |
| deny | 不保存 |

这项授权只在会询问的模式下生效；Bypass 直接放行，Auto 交给自动审查。`permission_decision` 对 `app` 和 `vm` 目标把 `computer_use_agent` 当作按应用授权的工具（`_APP_GRANT_TOOLS`）：当工具自身的 `requires_approval` 表明这次调用需要审批、且没有允许规则点名该应用时，决定是 `ask`，理由 `APP_GRANT_REQUIRED`，因此在 Bypass 之外，无人值守的来源会拒绝这类调用；在会询问的模式下，允许规则是越过卡片的唯一途径。`_RULE_ALIASES` 让以旧名 `computer_use(<app>)` 保存的规则匹配 `computer_use_agent` 调用。`browser` 目标没有自己的规则：有 Page 的对话得到本轮的 `SURFACE_GRANT`，上传文件或打开本机之外的网站会询问。

权限规则在每个操作边界重新加载（全局 < 项目 < 会话），所以会话规则对下一次调用立即生效，无需重启。

系统访问：`computer_use:desktop` 同时是 `accessibility` 和 `screen_recording` 两项能力的操作；`_desktop_operation` 把除 `list_apps` 和 `guide` 外的每次 `app` 调用映射到它，于是缺少授权时调用进入标准的"等待"状态并走设置 → 系统访问流程；等待请求写明 `computer_use_agent`。

工具在 `DEFAULT_TOOLS` 里且常驻：schema 很短，不延迟加载。对话有 Page 时，`_configure_web_use_tools` 保留它并移除独立的浏览器工具；`web_use` 从不提供给模型。`unsafe_in` 在微信、Telegram 渠道和规划模式下隐藏它。

### Web 展示

`lib/computer-use-agent-call.ts` 解读 `computer_use_agent` 调用：`appStepArgs` 把 `app` 调用变成应用渲染器接受的扁平步骤（`{action, app, …}`；多个步骤成为 batch，代码和 fresh agent 各成一个动作），`screenStep` 给出浏览器或虚拟机调用的动作。`tool-presentation.ts` 用显示器图标和 system 色调渲染 `app` 步骤；标题写动作和应用（"在 Calculator 中点击"），目标行在给了按键、文本、动作名或窗口时显示它们。浏览器调用显示动作和 URL，虚拟机调用显示动作，代码显示"在 <app> 中运行代码"，fresh agent 显示"交给新代理"及简报首行。审批卡片的范围按钮在"允许一次"和"始终允许"之间加入"允许此对话"，答案摘要打印"允许此对话"。早先工具（`computer_use`、`web_use`、`gui_agent`）记录的调用保留各自的渲染器，旧对话照常可读。

## 浏览器目标：`web_use` 运行时

`browser` 目标运行在 `web_use` 运行时上（`openprogram/programs/workflow/browser/` 的 `run_web_use`），其他程序仍直接调用它。它提供：`observe`，`act` 含 `screenshot`、`navigate`、`click`、`type`、`press`、`scroll`、`hover`、`select`、`upload`，`verify` 含文本、URL、标题、元素和文件断言，三个后端（Playwright MCP、Chrome DevTools MCP、App 自带 Chrome）。

相对 Codex 目标 API，它覆盖：

| 能力 | Codex | `web_use` |
|---|---|---|
| 右键/中键/双击、带修饰键点击 | `click(target, {mouseButton, clickCount, key})` | `click` 带 `mouse_button`、`click_count`、`modifiers` |
| 拖拽 | `drag(from, to)` | 在 ref 或点之间 `drag` |
| 滚动指定元素 | `scroll(index, direction, pages)` | `scroll` 带 `ref` 和 `direction` |
| 追加输入 vs 替换值 | `typeText` / `setValue` | `type_text` / `type` |
| 粘贴文本、Markdown 或 HTML | `paste(text, {format})` | `paste` 带 `format` |
| 选中文本或放置光标 | `selectText` | `select_text` |
| 带时长的按键、无目标的按键 | `pressKey(key, {durationMs})` | `press` 带 `duration`，`ref` 可选 |
| 后退/前进/刷新 | 标签页方法 | `back`、`forward`、`reload` |
| 在页面里运行 JavaScript | `evaluate` | `evaluate` 带 `script`，逐次审批 |
| 控制台与网络（Claude in Chrome 的 `read_console_messages`、`read_network_requests`） | — | `console_messages`、`network_requests` |

参数名沿用 `app` 目标的（`mouse_button`、`click_count`、`direction`、`format`、`prefix`、`suffix`、`selection_type`、`duration`），让两个目标读起来一致；只有点击时按住的键叫 `modifiers`，因为 `key` 已经是 `press` 的按键。

`page_actions.py` 承载页面一侧：参数解析和五段脚本（`POINTER_SCRIPT`、`SCROLL_SCRIPT`、`INSERT_TEXT_SCRIPT`、`PASTE_SCRIPT`、`SELECT_TEXT_SCRIPT`），每段都是 `(element, options)` 的函数。控制器在 ref 的句柄上用 `evaluate` 运行它们；MCP 后端经 `browser_evaluate` / `evaluate_script` 运行，选项以 JSON 内联，并带一个 `require` 守卫，页面报告失败时抛错，由后端自己的错误路径上报。各路径的取舍：

- 绑定的 App 标签页保持后台规则：普通点击仍用原有的后台点击脚本；其他点击在页面内派发 pointer 和 mouse 事件；拖拽和坐标点击照旧经页面的输入派发并使用标签页的输入缩放。
- 无头 Chromium 用原生 Playwright 调用：`click(button, click_count, modifiers)`、拖拽用 `mouse.move(steps=12)`、按住按键用 `keyboard.down/up`、`go_back` / `go_forward` / `reload`。
- Playwright MCP 用原生的 `browser_click` 选项、`browser_drag`、`browser_mouse_drag_xy`、双轴的 `browser_mouse_wheel` 和 `browser_navigate_back`；Chrome DevTools MCP 用 `click(dblClick)`、`drag` 和 `navigate_page(back|forward|reload)`。后端做不到的选项在发送任何东西之前抛出 `unsupported_option`，而不是退而执行一个更弱的动作。
- `paste` 派发一个携带 `DataTransfer` 的 `ClipboardEvent`；页面不处理时，用 `insertHTML`（富文本编辑器，`md`/`html`）或 `insertText` 插入。系统剪贴板从不被触碰。

标签页对应已有命令：`list_pages` 即 `listTabs`，从它拿到的 Page 别名即 `getTab`，带 `url` 的 `observe` 会打开一个隐藏的后台标签页（即隐藏的 `createBrowserTab`），除非已绑定的 Page 正显示同一来源；`close` 结束会话。带 `visible: true` 的 `observe` 在前台打开标签页；它会挪走用户的焦点，所以 schema 只允许在用户要求看着操作时使用。带 `changes_only: true` 的 `observe`（`observe_diff.py`）就是 diff 形式：它按角色、名字、标签、值、禁用状态和输入类型，把新一帧与同一 URL 的上一次观察比较，完整列出新增和变化的元素，没变的元素各占一行并带上新 ref，省略没变的文字和 ARIA 快照，并列出消失的元素。每次观察仍为全部元素签发 ref，ref 只属于它所在的那一帧，过期 ref 正是靠这一点被拒绝；diff 只缩短展示的内容，没有 ref 需要跨帧存活。MCP 后端用自己的 ARIA 快照替换，元素里只列文件输入，所以这个选项对它们不适用。

`evaluate` 能读到已登录页面持有的一切，包括观察结果里被脱敏的内容，所以它的门控放在权限策略里而不是工具里：含 `evaluate` 步骤（单步或在 `actions` 里）的 `computer_use_agent` 浏览器调用由 `force_approval` 在任何模式下都询问，先于允许规则、bypass 和绑定页面授权；`one_shot_approval` 让卡片只有“本次”范围，从不保存规则，并完整展示参数。非交互来源直接拒绝。脚本在每个后端上都经由控制器运行，MCP 后端也一样，因为控制器持有同一个标签页及其字段的密码值：结果经过与观察相同的脱敏，并经过 `_mutated`，因此当前帧失效，下一步重新观察。表达式被包成 `() => (expr)`；脚本最多 8000 个字符，结果最多 20,000 个字符。

`console_messages` 和 `network_requests`（`page_logs.py`）读取 Playwright 为每个 Page 自带的历史（`console_messages()`、`page_errors()`、`requests()`），所以第一次读取前不需要事先挂监听。它们和 `evaluate` 一样在每个后端上都经由控制器运行，只读，不会让当前帧失效。控制台文字经过密码脱敏；请求按方法、去掉查询和片段的 URL、状态码（浏览器从未收到响应时为 `no response`）和资源类型列出，从不包含请求头或请求体。

## 界面工作

`app` 调用的审批卡片（`computer-use-approval.tsx`）先展示应用本身：图标、显示名和 bundle id 来自 `computer_use_apps` WebSocket 动作，它调用后端的 `app_info`，不启动任何东西，Web 按名字缓存结果（`lib/net/computer-use-apps.ts`）。其下一个标签用文字说明这一步（`computer-use-step.ts`），两行分别说明这一步在后台进行（录音则说明只录该应用的声音）以及可选范围的含义，去掉空值的参数折叠在"查看执行详情"里。

项目设置页在默认设置和权限规则之间有一个"操控电脑"分区（`computer-use-apps-section.tsx`）。它把项目的 `computer_use_agent(<app>)` 允许规则（以及以 `computer_use(<app>)` 保存的规则）列成每个应用一行，带图标、名字、bundle id 和移除按钮，通用规则列表不再重复这些规则。移除一行即删除该规则。对话级授权是随对话结束的会话规则，所以这里不列出。

人可以像在 Codex 里那样给 agent 指东西：

- 在网页标签里，**评论页面元素…** 选中一个元素，把它的选择器、文字和评论加进草稿；**区域截图…** 让人拖出一个矩形，把这块像素作为 PNG 附件加入。两者运行在同一个隔离脚本环境里（`apps/desktop/main/web-views.js` 的 `PICKER_WORLD`），共用一个取消钩子，开启一种会结束另一种。区域遮罩先被移除、再画两帧，`capturePage` 才按页面缩放截取那个矩形。文件经 `lib/composer-inbox.ts` 送到目标对话：显示这个对话的输入框把它当作拖进来的文件收下，在那之前它一直在收件箱里等。
- 输入框的 `@` 菜单在文件之前列出已打开的网页标签和正在运行的应用（`attach/mention-sources.ts`）。标签页写成指向其地址的 markdown 链接，应用写成名称加 bundle id，所以「这个标签页」不用模型去猜。正在运行的应用来自带 `running: true` 的 `computer_use_apps`，它列出被拒应用之外的常规应用，页面里缓存十秒。

## 实现状态

- 已实现：`computer_use_agent` 及 `app`、`browser`、`vm` 三个目标，首次使用时的目标指南，多个步骤，代码模式，带临时会话规则的 `fresh` agent，经 gui_harness 的 `describe` 定位，经 OSWorld HTTP API 的虚拟机目标（作为 `computer_use.vm` consumer 走出站策略），以及 Web 展示；单元测试覆盖路由、指南、虚拟机脚本、定位和审批，沙箱测试用替身目标运行代码。尚未连接真实虚拟机服务运行，也未在 App 里装上 gui_harness 检测器运行。
- 已实现：macOS 上 `app` 目标的上述读取与执行动作，稳定序号，自适应等待，后台指针与键盘投递，树 diff，四个范围的按应用审批，系统访问门控，Web 展示，按键/树编号/菜单匹配/多个步骤/规则/审批接线的单元测试。
- 浏览器目标已实现：上面对照表的每一行，三个后端都支持，并有在 Chromium 里运行页面脚本的测试，以及 `evaluate` 的逐次审批。
- 已实现：为树稀疏的窗口提供 OCR 文字，并作为 `find` 的回退，附带一个经 Vision 识别渲染图像的测试。
- 已实现：按应用录音，输出 WAV，并用语音引擎转写。
- 已实现：可见标签页，以及原生后端上的 `changes_only` 观察。
- 已实现：对 Gemini 和 Chat Completions 的音频模型，把录音作为音频输入；Chat Completions 视觉模型能看到工具结果里的截图。
- 已实现：网页标签里的元素评论和区域截图；对已打开标签页和正在运行应用的 `@` 提及。
- 已实现：稀疏窗口里不带文字的图标和控件的轮廓。
- 已实现：上文所述的 Linux（X11）后端。测试在 Debian 12 容器里进行，环境是 Xvfb、Openbox、AT-SPI 总线和 PipeWire，对象是一个 GTK 3 窗口（菜单栏、输入框、密码框、复选框、滑块、带滚动的文本视图、绘图区、一个由子进程放声音的按钮）、GNOME 计算器（GTK 4 加 libadwaita，从桌面条目启动，靠元素点击算出 7×6）以及 ImageMagick 的 `display`（不接入 AT-SPI 的 Xt 客户端，靠 OCR 读取）。与主机无关的部分有单元测试。
- 已实现：另一个桌面空间里的窗口。测试时从桌面 1 操作桌面 2 上的计算器（列出窗口、截图、按元素算出 7×6、坐标点击、滚动、按键报错），鼠标指针和前台应用都没变，窗口留在原桌面空间；向那里的输入框插入文字没有测到，因为计算器没有输入框。
- 已实现、尚未在 Windows 上运行：上文所述的 Windows 后端。构建它的 macOS 机器没有 Windows 客户机，所以只有与主机无关的部分（PNG 编码、按键映射、HTML 剪贴板内容、开始菜单解析、控件类型表、拒绝列表、录音格式）有单元测试。
- macOS 上已实现：桌面应用上的 agent 光标，步骤坐标帧和桌面光标窗口有单元测试。未实现：Linux 和 Windows 后端不发出步骤坐标，那里不会显示光标。
- 已实现：`browser` 目标里经 Playwright MCP 扩展模式接入的用户 Chrome 和 Edge，动作映射、Edge、遇错停止、`verify` 和审批主体有单元测试。尚未在真实浏览器中配合 Playwright Extension 运行过。
- macOS 上已实现：窗口标识，监视、切换和空闲释放有单元测试。Linux 和 Windows 上未实现。
- 未实现：经 Responses 和 Anthropic API 的音频输入（这两个接口的模型不收音频）；把窗口从另一个桌面空间移过来，以及用按键向它输入（见上文）；从轮廓直接认出图标的名字（模型看截图分辨）。
