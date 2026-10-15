import { GLASS_SURFACE } from "@/lib/glass";

/**
 * Canonical Tailwind class strings for ALL popover selection menus — the
 * single source of truth so every dropdown / context menu in the app is
 * visually identical: topbar pickers (channel / branch / project /
 * agent), the sidebar Recents context menu, and any future one.
 *
 * ── Design spec (Claude desktop menu, compact density) ──────────────
 *  Panel (MENU_PANEL): glass material (lib/glass.ts GLASS_SURFACE,
 *    10px radius = 6px row radius + 4px padding) · 4px padding ·
 *    width hugs content, 128–320px · scrolls past 60vh.
 *  Row (itemCls):      24px tall (2.5px + 19px line + 2.5px) · 6px
 *    radius · 0 8px padding · 13px/19px text · 6px icon↔label gap, a
 *    leading icon pulled 3px left (Solar glyphs carry their own margin) ·
 *    hover = `--bg-hover` fill, the ONLY row tint (a selected row shows
 *    a right-aligned blue check, never a fill). danger = red text +
 *    faint red hover. Radix items add MENU_ITEM_STATES so keyboard
 *    highlight and the disabled look follow the same rule.
 *  Two-line row (ITEM_TWO_LINE): 2.5px top, 4px bottom, 13/19 title +
 *    12/15 description = 40.5px.
 *  Section label (GROUP_LABEL): 4px 8px padding, 12px/15px, weight 500,
 *    `--text-muted`.
 *  Separator (MENU_SEPARATOR): 1px `--border`, 4px vertical margin,
 *    inset 8px like the row text. Trailing column (MENU_TRAILING): 12px
 *    from the content, 6px between check and key hint (SHORTCUT, 12px
 *    tabular digits) · check (MenuCheck, 16px bold, accent blue) with
 *    CHECK_SLOT_PAD reserving the column on unselected rows.
 *
 *  The radix PopoverContent wrapper MUST be transparent
 *  (`border-0 bg-transparent p-0 shadow-none`) — the frame is always
 *  MENU_PANEL, never the wrapper, so every menu shares one frame.
 *  DropdownMenuContent carries no frame of its own, so MENU_PANEL goes
 *  straight on it.
 */

export const MENU_PANEL =
  // 10px 圆角 = 输入框同刻度（用户定的统一规则）；边缘走真 border
  // （0.5px 发丝线），shadow 只投影。面板是玻璃材质（GLASS_SURFACE，
  // 半透明 + 背景模糊），全应用弹窗共用。行保持"按钮"形态：面板四周
  // 4px 衬、行自带圆角 hover（用户点名不要 Claude 的通铺行）。
  // 尺寸照 Claude 桌面端菜单：面板 4px 衬，宽度贴内容、128–320px，
  // 超宽时行内 truncate。只有内容本身需要固定宽度的菜单（git 的分支
  // 列表 + 搜索框）才自带 w-[…]。
  "flex max-h-[60vh] min-w-[128px] max-w-[320px] flex-col overflow-y-auto p-[4px] " + GLASS_SURFACE;

export const GROUP_LABEL =
  // Claude：4px 8px 衬，12px / 15px，字重 500，muted 色。
  "flex items-center gap-[6px] px-[8px] py-[4px] leading-[15px] " +
  "text-[12px] font-medium text-text-muted";

export const CHECK = "shrink-0 text-[var(--accent-blue)]";

/** Grammar-A selection check — the Claude pattern for single-select
 *  menus: the SELECTED row shows a right-aligned bold Check (16px,
 *  MenuCheck) in accent blue; selection is NEVER a filled/shaded row (hover is the only
 *  bg tint). Any muted metadata (shortcut digit, badge) sits right-
 *  aligned BEFORE this check. Non-selected rows render CHECK_SLOT_PAD so
 *  right-side metadata stays column-aligned across rows. */
export const CHECK_SLOT = "shrink-0 text-[var(--accent-blue)]";
export const CHECK_SLOT_PAD = "w-[16px] shrink-0";

/** Right-aligned single-key shortcut hint (e.g. the R / P / C / A / D in
 *  the Recents context menu). Stays muted — doesn't brighten with the
 *  row on hover. */
// Claude：12px 等宽数字，muted 色。
export const SHORTCUT = "shrink-0 text-[12px] tabular-nums text-text-muted";

/** Right column of a row (check, then key hint): 12px from the content,
 *  6px between its items. On a two-line row it is one title line tall
 *  (19px) and sits on the title. */
export const MENU_TRAILING = "ms-[12px] flex h-[19px] shrink-0 items-center gap-[6px]";

/** Divider between menu groups, inset 8px like the row text. */
export const MENU_SEPARATOR = "mx-[8px] my-[4px] h-px shrink-0 bg-[var(--border)]";

/** Two-line row — a title with a description under it — added to
 *  itemCls. Claude's Mode menu: 2.5px top + 13/19 title + 12/15
 *  description + 4px bottom = 40.5px, hover fill still the row's own
 *  6px-radius rectangle. Its MENU_TRAILING column sits on the title. */
export const ITEM_TWO_LINE = "items-start pt-[2.5px] pb-[4px]";
export const ITEM_TITLE = "block truncate text-text-bright";
export const ITEM_DESC =
  "block whitespace-normal text-[12px] leading-[15px] text-text-muted";

/** Inline metadata tag after a row's title ("Recommended", a channel
 *  account alias, git's "current" / "worktree") — the `.menu-tag` class
 *  in app/styles/chat/top-bar-chips.css: Claude's xxs neutral badge,
 *  16px tall, 0 4px padding, 4px radius, 10px/500 secondary text on a
 *  5% foreground mix. One tag for every menu. */
export const MENU_TAG = "menu-tag";

/** The states a radix DropdownMenu / ContextMenu row exposes as data
 *  attributes, mapped onto the itemCls hover rule: keyboard highlight
 *  (radix sets `data-highlighted` on the focused item) and an open
 *  sub-trigger tint the same as hover; a disabled row dims and keeps
 *  pointer events so its `title` can still explain why. */
export const MENU_ITEM_STATES =
  "select-none outline-none " +
  "data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-bright " +
  "data-[state=open]:bg-bg-hover data-[state=open]:text-text-bright " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/** A selectable menu row — `active` swaps the resting / hover colours;
 *  `danger` makes it a destructive (red) action. 24px tall, Claude's
 *  compact control height. */
export function itemCls(active: boolean, danger = false): string {
  const base =
    // Claude 紧凑档：13px / 19px，上下 2.5px → 24px，左右 8px，图标与
    // 文字间 6px；行保持圆角"按钮"hover。侧栏列表行仍是 32。
    // 行首图标左移 3px：Solar 图标字形四周自带留白，不收的话看起来
    // 比文字行缩进得多（用户反馈）。
    "flex min-h-[24px] shrink-0 cursor-pointer items-center gap-[6px] rounded-[6px] " +
    "px-[8px] py-[2.5px] text-[13px] leading-[19px] transition-colors duration-75 " +
    "[&>:first-child:is(svg,:has(svg))]:-ms-[3px] ";
  if (danger) {
    return (
      base +
      "text-[var(--accent-red)] hover:text-[var(--accent-red)] " +
      "hover:bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]"
    );
  }
  return (
    base +
    (active
      ? "bg-bg-hover text-text-bright"
      : "text-text-primary hover:bg-bg-hover hover:text-text-bright")
  );
}
