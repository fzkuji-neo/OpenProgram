# 表面系统

UI 分为两个**表面上下文**。每个表面有各自的交互语言，眼睛能一眼分清当前停在哪一层：导航层还是内容层。这些规则同时约束**浅色和深色**主题。浅色主题最容易踩坑（浅灰侧栏上铺白底）。

## 两个表面

```
─────────────────────────────────────────────────────────────────
surface        background tone           where it lives
─────────────────────────────────────────────────────────────────
deep           `--bg` /                  左侧栏、右侧栏
               `--bg-secondary`          （branches / worktrees /
                                         mini-DAG）
─────────────────────────────────────────────────────────────────
panel          略抬升的                  聊天流、设置页、对话框、
               `--bg-surface` /          function-card 网格、
               `--bg-tertiary`           attach 卡片、runtime 块
─────────────────────────────────────────────────────────────────
```

**deep** 与 **panel** 之间的抬升是有意的——它替代聊天内容列上显式的边框 / 阴影，让气泡区读起来像一张浮在导航之上的纸。

## 各表面的交互语言

鼠标点按钮不画外圈焦点环。键盘聚焦普通按钮只轻微提高亮度，不用 outline 或 box-shadow。顶部 `role="tab"` 是唯一例外：用当前主题的 `--focus-ring`，深色更亮，浅色更深。

### Deep 表面（侧边栏）

deep 表面上的组件是**列表行**——会话项、分支、收藏，以及内容区里同一套行（MCP 的 `drawio` / `linear` / `+ Add server`）。它们不应当表现得像按钮：

- 闲置：无边框、无描边、无填充
- 悬停 / 选中：背景换成**看得出的灰色**（``--bg-hover`` / ``--bg-selected``），文字仍是 ``--text-primary`` 或 ``--text-secondary``
- 选中行**禁止**用 ``--bg-input`` 填充。浅色主题里这个 token 是白的，铺在浅灰侧栏上会发白、发淡
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

按钮是 shadcn/ui 的 `Button`，**radix-luma** 风格。`apps/web/components/ui/button.tsx` 从官方组件仓库原样复制（`npx shadcn add button`，style `radix-luma`），本地只改了 import 和一层给 React 18 用的 `forwardRef`。所有尺寸都是胶囊（`rounded-4xl`）；调用处从官方尺寸里挑一个，不改样式类：

```
size        height    text     用途
─────────────────────────────────────────────────────────────────
xs          24 px     12 px    标签、紧凑的控件行
sm          32 px     14 px    密集工具栏、行内操作
default     36 px     14 px    对话框和设置页的操作
lg          40 px     14 px    首屏 / 空状态的大操作
icon-xs/sm/default/lg          方形，在这些高度上就是圆形
─────────────────────────────────────────────────────────────────
```

不能做成 `<Button>` 的元素（自带 ✕ 的 span、渲染成 span 的 Radix 触发器）在 `className` 上用 `buttonVariants({ variant, size })` 拿同一套外观。

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

变体就是 shadcn 原版，不改；颜色取 shadcn 那组变量（`--primary`、`--secondary`、`--muted`、`--input`、`--ring` 等），`apps/web/app/globals.css` 把它们桥接到每套主题的配色上——换主题就换了按钮配色，按钮本身不用动。

```
variant      闲置                                 悬停
─────────────────────────────────────────────────────────────────
default      bg-primary + primary-foreground      bg-primary/80
outline      1px border-border；深色透明底，       bg-muted（浅色），
             浅色 bg-background                    bg-input/30（深色）
secondary    bg-secondary                         secondary + 5% 墨色
ghost        透明                                 bg-muted（深色 /50）
destructive  bg-destructive/10 + destructive 字   bg-destructive/20
link         primary 字                           下划线
─────────────────────────────────────────────────────────────────
```

所有变体按下时下沉 1px，键盘聚焦时有 3px 的 `ring/30` 光环，禁用时降到 50% 不透明度。

按场景选择：

- **主操作**（Run、Save、Test、Apply、发送）→ `default`。
- **次要操作**（Cancel、Close、Reset、Browse）→ `outline` 或 `secondary`。
- **密集行里的安静控件**（输入框下方的模型 / 思考档位 / 权限触发器、图标开关）→ `ghost`。
- **破坏性操作**（Delete、Remove、停止）→ `destructive`。
- **Deep 表面——侧栏行** → 不用 Button，用 `.ui-list-item` / `nav-classes.ts`。

## 输入框区域的控件

聊天输入框用的是同一套零件：

- 输入框上方的**环境标签**（渠道、网页、项目、工作目录、DAG 浮层按钮）→ `outline` `xs`；添加目录按钮是 `outline` `icon-xs`。
- **底部控制栏**（权限、聊天 / 执行模型、思考档位、加号、工具开关、上下文圆环）→ `ghost` `xs` / `icon-xs`。输入框的 CSS 用 `revert-layer` 把旧的基础规则让回给 Button，不再自己画一套标签。
- **发送** → `icon-xs`：有内容可发时 `default`，空输入时 `ghost`，停止运行时 `destructive`。
- **输入框本体** → 通过每套主题的 `--composer-*` 变量用 shadcn Luma input-group 的配方：`bg-input/50`，闲置无边框，聚焦时 1px `--ring` 边加 3px `ring/30` 光环；圆角 23px（一行时是胶囊）。

## 禁止事项

- 不要每个页面另起一套悬停 / 选中 / 边框。一套配方，反复用。新样子先写进这份文件。
- 不要在未先于此处列出的情况下引入新的胶囊底色。预算内：deep 灰悬停、panel、品牌填充，以及上面的页头 tab `--bg-input` 例外。
- 不要在 deep 表面用品牌色填充。
- 不要用白色 / `--bg-input` 做侧栏或内容区**列表行**的选中底。浅色主题会发白。
- 不要给 MCP 服务器行（或任何内容区列表）另一套高度、内边距或选中底。
- 不要加悬停位移（translate-y、scale-105）。悬停只换背景；唯一的动效是 Button 自带的按下 1px。
- 不要改 `components/ui/button.tsx` 里的样式类，也不要在 CSS 里再写一份仿 Button 的样式。挑官方的 `variant` / `size`；旧规则还压着 Button 时，删掉它或用 `revert-layer` 让回去。
- 不要在 1px 输入/下拉边上再叠 2px 聚焦光晕。
- 不要在悬停时丢掉控件的 1px 边。
- 不要让对话框滑动。只淡入淡出。
- 不要让设置说明伸进右侧控件列，也不要把标签堆在控件上面。

## 实现状态

- 已完成：`Button`（radix-luma）、输入框上方的环境标签、底部控制栏、发送按钮、输入框本体。
- 尚未迁移：弹出层 / 菜单面板（`MENU_PANEL`、`components/ui/popover.tsx`、`dropdown-menu.tsx`）、提示框、徽标，以及手写样式的 CSS module 弹窗——它们仍用玻璃材质变量（`--glass-*`）。表单输入框和下拉在换成 shadcn input 之前继续遵守上面的 1px 边规则。侧栏列表行继续用上面的列表尺寸。
