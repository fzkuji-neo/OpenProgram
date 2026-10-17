# 操控电脑

`computer_use` 工具让模型在你继续工作的同时读取并操作桌面应用的窗口：应用留在后台，键盘和鼠标仍归你，不会有窗口被带到前台。模型看到的是窗口截图加上它的 Accessibility 树，对编号元素执行动作，然后只拿回发生变化的那几行。它支持 macOS、X11 下的 Linux 和 Windows，差异见[在 Linux 上](#在-linux-上)和[在 Windows 上](#在-windows-上)。

网页有自己的工具 `web_use`，它驱动 App 内置浏览器和无头 Chromium。`computer_use` 负责桌面上的其他一切：Finder、备忘录、计算器、Xcode、聊天客户端、游戏启动器。

## 一步长什么样

```
computer_use(action="get_app_state", app="Calculator")
```

返回窗口截图和这样的树：

```
0 window "Calculator" actions: AXRaise
  12 static text value="0"
  18 button "7"
  23 button "All Clear"
```

每一行是一个元素：序号、角色、标签、当前值、`[focused]`、`[checked]` 之类的状态标记，以及它额外提供的动作。模型随后对序号下手：

```
computer_use(action="click", app="Calculator", element_index=18)
```

每个动作返回 `Done: …`，后面跟树的 diff：`-` 开头的行消失了，`+` 开头的行是新增或变化的。序号是稳定的：元素只要还在窗口里就保持原序号，即使它上方插入了新东西；新元素拿到一个从未用过的号，所以早先读到的序号绝不会悄悄指向别的元素。给 `get_app_state` 传 `full=true` 可以重新拿到整棵树。树最多 1500 个元素，截图长边最多 1568 像素。

有些应用自己绘制内容，不向辅助功能描述它：游戏、画布类编辑器、远程桌面、部分 Electron 应用。窗口的树少于 12 个元素时，状态里还会列出 macOS 从截图上识别出的文字，每行一条并带中心点的像素位置，例如 `"New Game" at (160, 215), 120x30`；模型用 `x`、`y` 点击它。识别在本机完成，优先使用你的首选语言，并按每张截图检测语言。同一份状态还会列出不带文字的图标和控件（如齿轮、垃圾桶），以轮廓的中心点和尺寸表示，例如 `(112, 169), 55x56`；模型先对照截图认出每个是什么，再去点击。

动作之后工具等待窗口稳定，而不是固定停顿：至少 0.3 秒，直到树不再变化，最多 1.5 秒——界面上有转圈或进度条时最多 5 秒。

## 动作

| 动作 | 参数 | 效果 |
|---|---|---|
| `list_apps` | — | 正在运行和已安装的应用，带 bundle id |
| `list_windows` | `app` | 应用的窗口，带 `window_id`、标题、尺寸，以及是否为主窗口、焦点窗口、已最小化或在另一个桌面空间 |
| `get_app_state` | `app`、`window?` 或 `window_id?`、`full?`、`include?` | 截图和树。未打开的应用会在后台启动。`window` 按标题子串或序号选窗口；上次读过的窗口保持选中。`include` 取 `all`、`tree` 或 `screenshot` |
| `zoom` | `app`、`x`、`y`、`width`、`height` | 以显示器的完整像素密度查看上一张截图的一块区域，用于看清小字。动作坐标仍以那张截图为准 |
| `find` | `app`、`text?`、`role?` | 上一棵树里标签、值或占位符包含 `text` 的元素，可限定角色（`button`、`text field`……）。没有元素匹配时，返回截图上显示 `text` 的文字行及其位置 |
| `click` | `app`、`element_index` 或 `x`,`y`、`mouse_button?`、`click_count?`、`key?`、`duration?` | 按下一个元素，或点击上一张截图上的一点。`key` 是按住的修饰键，如 `cmd`、`shift+alt`；`duration` 是按住鼠标的秒数，至多 10 秒 |
| `type_text` | `app`、`text`、`element_index?` | 向焦点元素输入；给了 `element_index` 就先聚焦它。元素是按钮等不能接收文字的控件时拒绝 |
| `press_key` | `app`、`key`、`element_index?`、`duration?` | 一个 xdotool 写法的组合键：`Return`、`Escape`、`super+c`、`ctrl+shift+Tab`、`KP_0`、`F5`。`super` 和 `cmd` 都是 Command 键 |
| `set_value` | `app`、`element_index`、`value` | 整体替换字段的值、拖动滑块、切换复选框 |
| `scroll` | `app`、`element_index` 或 `x`,`y`、`direction?`、`pages?` 或 `pixels?` | 按页滚动（可以是小数），或按点数距离滚动 |
| `drag` | `app`、`x`、`y`、`to_x`、`to_y` | 在上一张截图的两点之间拖拽 |
| `perform_secondary_action` | `app`、`element_index`、`action_name` | 元素列出的某个动作，如 `AXShowMenu`、`AXIncrement` |
| `select_text` | `app`、`element_index`、`text`、`prefix?`、`suffix?`、`selection_type?` | 选中文本元素里的一段文字，或把光标放到它前后 |
| `paste` | `app`、`text`、`format?`、`element_index?` | 经剪贴板以 `text`、`md` 或 `html` 插入，事后恢复剪贴板 |
| `copy` | `app`、`element_index?` | 对当前选区执行应用自己的"拷贝"，返回拷贝到的文字，事后恢复剪贴板 |
| `focus` | `app`、`element_index` | 不点击，直接把键盘焦点移到元素上 |
| `menu` | `app`、`menu_path?` | 不给路径时列出菜单栏。给出 `["View", "Scientific"]` 这样的路径时，列出那个菜单（带快捷键、勾选和禁用项），或选中末端菜单项。标题匹配不分大小写，末尾的 `…` 可省略；屏幕上不会弹出菜单 |
| `show_window` | `app`、`window?` 或 `window_id?` | 恢复最小化的窗口或取消隐藏应用，不把它带到前台 |
| `hover` | `app`、`element_index` 或 `x`,`y`、`duration?` | 让指针在元素上停留 `duration` 秒（默认 0.8），以打开提示和悬停菜单；你的光标不会动。在后台时不理会指针的应用不会有反应 |
| `wait` | `app`、`duration?` | 等待最多 10 秒（默认 1），然后返回发生的变化：页面加载、播放、收到回复 |
| `batch` | `app`、`actions` | 至多 20 个上面的执行类步骤，按顺序作用于同一个应用；遇到第一个错误即停止，最后只返回一次状态 |
| `start_audio_recording` | `app`、`max_duration?` | 录下该应用播放的声音，最长 `max_duration` 秒（默认 60，最多 300）。只录这个应用，你照常听得到；录音期间可以继续执行其他动作 |
| `stop_audio_recording` | `app`、`transcribe?` | 停止录音，保存 16 kHz WAV 并返回路径；在设置 → 语音里配置了语音引擎时还返回转写文字 |

`app` 是 `list_apps` 打印的名称、bundle id 或 `.app` 路径。`x`、`y` 是该应用最近一张截图上的像素，不是屏幕坐标。

在 `batch` 里，每一步都使用批量开始前读到的状态里的序号和坐标；每一步写自己的 `action`，不写应用：

```
computer_use(action="batch", app="Calculator", actions=[
  {"action": "click", "element_index": 18},
  {"action": "press_key", "key": "KP_Multiply"},
  {"action": "click", "element_index": 18},
  {"action": "press_key", "key": "KP_Enter"}
])
```

元素动作能到达被隐藏、最小化或被其他窗口盖住的窗口。坐标点击、拖拽和滚轮同样在后台进行：指针不动，前台应用不变。坐标只为树描述不了的画布和自绘控件而存在；凡是列出了序号，优先用序号。

## 网页

`web_use` 以同样的方式驱动网页：`observe` 返回 ref，`act` 接受一个 `action` 及其参数。除了 `navigate`、`click`、`type`、`press`、`scroll`、`hover`、`select`、`upload` 和 `screenshot`，它还提供与 `computer_use` 相同的词汇：

| 动作 | 参数 | 效果 |
|---|---|---|
| `click` | `ref` 或 `x`,`y`、`mouse_button?`、`click_count?`、`modifiers?` | 右键、中键、双击和带修饰键的点击，如 `modifiers="cmd"` |
| `drag` | `ref` 和 `to_ref`，或 `x`,`y` 和 `to_x`,`to_y` | 按下、分步移动、松开 |
| `scroll` | `ref?`、`direction?`、`amount?` | 给了 `ref` 时滚动该元素最近的可滚动容器；`amount` 以像素计 |
| `type` / `type_text` | `ref`、`text` / `ref?`、`text` | `type` 替换字段的值；`type_text` 在光标处插入，不给 `ref` 时插入到页面当前焦点 |
| `paste` | `text`、`format?`、`ref?` | 以粘贴的方式把文字交给页面：`md` 和 `html` 在富文本编辑器里插入带格式的文字，自己处理粘贴的页面会收到它 |
| `select_text` | `ref`、`text`、`prefix?`、`suffix?`、`selection_type?` | 选中元素里的文字，或把光标放到它前后 |
| `press` | `key`、`ref?`、`duration?` | 不给 `ref` 时按键发给页面当前焦点；`duration` 是按住的秒数 |
| `back` / `forward` / `reload` | — | 历史导航；无处可去时返回 `no_history` |
| `console_messages` | `pattern?`、`only_errors?`、`limit?` | 页面的控制台输出和未捕获错误，从旧到新，默认最新 50 条；密码字段的值会被脱敏 |
| `network_requests` | `pattern?`、`only_errors?`、`limit?` | 页面发出的请求及其方法、状态码和资源类型；URL 不带查询参数，也不含请求体 |
| `evaluate` | `script` | 在页面里运行一个 JavaScript 表达式或函数（如 `() => document.title`），以 JSON 返回结果，最多 20,000 个字符；结果里的密码字段值会被脱敏 |

App 浏览器里的页面全程留在后台：事件在页面内派发，标签页不会被激活。带 `url` 的 `observe` 打开的标签页同样在你的工作后面；`visible: true` 则把它放到前台，用于你要求看着它操作的时候。`changes_only: true` 只完整列出相对同一页面上一次观察新增或变化的元素：没变的元素只占一行并带上新 ref，没变的页面文字和无障碍快照会省略，消失的元素会列出名字。ref 始终属于最新一次观察。在两个 MCP 后端上无障碍快照来自后端本身，所以 `changes_only` 在那里不起作用。在 Playwright 和 Chrome DevTools MCP 后端上，后端做不到的选项（例如三击或按住按键）会在发送任何东西之前以 `unsupported_option` 失败。

脚本能读取和修改已登录页面持有的一切，所以每次 `evaluate` 调用都会先问你并展示完整脚本，任何权限模式下都如此，即使有规则允许 `web_use` 也一样。批准只覆盖这一次调用：它没有“总是允许”，无法询问的定时任务或频道轮次会被拒绝。

## 审批

一个会话第一次触碰某个应用时，审批卡片会显示这个应用本身（图标、名字和 bundle id），说明这一步要做什么（如“点击 元素 #7”“输入 12 个字”），并说明它在后台进行。原始参数收在“查看执行详情”里。卡片提供：

- **允许一次**——仅这一次调用。
- **允许此对话**——本会话里之后对同一应用的所有 `computer_use` 调用，保存为会话规则。
- **始终允许**——保存为项目规则 `computer_use(<app>)`，项目里以后的会话不再询问。
- **拒绝**。

卡片在所有权限模式下都会出现，包括 Auto 和 Bypass：只有该应用已保存的规则能跳过它。定时任务等无人值守的运行无法回答卡片，因此只能操作项目里已允许的应用。`list_apps` 从不询问。每个应用单独审批：允许了备忘录，不代表允许邮件。项目的设置页在**操控电脑**下列出始终允许的应用，每个应用一行并带图标；移除一行即删除对应规则，下次操作该应用会重新询问。只对某个对话有效的授权随对话结束，不列在这里。一般的权限规则见[权限](permissions.zh.md)。

允许一个应用，是让模型可以操作它，并不让模型自行完成有后果的步骤。工具要求模型先把步骤准备好，在执行之前再问你：删除数据、向他人发送或提交任何内容、付款和订阅、新建账号或访问密钥、安装软件、修改系统设置，这些每次都要问；登录、上传、移动文件和输入个人信息，除非你的请求已经点明，否则也要问。验证码、密码和安全提示交给你来处理。模型在屏幕上读到的文字从不被当作你的许可。

## 另一个桌面空间里的窗口

在另一个桌面空间里的窗口就地读取和操作：`list_windows` 会标出它，截图、点击、滚动、拖拽和元素动作都能送达，不用切换桌面空间。macOS 不把按键送给这样的窗口，所以在那里 `type_text` 和 `paste` 改为把纯文本插入有焦点的输入框，`press_key` 会报告按键发不过去。工具不能把窗口移到你当前的桌面空间，只有你自己（或 Dock）能移。

## 要求

- macOS、使用 X11（Xorg）会话的 Linux，或 Windows 10、11。
- 在 macOS 上，签名的运行时（`ai.openprogram.runtime`）必须持有**辅助功能**和**屏幕录制**权限。工具会报告缺哪一项，设置 → 系统访问可以发起请求。[权限](permissions.zh.md)描述了运行时的 macOS 授权方式。


## 在 Linux 上

Linux 上，工具通过 AT-SPI 读取窗口的无障碍树（GTK 3、GTK 4 应用默认提供；Qt 应用需要 `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`），并用 `xdotool` 执行动作。需要：

- X11 会话：Wayland 不允许一个应用读取或操作另一个应用的窗口，所以在 Wayland 下工具会报告不可用；
- `python3-gi`，以及 `gir1.2-atspi-2.0`、`gir1.2-gtk-3.0` 和 `xdotool`；
- 可选：`x11-utils`（`xprop`，用来区分真正的窗口和辅助窗口）、`tesseract-ocr`（为没有无障碍树的应用识别截图上的文字）、`pulseaudio-utils`（录音）。

相同的部分：树的格式、稳定的编号和差异、截图、`zoom`、`find`、`batch`、`menu`（有菜单栏的应用）、`select_text`、`set_value`、按元素拖动滚动条，以及审批。应用按 `list_apps` 打印的桌面条目 id（`org.gnome.Calculator`）、名称或进程名来指定；已安装的应用通过它的桌面条目启动。

不同的部分：

- 元素动作（按下、切换、设值、插入和选中文字、选择菜单项、在输入框里按回车）在后台进行。按 `x`、`y` 的指针输入（点击、拖拽、滚轮）、`hover`，以及回车以外的按键，只有在 GTK 或 Qt 窗口获得焦点时才能送达，所以这一步会把窗口短暂切到前台，输入完成后把焦点和鼠标指针还回原处。`hover` 会让指针停在窗口上。审批卡片会对这些步骤如实说明。
- `paste` 把纯文本直接插入有焦点的输入框，不经过剪贴板；不支持 `format=md` 和 `html`。`copy` 直接返回选中的文字，不动剪贴板。
- 不接入无障碍总线的应用在列表里标为 "no accessibility tree"：模型读它的截图（装了 tesseract 时带 OCR 文字），按坐标操作。
- 录音只读取该应用（及其子进程）自己的音频流，来源是 PipeWire 或 PulseAudio。PipeWire 下四分之一秒内就开始录；只有 PulseAudio、没有 PipeWire 时，已经在播放的音频流开头约一秒可能录不到。
- 拒绝操作：密码框、Seahorse 和 KWallet、polkit 与 gcr 认证弹窗，以及 OpenProgram 自身。

## 在 Windows 上

Windows 上，工具读取窗口的 UI Automation 树（Win32、WPF、WinForms、应用商店应用（UWP、WinUI）和基于 Chromium 的应用都提供），窗口被挡住时也能截图。需要 `comtypes` 包，Windows 安装已包含；`PATH` 上有 `tesseract` 时，没有树的应用的截图文字也能识别。Windows 支持是新加的，项目还没有在 Windows 机器上实际跑过；遇到问题请连同失败的那一步一起反馈。

相同的部分：树的格式、稳定的编号和差异、截图、`zoom`、`find`、`batch`、`select_text`、`set_value`、`copy`、`paste`（纯文本、markdown 和 HTML）、按元素滚动、录音以及审批。应用按 `list_apps` 打印的名字指定：开始菜单里的名称（`计算器`）、可执行文件名（`notepad`）或进程号；已安装的应用从它的开始菜单条目启动。

不同的部分：

- 元素动作通过 UI Automation 在后台进行。对窗口的点击、滚动和不带修饰键的按键以窗口消息发给这个窗口，不会把它切到前台；`hover` 不移动你的鼠标指针。
- 带修饰键的按键（`ctrl+s`）需要真实的键盘状态，`paste` 在多数应用里要按 `ctrl+v`，所以这一步会把窗口短暂切到前台，完成后把焦点和鼠标指针还给你。只接收真实输入的窗口（应用商店应用的外框、Chromium、Firefox）的指针输入也这样处理。请用 Windows 的快捷键：`ctrl+c`，不是 `cmd+c`。
- `menu` 支持传统菜单栏和通过 UI Automation 提供的菜单；用功能区（Ribbon）的应用，命令在窗口的树里。
- `copy` 直接返回选中的文字，不动剪贴板。`paste` 之后恢复剪贴板里原来的文字，其他格式不保留。
- 录音通过 Windows 的进程回环采集该应用自己的进程树（需要 Windows 10 2004 或更高版本）。
- 拒绝操作：密码框、凭据与提权（UAC）弹窗、锁屏，以及 OpenProgram 自身。

## 录音

录音使用截图本来就需要的屏幕录制权限，只采集所指定应用自己的输出：其他应用、麦克风和系统提示音都不在里面。录音保存在 `~/.openprogram/computer-use/audio/`，保留最新的 20 个。`stop_audio_recording` 用设置 → 语音里选的引擎转写：whisper.cpp 让声音留在本机，OpenAI 和 Groq 引擎则会把声音发给对应的服务商。传 `transcribe=false` 只保留文件。静音的录音会如实报告，不做转写。对话模型接受音频输入时（如 Gemini 和 OpenAI 的 gpt-audio 模型），它还会直接收到录音本身，能听到转写文字里没有的音乐、语气等声音。

## 工具拒绝做的事

工具不向安全文本框输入，macOS 报告安全键盘输入期间也不输入；它从不操作钥匙串访问和密码 App、系统登录与授权弹窗，以及 OpenProgram 自身。任务需要这些步骤时，模型会请你来做。

工具说明要求模型在删除数据、发送消息、提交表单、花钱、更改账户、权限或系统设置以及安装软件之前先征得你同意，并把验证码、输入密码和安全提示交给你处理。窗口里显示的文字从不被当作你的许可。

该工具在微信、Telegram 渠道和规划模式下不提供。
