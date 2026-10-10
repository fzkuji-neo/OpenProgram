# 表面系统

UI 分为两个**表面上下文**。每个表面有各自的交互语言，眼睛能一眼分清当前停在哪一层：导航层还是内容层。这些规则同时约束**浅色和深色**主题。浅色主题最容易踩坑（浅灰侧栏上铺白底）。

## 两个表面

```
─────────────────────────────────────────────────────────────────
surface        background tone           where it lives
─────────────────────────────────────────────────────────────────
deep           `--bg-secondary`          三栏背后的页面（`.app`）
─────────────────────────────────────────────────────────────────
panel          浮起的卡片：               左右两条侧栏（`--bg-input`，
               `--bg-input`（侧栏）、     和输入框同一种材质）和中间
               `--bg-primary`（中栏）     一栏（`--bg-primary`：聊天
                                         流、设置页和其他所有页面）
─────────────────────────────────────────────────────────────────
```

整个窗口是一张页面上的三张浮起卡片——左右栏用 shadcn Sidebar 的 `floating` 壳（`components/ui/sidebar.tsx`，只取注册表的壳），中栏同时用它 `inset` 的思路。每张卡片 14px 圆角（`rounded-2xl`）、每套主题自己的浮起阴影（`--composer-shadow`），无边框、无描边；侧栏四周各留 7px（`p-2`），中栏上下各离边 7px，左右的缝由侧栏的留白提供。侧栏用白色（`--bg-input`），和输入框、用户气泡同一种材质；中栏保持 `--bg-primary`，这样白色的浮起元素在它上面仍有对比。

收起时一条侧栏宽 `--rail-collapsed-w`（63px：卡片里 49px 的图标轨加两侧留白），`components/layout/use-resizable-rail.ts` 用同一个数。卡片里的东西——行、分组标题、页脚——不受壳子影响，继续用下面的配方。

## 各表面的交互语言

鼠标点按钮不画外圈焦点环。键盘聚焦普通按钮只轻微提高亮度，不用 outline 或 box-shadow。顶部 `role="tab"` 是唯一例外：用当前主题的 `--focus-ring`，深色更亮，浅色更深。

### Deep 表面（侧边栏）

deep 表面上的组件是**列表行**——会话项、分支、收藏，以及内容区里同一套行（MCP 的 `drawio` / `linear` / `+ Add server`）。它们不应当表现得像按钮：

- 闲置：无边框、无描边、无填充
- 悬停 / 选中：背景换成**看得出的灰色**（``--bg-hover`` / ``--bg-selected``），文字仍是 ``--text-primary`` 或 ``--text-secondary``
- 选中行**禁止**用 ``--bg-input`` 填充。侧栏卡片本身就是这个白，白行铺上去会消失
- 不用品牌色字形，唯一例外是极小的状态点（``.indicator-dot``）

理由：侧栏密、扫得勤。一片品牌色胶囊会吵，还会跟内容列抢视线。悬停变灰让这一层安静，点击目标仍有反馈。

### Panel 表面（聊天内容 + 对话框）

panel 表面上的组件就是按钮 / 胶囊 / 卡片：

- 坐在抬升背景上，"幽灵描边"能干净地呈现
- 闲置：``--bg-surface`` 底，``--text-primary`` 字，主操作用品牌色字
- 悬停：品牌色填充，字切到对比色（``--text-on-accent``）
- 这种反转式悬停让一串操作读起来是同一家人

管理页顶部的 **tab 胶囊**（Abilities / Programs / Plugins / Skills）是唯一的亮底例外：选中态用 ``--bg-input``，跟搜索框一样偏亮，而不是更深。这个填充**只给这些胶囊**。不要抄到侧栏行或 MCP 服务器行上。

## 列表行只有一套尺寸

侧栏导航（`+ New chat`、Agents、Abilities、History、Scheduler）和内容区列表行（MCP 的 `drawio` / `linear` / `+ Add server`）共用**同一只盒子**。不要给右边那列另起一套高度、内边距、圆角或选中底。

```
属性         token / 值
─────────────────────────────────────────────────────────────────
高度         `--ui-list-h` → `--ui-button-h` → 30px
内边距       6px 8px
间距         12px
圆角         `--ui-list-radius`（10px）
闲置         透明；需要时用 1px 透明边只为对齐盒模型
悬停         `--bg-hover`
选中         `--bg-hover`（同一灰，绝不用白 / `--bg-input`）
```

`+ Add server` 跟 `+ New chat` 是同一种行：普通列表行，字略淡。不要斜体，不要另做一种"添加"样式。

实现：`apps/web/app/styles/base.css` 的 `.ui-list-item` 是唯一来源。MCP 的 `.serverItem` 必须对齐这些数（优先 compose `.ui-list-item`，不要平行再写一套）。

## 尺寸系统——列表行与按钮

列表行保留一套固定尺寸。CSS 变量在 `apps/web/app/styles/base.css`：

```
set         height    radius    css tokens
─────────────────────────────────────────────────────────────────
list        30 px     10 px     --ui-list-h · --ui-list-radius
─────────────────────────────────────────────────────────────────
```

侧栏行、MCP tab 胶囊、MCP 服务器行都走这条 30px 节奏。列表行没有 sm / md / lg：一个位置能挑多种尺寸，每位作者都会跟设计讨价还价，尺寸跟着分叉。

按钮是 shadcn/ui 的 `Button`，**radix-luma** 风格。`apps/web/components/ui/button.tsx` 从官方组件仓库原样复制（`npx shadcn add button`，style `radix-luma`），本地只改了 import 和一层给 React 18 用的 `forwardRef`。所有尺寸都是胶囊（`rounded-4xl`）；调用处从官方尺寸里挑一个，不改样式类。

这些尺寸按 rem 计算，而本 App 的根字号是 14px（`base.css` 里的 `html { font-size: 14px }`，现有约 560 处样式按它调过），所以 shadcn 每个尺寸实际显示为标称值的 7/8：

```
size        App 内高度  App 内字号  用途
─────────────────────────────────────────────────────────────────
xs          21 px       10.5 px    避免使用——字太小
sm          28 px       12.25 px   标签、紧凑的控件行
default     31.5 px     12.25 px   对话框和设置页的操作
lg          35 px       12.25 px   首屏 / 空状态的大操作
icon-sm/default/lg                 方形，在这些高度上就是圆形
─────────────────────────────────────────────────────────────────
```

不能做成 `<Button>` 的元素（自带 ✕ 的 span、渲染成 span 的 Radix 触发器）在 `className` 上用 `cn(buttonVariants({ variant, size }))` 拿同一套外观——`cn()` 合并不能省：原始类名里同时有 `border-transparent` 和变体自己的边框色。

页头那一行（搜索 + tab 胶囊 + 图标按钮）必须同一垂直中线。控件之间差 1–2px 高度是 bug，不是变体。

## 输入框、下拉、边框

输入框和下拉共用**一层 1px** 边（`border: 1px solid var(--border)`，底 `--bg-input`）。

- 不要在这 1px 边上再叠 2px 的 `:focus-visible` 光晕。原生 `<select>` 收起后焦点还在，叠出来就是双层框。
- 悬停必须**保住**这 1px 边。`border-color: transparent` 会让框像消失了一样（MCP catalog 按钮踩过）。
- 不要每个页面另做一套输入框。设置、对话框、插件、MCP 编辑器都用同一套 1px + `--bg-input`。

## 对话框

对话框只做**淡入淡出**（大约 300ms）。不要从上往下滑动，不要突然消失。动的是透明度，不是位移。

## 设置行

设置页（General、Memory、System 以及其余）统一两列：

- **左**：名称左对齐。说明文字留在这一列，不要伸进右边控件
- **右**：控件 / 取值右对齐
- 左右隔开。不要把标签堆在输入框上面
- 状态标签（`LIVE`、`NEXT START` 等）放在对应控件的**左边**，不要一行左一行右

## 按钮变体指南

变体是 shadcn 原版，外加一个本应用自有的 `elevated`；颜色取 shadcn 那组变量（`--primary`、`--secondary`、`--muted`、`--input`、`--ring` 等），`apps/web/app/globals.css` 把它们桥接到每套主题的配色上——换主题就换了按钮配色，按钮本身不用动。

```
variant      闲置                                 悬停
─────────────────────────────────────────────────────────────────
default      bg-primary + primary-foreground      bg-primary/80
outline      1px border-border；深色透明底，       bg-muted（浅色），
             浅色 bg-background                    bg-input/30（深色）
secondary    bg-secondary                         secondary + 5% 墨色
elevated     --bg-input 底，无边框，shadow-sm       shadow-md，+ 5% 墨色
ghost        透明                                 bg-muted（深色 /50）
destructive  bg-destructive/10 + destructive 字   bg-destructive/20
link         primary 字                           下划线
─────────────────────────────────────────────────────────────────
```

所有变体按下时下沉 1px，键盘聚焦时有 3px 的 `ring/30` 光环，禁用时降到 50% 不透明度。

`elevated` 是 Luma 注册表里没有的那一个：Luma 的 Button 没有带阴影的变体（只有 Card 用 `shadow-md`），而输入框周围的胶囊要和输入框一样"无边框、浮起来"。它复用每套主题的 composer 阴影对——`app/globals.css` 的 `@theme` 把它们声明成 `shadow-raised` / `shadow-raised-hover` 工具类——所以胶囊和输入框在每套主题里一起浮起。

按场景选择：

- **主操作**（Run、Save、Test、Apply、发送）→ `default`。
- **次要操作**（Cancel、Close、Reset、Browse）→ `outline` 或 `secondary`。
- **密集行里的控件**（输入框下方的模型 / 思考档位 / 权限触发器、图标开关、环境标签）→ `elevated`：无边框，用和输入框一样的阴影浮在页面上，悬停时阴影加深一档。
- **只在悬停时才需要出现的次要动作** → `ghost`。
- **破坏性操作**（Delete、Remove、停止）→ `destructive`。
- **Deep 表面——侧栏行** → 不用 Button，用 `.ui-list-item` / `nav-classes.ts`。

## 输入框区域的控件

聊天输入框用的是同一套零件：

- 输入框上方的**环境标签**（渠道、网页、项目、工作目录、DAG 浮层按钮）→ `elevated` `sm`；添加目录按钮是 `elevated` `icon-sm`。
- **底部控制栏**（权限、聊天 / 执行模型、思考档位、加号、工具开关、上下文圆环）→ `elevated`，`sm` / `icon-sm`。输入框的 CSS 用 `revert-layer` 把旧的基础规则让回给 Button，不再自己画一套标签。
- **发送** → `icon-sm`：有内容可发时 `default`，空输入时 `ghost`，停止运行时 `destructive`。
- **输入框本体** → 通过每套主题的 `--composer-*` 变量用 shadcn Luma Card 的外观：`--bg-input` 底色、无边框，平时 `shadow-sm`，鼠标悬停或聚焦时 `shadow-md`（阴影透明度浅色主题 0.1、深色 0.25），不加聚焦光环；圆角 23px（一行时是胶囊）。

## 网页预览与浏览器工具栏

聊天上方的网页预览小窗（`components/center-tabs/web-tab-pip.tsx`）是一张 popover 卡片：`bg-popover`，用 `ring-1 ring-foreground/10` 代替边框，`shadow-lg`，四角 10px 圆角，标题栏下方的舞台用同样的底部圆角裁切网页。圆角跟原生网页视图的圆角（`apps/desktop/main/web-views.js`）绑定——原生表面不受 DOM 裁切，外框圆角更大就会在底部两角漏出网页像素，所以两者要一起改，或者都不改。32px 标题栏放标题（`text-sm font-medium text-foreground`）、状态（`text-xs text-muted-foreground`）和 `ghost` `icon-xs` 图标按钮（图标 14px），悬停提示用 `HoverTip` + `TipBody`（见 [hover-tips.zh.md](hover-tips.zh.md)）；恢复失败的提示是一行 `text-xs text-destructive`，不加框。CSS module 只管几何（位置、尺寸、拖动光标、调整把手），因为不分层的 module 规则会压过工具类。

浏览器工具栏的图标按钮（后退 / 前进 / 重新加载 / 主页 / 书签 / 书签库 / 在浏览器中打开 / 菜单，以及控制条）通过 `webToolbarButton()`（`components/center-tabs/toolbar-button.ts`）用同一个 `ghost` Button：取 `icon-sm` 是为了它的 14px 图标规则，由只剩几何的 `.webToolbarBtn` 固定在工具栏自己的 26px，保住 40px 一行的节奏。

## 禁止事项

- 不要每个页面另起一套悬停 / 选中 / 边框。一套配方，反复用。新样子先写进这份文件。
- 不要在未先于此处列出的情况下引入新的胶囊底色。预算内：deep 灰悬停、panel、品牌填充，以及上面的页头 tab `--bg-input` 例外。
- 不要在 deep 表面用品牌色填充。
- 不要用白色 / `--bg-input` 做侧栏或内容区**列表行**的选中底。浅色主题会发白。
- 不要给 MCP 服务器行（或任何内容区列表）另一套高度、内边距或选中底。
- 不要加悬停位移（translate-y、scale-105）。悬停只换背景；唯一的动效是 Button 自带的按下 1px。
- 不要改 `components/ui/button.tsx` 里的官方样式类（`elevated` 是唯一的自有变体），也不要在 CSS 里再写一份仿 Button 的样式。挑一个 `variant` / `size`；旧规则还压着 Button 时，删掉它或用 `revert-layer` 让回去。
- 不要在 1px 输入/下拉边上再叠 2px 聚焦光晕。
- 不要在悬停时丢掉控件的 1px 边。
- 不要让对话框滑动。只淡入淡出。
- 不要让设置说明伸进右侧控件列，也不要把标签堆在控件上面。

## 实现状态

- 已完成：`Button`（radix-luma）、输入框上方的环境标签、底部控制栏、发送按钮、输入框本体、网页预览小窗（外框、标题栏、图标按钮）、浏览器工具栏的图标按钮。
- 尚未迁移：弹出层 / 菜单面板（`MENU_PANEL`、`components/ui/popover.tsx`、`dropdown-menu.tsx`）、提示框、徽标，以及手写样式的 CSS module 弹窗——它们仍用玻璃材质变量（`--glass-*`）。表单输入框和下拉在换成 shadcn input 之前继续遵守上面的 1px 边规则。侧栏列表行继续用上面的列表尺寸。
