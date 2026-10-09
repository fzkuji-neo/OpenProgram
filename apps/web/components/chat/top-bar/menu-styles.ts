import { GLASS_SURFACE } from "@/lib/glass";

/**
 * Canonical Tailwind class strings for ALL popover selection menus — the
 * single source of truth so every dropdown / context menu in the app is
 * visually identical: topbar pickers (channel / branch / project /
 * agent), the sidebar Recents context menu, and any future one.
 *
 * ── Design spec (Claude-style elevated card) ─────────────────────────
 *  Panel (MENU_PANEL): glass material (lib/glass.ts GLASS_SURFACE:
 *    translucent --surface-popover + backdrop blur, 0.5px hairline
 *    border, layered --glass-shadow, 10px radius) · 6px padding ·
 *    scrolls past 60vh.
 *  Row (itemCls):      min 24px tall · 6px radius · 0 10px padding ·
 *    13px/18px text · 8px icon↔label gap · hover = `--bg-hover` tint +
 *    `--text-bright`, and hover is the ONLY row tint (a selected row
 *    shows a right-aligned check, never a fill). danger = red text +
 *    faint red hover. Radix items add MENU_ITEM_STATES so keyboard
 *    highlight and the disabled look follow the same rule.
 *  Section label (GROUP_LABEL): 12px `--text-muted`, 21px line, 0 10px.
 *  Separator (MENU_SEPARATOR): 1px `--border`, 6px vertical margin,
 *    full-bleed. Key hint (SHORTCUT) · trailing check (CHECK_SLOT) with
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
  // 6px 衬、行自带圆角 hover（用户点名不要 Claude 的通铺行）。
  // 宽度贴内容（Claude Code 的 Mode 菜单实测：面板宽 = 最长一行 + 右
  // 列）：不设 min-width，封顶 360px 后行内 truncate。只有内容本身需要
  // 固定宽度的菜单（git 的分支列表 + 搜索框）才自带 w-[…]。
  "flex max-h-[60vh] max-w-[360px] flex-col overflow-y-auto p-[6px] " + GLASS_SURFACE;

export const GROUP_LABEL =
  // Claude 实测：标题 12px / 行 13px，块高 21px、底缘贴第一行。
  // 不做光学补偿——Claude 也没做，圆弧首字母的微小内缩感是字形
  // 固有属性，接受它。
  "flex items-center gap-[6px] px-[10px] py-0 leading-[21px] " +
  "text-[12px] text-text-muted";

export const CHECK = "shrink-0 text-[var(--accent-blue)]";

/** Grammar-A selection check — the Claude pattern for single-select
 *  menus: the SELECTED row shows a right-aligned lucide Check (14px) in
 *  ink colour; selection is NEVER a filled/shaded row (hover is the only
 *  bg tint). Any muted metadata (shortcut digit, badge) sits right-
 *  aligned BEFORE this check. Non-selected rows render CHECK_SLOT_PAD so
 *  right-side metadata stays column-aligned across rows. */
export const CHECK_SLOT = "shrink-0 text-text-bright";
export const CHECK_SLOT_PAD = "w-[14px] shrink-0";

/** Right-aligned single-key shortcut hint (e.g. the R / P / C / A / D in
 *  the Recents context menu). Stays muted — doesn't brighten with the
 *  row on hover. */
// 13px 与行文本同字号（菜单内字号统一），弱化只靠 muted 色。
export const SHORTCUT = "shrink-0 text-[13px] text-text-muted";

/** Full-bleed divider between menu groups. The negative inline margin
 *  cancels MENU_PANEL's 6px padding so the line spans edge to edge. */
export const MENU_SEPARATOR = "-mx-[6px] my-[6px] h-px shrink-0 bg-[var(--border)]";

/** Two-line row — a title with a description under it — added to
 *  itemCls. Claude Code's Mode menu measured: 3px vertical padding +
 *  13/18 title + 12/16 description = 40px, hover fill still the row's
 *  own 6px-radius rectangle. The right column (check / shortcut) of such
 *  a row is wrapped in an 18px-tall centred flex so it sits on the title
 *  line, level with the single-line rows of other menus. */
export const ITEM_TWO_LINE = "items-start py-[3px]";
export const ITEM_TITLE = "block truncate text-text-bright";
export const ITEM_DESC =
  "block whitespace-normal text-[12px] leading-[16px] text-text-muted";

/** Inline metadata tag after a row's title ("Recommended", a channel
 *  account alias, git's "current" / "worktree") — the `.menu-tag` class
 *  in app/styles/chat/top-bar-chips.css: 11px muted on a 9% foreground
 *  mix, 16px line, 0 6px padding. One tag for every menu. */
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
 *  `danger` makes it a destructive (red) action. 24px tall, the
 *  claude.ai/code menu-row height. */
export function itemCls(active: boolean, danger = false): string {
  const base =
    // 24 / 13px / 18px = claude.ai/code 菜单行实测高度；行保持圆角
    // "按钮"hover（用户点名不要通铺）。侧栏列表行仍是 32。
    "flex min-h-[24px] shrink-0 cursor-pointer items-center gap-[8px] rounded-[6px] " +
    "px-[10px] text-[13px] leading-[18px] transition-colors duration-75 ";
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
