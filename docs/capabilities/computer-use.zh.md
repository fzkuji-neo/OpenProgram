# 操控电脑

`computer_use` 工具让模型在你继续工作的同时读取并操作 macOS 应用的窗口：应用留在后台，键盘和鼠标仍归你，不会有窗口被带到前台。模型看到的是窗口截图加上它的 Accessibility 树，对编号元素执行动作，然后只拿回发生变化的那几行。

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

动作之后工具等待窗口稳定，而不是固定停顿：至少 0.3 秒，直到树不再变化，最多 1.5 秒——界面上有转圈或进度条时最多 5 秒。

## 动作

| 动作 | 参数 | 效果 |
|---|---|---|
| `list_apps` | — | 正在运行和已安装的应用，带 bundle id |
| `list_windows` | `app` | 应用的窗口，带 `window_id`、标题、尺寸，以及是否为主窗口、焦点窗口、已最小化或在另一个桌面空间 |
| `get_app_state` | `app`、`window?` 或 `window_id?`、`full?`、`include?` | 截图和树。未打开的应用会在后台启动。`window` 按标题子串或序号选窗口；上次读过的窗口保持选中。`include` 取 `all`、`tree` 或 `screenshot` |
| `zoom` | `app`、`x`、`y`、`width`、`height` | 以显示器的完整像素密度查看上一张截图的一块区域，用于看清小字。动作坐标仍以那张截图为准 |
| `find` | `app`、`text?`、`role?` | 上一棵树里标签、值或占位符包含 `text` 的元素，可限定角色（`button`、`text field`……） |
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
| `batch` | `app`、`actions` | 至多 20 个上面的执行类步骤，按顺序作用于同一个应用；遇到第一个错误即停止，最后只返回一次状态 |

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

## 审批

一个会话第一次触碰某个应用时，审批卡片会写明应用名，并提供：

- **允许一次**——仅这一次调用。
- **允许此对话**——本会话里之后对同一应用的所有 `computer_use` 调用，保存为会话规则。
- **始终允许**——保存为项目规则 `computer_use(<app>)`，项目里以后的会话不再询问。
- **拒绝**。

卡片在所有权限模式下都会出现，包括 Auto 和 Bypass：只有该应用已保存的规则能跳过它。定时任务等无人值守的运行无法回答卡片，因此只能操作项目里已允许的应用。`list_apps` 从不询问。每个应用单独审批：允许了备忘录，不代表允许邮件。规则和其他权限规则一样可以查看和删除；见[权限](permissions.zh.md)。

## 要求

- macOS。Windows 和 Linux 暂不支持。
- 签名的运行时（`ai.openprogram.runtime`）必须持有**辅助功能**和**屏幕录制**权限。工具会报告缺哪一项，设置 → 系统访问可以发起请求。[权限](permissions.zh.md)描述了运行时的 macOS 授权方式。

## 工具拒绝做的事

工具不向安全文本框输入，macOS 报告安全键盘输入期间也不输入；它从不操作钥匙串访问和密码 App、系统登录与授权弹窗，以及 OpenProgram 自身。任务需要这些步骤时，模型会请你来做。

工具说明要求模型在删除数据、发送消息、提交表单、花钱、更改账户、权限或系统设置以及安装软件之前先征得你同意，并把验证码、输入密码和安全提示交给你处理。窗口里显示的文字从不被当作你的许可。

该工具在微信、Telegram 渠道和规划模式下不提供。
