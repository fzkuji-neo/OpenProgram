# 图标体系

Web 端用三族图标。每一族有自己的地盘，一个界面里不会无意间把实心图标和线性图标并排放在一起。

| 族 | 地盘 | 包 / 来源 | 许可 |
|---|---|---|---|
| **Solar**（Bold Duotone） | 输入框区域：环境条 chip、控制行及其 + 菜单、模型 / 权限徽章、思考力度 pill、提问 / 审批面板、发送箭头 | `apps/web/components/solar-icons`——图标主体由 `apps/web/scripts/icons/fetch-solar.mjs` 从 Iconify 的 `solar` 集合取回，落在 `bodies.ts` | CC BY 4.0，Solar Icons by 480 Design |
| **pqoqubbw 动效线性图标** | 输入框以外的外壳：左侧 rail、中央标签页、侧栏、设置导航、功能卡片、DAG 视图 | `apps/web/components/animated-icons` | MIT |
| **lucide-react** | 其余不需要动效的地方：时间线行、设置正文、对话框 | `lucide-react` | ISC |

供应商 logo 来自 LobeHub（`components/settings/lobe-icons.ts`），头像来自 DiceBear identicon，二者不在本约定之内。

没有人手画图标 SVG。要加一个 Solar 图标，就在 `fetch-solar.mjs` 的 `ICONS` 里加一项再跑一遍；生成文件提交进仓库，构建不依赖网络。

## 输入框区域用 Solar

在输入框 14–16px 的尺寸下，双色图标看起来像是为这个功能专门设计的，线性图标则显得通用。所有 Solar 图标统一用 Bold Duotone 一种样式：实心主体 + 浅一档（50% 透明）的副层。

| 位置 | Solar 图标 |
|---|---|
| `+` 选项触发 | `tuning-2` |
| 添加文件 | `paperclip` |
| 工具 | `case-minimalistic` |
| 工具配置 | `settings-minimalistic` |
| 网页搜索 | `global` |
| 沙箱 | `box-minimalistic` |
| 运行中：注入 / 排队 | `forward` / `list-arrow-down` |
| 无人值守 关 / 开 | `eye` / `eye-closed` |
| 思考力度 | `dumbbell-large-minimalistic` |
| Chat 模型 / 执行模型徽章 | `chat-round-dots` / `programming` |
| 权限徽章 | `shield-check` |
| Local 连接 chip | `monitor` |
| 网页标签 chip | `earth` |
| 画中画 chip | `pip-2` |
| 工作目录 / 添加目录 | `folder-with-files` / `add-folder` |
| 项目 chip / 项目目录丢失 | `folder-open` / `danger-triangle` |
| 菜单勾选 | `check-circle` |
| 关闭 × | `close-circle` |
| 展开箭头 | `alt-arrow-right`、`alt-arrow-down` |
| 发送 | `plain-2`（纸飞机） |
| 复制 | `copy` |
| 模型能力（视觉 / 视频 / 工具 / 推理） | `eye` / `videocamera` / `case-minimalistic` / `lightbulb-bolt` |
| Git 胶囊 / 其菜单：新建分支或 worktree、worktree、PR、查看 PR | `git-branch` / `add-circle`、`folder-path-connect`、`git-pull-request`、`square-arrow-right-up` |
| 文件修改卡片：标题 / 文件行 | `pen-new-square` / `file-text` |
| 文件修改卡片：撤回 / Review 按钮 | Font Awesome `rotate-left` / `eye`（实心），图标 + 文字 |

Solar 的撤回图标都是细线箭头，在按钮尺寸下几乎看不见，所以文件卡片的两个操作按钮改用 Font Awesome 的实心图标，由同一个脚本取回、放进同一张表（viewBox 记在 `SOLAR_VIEWBOXES`）。

反映开关的图标随状态换形，而不只靠颜色：无人值守开启后眼睛闭上；运行中模式"注入"是前进箭头、"排队"是队列列表；项目目录丢失时项目 chip 变成警告三角。

高速（Fast）开关是输入框区域唯一**不是** Solar 的图标：它保留动效集里的仪表盘，由 `active` 属性转动指针。见文末实现状态。

## 动效约定

三族图标都讲同一套命令式句柄 `AnimatedNavIconHandle`（`startAnimation` / `stopAnimation`）：容器——按钮、菜单行、chip——才是悬停目标，图标自己 16px 的命中区从不单独动。父级挂上 ref 就接管驱动；没有 ref 的 Solar 图标跟随最近的可点击祖先（按钮、链接、菜单项、chip）的悬停，所以不论有没有接 ref，每个按钮的表现都一样；纯展示的图标——菜单勾、警告三角、模型能力标记——用 `none`。

pqoqubbw 图标会自己重绘（扳手转一下、箭头跳一下）。实心的 Solar 图标做不到，所以 `SolarIcon` 提供几种克制而统一的预设：`pop`（放大到 1.12，默认）、`fly`（发送纸飞机向右上飞 1.5px）、`nudge`（箭头右移 1.5px）、`pulse`（一次性弹入，用于菜单项变为勾选时）和 `none`。`prefers-reduced-motion` 下全部不动。

`SolarIcon` 在 `<svg>` 外包一层 `span.inline-flex`，与动效图标的包裹层同构，容器里按"装着 svg 的那个元素"去定尺寸或隐藏的 CSS 继续有效。

## 署名

Solar Icons © 480 Design，CC BY 4.0（<https://github.com/480-Design/Solar-Icon-Set>）。两个 Font Awesome 图标来自 Font Awesome Free，© Fonticons，CC BY 4.0（<https://fontawesome.com/license/free>）。声明放在 `bodies.ts` 文件头和本页；面向用户的致谢条目尚未添加（见下）。

## 实现状态

- 输入框区域换成 Solar，含环境条 chip、+ 菜单、提问 / 审批面板，以及经 `components/chat/top-bar` 共用的模型 / 权限徽章：**已实现**。
- 高速开关改为状态驱动的仪表盘（关时指针停在低速区，开时甩到高速区并变成强调红）：**未实现**——目前仍是动效集的仪表盘加静态 `active` 旋转。
- 面向用户的 Solar 第三方致谢（CC BY）：**未实现**。
- rail、标签页、侧栏、设置仍用动效线性集，不计划迁移。
