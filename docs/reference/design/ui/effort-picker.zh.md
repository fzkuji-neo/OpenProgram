# 思考力度选择卡

从输入框控制行的思考力度触发器点开的卡片，是用户为下一轮对话选择模型推理多久的唯一入口。组件：`apps/web/components/chat/composer/controls/thinking-effort-pill.tsx`；几何：`apps/web/lib/effort-matrix.ts`；样式：`apps/web/app/styles/chat/effort-pill.css`。同在标题行的高速（Fast）开关见 [composer-fast-control.zh.html](composer-fast-control.zh.html)；档位从哪来、怎么传到供应商见 [thinking-effort.zh.md](../providers/models/thinking-effort.zh.md)。

## 结构（自上而下）

| 行 | 内容 | 字号与颜色 |
|---|---|---|
| 标题 | "思考力度"，紧跟当前档位名，右侧依次是 Fast 仪表开关和一个圆圈 `?` 帮助按钮 | 13px；"思考力度"用 `--text-muted`；档位名 medium 字重、`--accent-purple`；两个按钮 24px，悬停前 `--text-muted` |
| 两端标签 | 左"更快"，右"更强" | 12px `--text-muted` |
| 滑轨 | 点阵 + 其上的滑块（20px 高） | 见下 |
| 标注 | 模型默认档位下方的"推荐" | 12px `--text-muted` |

间距：标题→标签 10px，标签→滑轨 10px，滑轨→标注 6px。卡片外框不变——`--surface-popover`、圆角 12、衬 10px、`--border-popover`、`--shadow-popover`——宽度仍是 `.effort-pill-shell[data-expanded="true"]` 上的 220px，窄行时由 composer-row 容器查询收窄。点阵会适配卡片实际拿到的任何宽度。

`?` 按钮挂一个 `HoverTip`，内容是 `TipBody`（标题"思考力度"，细节：模型回答前推理多久；档位越高思考越久、消耗越多 token，越低回答越快；"推荐"标出该模型的默认档位）。Fast 开关原样保留：同一个 class、同一段提示、同样的行为，只是后面多了帮助按钮。

## 滑轨是一片点阵

没有条形轨。`.effort-card` 内把 Radix 滑块自己的轨道、已滑过区和档位刻度点全部涂成透明，其下一张由小圆点组成的 SVG（`<EffortDotMatrix/>`，`effort-dot-matrix.tsx`）充当轨道。滑块根元素仍撑满 20px 的一行，所以在上面任意处点击、拖动、按方向键，和以前一样在档位之间移动。

点由 `lib/effort-matrix.ts` 的 `layoutDotMatrix(trackWidth, thumbX)` 生成，所有可调参数都是那里的具名常量：

| 常量 | 值 | 含义 |
|---|---|---|
| `DOT_PITCH` | 6px | 点心间距，横纵相同 |
| `DOT_ROWS` | 4 | 20px 轨高内叠几排，垂直居中（y = 1、7、13、19） |
| `DOT_RADIUS` | 0.75 → 2 | 半径随 x 线性增大：最左 1.5px 的点，最右 4px |
| `DOT_OPACITY.behind` | 0.22 → 0.42 | 滑块已滑过的点的不透明度区间 |
| `DOT_OPACITY.ahead` | 0.32 → 1 | 滑块前方的点的不透明度区间 |
| `THUMB_WIDTH` / `TRACK_HEIGHT` | 16 / 20 | Radix 滑块命中盒宽；轨高 |

生成方式：`cols = floor(trackWidth / DOT_PITCH)`，余下宽度两边平分使网格居中；第 `c` 列位于 `x0 + c * DOT_PITCH`，进度 `t = c / (cols - 1)`。半径和不透明度都是对 `t` 的线性插值，所以两条渐变沿 x 连续，不按档位分级。点心在滑块中心右侧即为"前方"：前方的点用 ahead 区间、填 `--accent-purple`；已滑过的点用 behind 区间、填 `currentColor`（svg 上设为 `--text-muted`）。颜色从不写死，浅色主题同样得到灰色碎点和淡紫色的点阵场。200px 的轨道画 33 × 4 = 132 个圆。

第 `n` 档中第 `i` 档的滑块中心在 `i / (n - 1) * (trackWidth - THUMB_WIDTH) + THUMB_WIDTH / 2`——与 Radix 自己的算法一致，首尾两档各离边缘半个滑块。pill 用 `ResizeObserver` 测轨宽，每次变化重新排布点阵。

点阵本身是静态的。唯一的动效是滑块移动时点从"前方"变"已滑过"的 160ms `fill` / `fill-opacity` 过渡；`prefers-reduced-motion: reduce` 下取消。最高档（`max`）时，滑块已滑过区里原有的 `<UltraRain/>` canvas 仍把这一侧画成紫色 Ultracode 像素矩阵，点阵只在它左侧未填满的边缘露出。

## 滑块与提示

滑块是 16 × 20、圆角 6 的小块，`--effort-thumb`（浅色主题白色，深色主题纸色），`--shadow-sm`。指针停在上面、拖动它、或用键盘聚焦它，会在其上方 6px 处显示档位名（"Max"、"XHigh"……）的小徽章，样式同 `.hover-tip`（`--surface-tooltip` / `--text-on-tooltip`）。

这个提示是普通定位元素，不是 Radix tooltip。两个标志任一成立时，pill 在滑块根元素上标 `data-thumb-tip="true"`：*hover*——在根元素的指针事件里用指针 x 与滑块包围盒比较得出（滑块子元素本身保持 `pointer-events: none`，这样按下时 Radix 照旧聚焦它的滑块）；*dragging*——根元素 pointerdown 置位，window 的 `pointerup` / `pointercancel` 清除。有拖动标志，滑块在移动的指针下跳档时提示才不会抖。键盘聚焦通过 `[role="slider"]:focus-visible` 显示同一个徽章。徽章没有过渡，所以不会闪。

## 推荐

`ThinkingOption`（`use-thinking-effort.ts`）带 `recommended?: boolean`。hook 标记用户没选时模型回落到的档位：后端的 `default`（服务端随每个非空档位列表一起下发——模型声明的默认档，否则取中间档）、agent 调用的 `defaultThinking`，或水合前回退列表里的 `medium`。卡片在该档位的滑块位置下方印"推荐"。标注以该位置居中，但首档对齐轨道左缘、末档对齐右缘（`captionAlignment`），文字不会伸出卡片。

## 交互与状态

不变：点触发器打开卡片，点卡片外部关闭（由 `composer/index.tsx` 负责）；选择经 `onValueChange → setThinking`，不关卡片；Radix 滑块的键盘处理和 aria 保留（`aria-valuenow` 是档位序号）。所有文案走 `useTranslation().text(en, zh)`。

## 文件

- `apps/web/components/chat/composer/controls/thinking-effort-pill.tsx` — 卡片
- `apps/web/components/chat/composer/controls/effort-dot-matrix.tsx` — svg
- `apps/web/components/chat/composer/controls/use-thinking-effort.ts` — 档位与 `recommended` 标志
- `apps/web/lib/effort-matrix.ts` — 几何与可调参数
- `apps/web/app/styles/chat/effort-pill.css` — 卡片、点阵、帮助按钮、滑块提示、标注
- `apps/web/tests/chat/effort-matrix.test.mjs` — 固定几何

## 实现状态

- 标题行、点阵滑轨、滑块提示、"推荐"标注、减少动效处理、主题派生颜色：**已实现**。
- `?` 图标用 lucide `CircleHelp`；Solar 的 `question-circle` 尚未取回（见 [icons.zh.md](icons.zh.md)）。
- 滑块上用 `aria-valuetext` 报档位名：**未实现**——`components/ui/slider.tsx` 不透出滑块属性，滑块报的是档位序号。
