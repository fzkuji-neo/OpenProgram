"use client";

/**
 * ConvMenu — the right-click / ⋯ context menu for a Recents row.
 *
 * Presentational only: it renders the menu item list and the "Move to
 * group" / "Move to project" / "Export" submenus, which fly out to the
 * right on hover like Claude's, and calls back to the parent (ConvItem in
 * sessions-list.tsx) for every action. The Popover shell + open state
 * live in the parent so the same menu can be opened by either the ⋯
 * button or a right-click on the row.
 *
 * Items mirror Claude.ai's conversation menu, minus the ones we have
 * no backing infra for (Open in / Mark as read / Share). Each item
 * shows a right-aligned single-key shortcut; while the menu is open,
 * pressing that key fires the item (menu-local, see onKeyDown).
 */

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { useTranslation } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  GROUP_LABEL,
  MENU_PANEL,
  MENU_SEPARATOR,
  SHORTCUT,
  itemCls,
} from "@/components/chat/top-bar/menu-styles";

export interface ConvMenuConv {
  id: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  group?: string;
}

/** A project the chat can be moved into. */
export interface ConvMenuProject { id: string; name: string }

export interface ConvMenuProps {
  conv: ConvMenuConv;
  /** Existing group names across all conversations, for the
   *  "Move to group" sub-list. */
  groups: string[];
  /** The other projects, for the "Move to project" sub-list; the chat's
   *  own project is left out. Absent until the registry has answered. */
  projects?: ConvMenuProject[];
  onMoveToProject?: (projectId: string) => void;
  onRename: () => void;
  onAutoRename: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  /** "" ungroups; any other string assigns/creates that group. */
  onMoveToGroup: (group: string) => void;
  onNewGroup: () => void;
  onCopyLink: () => void;
  /** Download the session as a file; the format picks the renderer. */
  onExport: (format: "md" | "html") => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ConvMenu({
  conv,
  groups,
  onRename,
  onAutoRename,
  onTogglePin,
  onToggleArchive,
  onMoveToGroup,
  onNewGroup,
  projects,
  onMoveToProject,
  onCopyLink,
  onExport,
  onDelete,
  onClose,
}: ConvMenuProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);

  // Focus the menu on mount so menu-local key shortcuts work without
  // an extra click.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  function run(fn: () => void) {
    fn();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Single-key shortcuts mirror Claude's menu. Ignore when a
    // modifier is held so they don't hijack browser shortcuts.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "r") { e.preventDefault(); run(onRename); }
    else if (k === "p") { e.preventDefault(); run(onTogglePin); }
    else if (k === "c") { e.preventDefault(); run(onCopyLink); }
    else if (k === "a") { e.preventDefault(); run(onToggleArchive); }
    else if (k === "d") { e.preventDefault(); run(onDelete); }
    else if (k === "escape") { e.preventDefault(); onClose(); }
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`${MENU_PANEL} min-w-[200px] outline-none`}
    >
      <MenuItem label={t("sidebar.rename")} shortcut="R" onClick={() => run(onRename)} />
      <MenuItem label={t("sidebar.auto_rename")} onClick={() => run(onAutoRename)} />
      <MenuItem
        label={conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
        shortcut="P"
        onClick={() => run(onTogglePin)}
      />

      <Flyout label={t("sidebar.move_to_group")}>
        {conv.group ? (
          <SubItem
            label={t("sidebar.remove_from_group")}
            onClick={() => run(() => onMoveToGroup(""))}
          />
        ) : null}
        {groups
          .filter((g) => g && g !== conv.group)
          .map((g) => (
            <SubItem key={g} label={g} onClick={() => run(() => onMoveToGroup(g))} />
          ))}
        <SubItem
          label={t("sidebar.new_group")}
          accent
          onClick={() => run(onNewGroup)}
        />
      </Flyout>

      {/* Dragging the row onto a project header does the same thing. */}
      {projects && onMoveToProject && projects.length > 0 && (
        <Flyout label={t("sidebar.move_to_project")}>
          {projects.map((project) => (
            <SubItem key={project.id} label={project.name} onClick={() => run(() => onMoveToProject(project.id))} />
          ))}
        </Flyout>
      )}

      <MenuItem label={t("sidebar.copy_link")} shortcut="C" onClick={() => run(onCopyLink)} />

      <Flyout label={t("sidebar.export")}>
        <SubItem label={t("sidebar.export_markdown")} onClick={() => run(() => onExport("md"))} />
        <SubItem label={t("sidebar.export_html")} onClick={() => run(() => onExport("html"))} />
      </Flyout>

      <MenuItem
        label={conv.archived ? t("sidebar.unarchive") : t("sidebar.archive")}
        shortcut="A"
        onClick={() => run(onToggleArchive)}
      />

      <div className={MENU_SEPARATOR} />

      <MenuItem
        label={t("sidebar.delete")}
        shortcut="D"
        danger
        onClick={() => run(onDelete)}
      />
    </div>
  );
}

/** The menu of a row inside a multi-chat selection: what applies to all
 *  of them at once. */
export function BulkConvMenu({
  count,
  groups,
  projects,
  onMoveToProject,
  onMoveToGroup,
  onArchive,
  onClear,
  onClose,
}: {
  count: number;
  groups: string[];
  projects?: ConvMenuProject[];
  onMoveToProject?: (projectId: string) => void;
  onMoveToGroup: (group: string) => void;
  onArchive: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t, text } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.focus(); }, []);
  const run = (fn: () => void) => { fn(); onClose(); };
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      className={`${MENU_PANEL} min-w-[200px] outline-none`}
    >
      <div className={GROUP_LABEL}>{text(`${count} chats selected`, `已选 ${count} 个聊天`)}</div>
      {projects && onMoveToProject && projects.length > 0 && (
        <Flyout label={t("sidebar.move_to_project")}>
          {projects.map((project) => (
            <SubItem key={project.id} label={project.name} onClick={() => run(() => onMoveToProject(project.id))} />
          ))}
        </Flyout>
      )}
      <Flyout label={t("sidebar.move_to_group")}>
        <SubItem label={t("sidebar.remove_from_group")} onClick={() => run(() => onMoveToGroup(""))} />
        {groups.filter(Boolean).map((g) => (
          <SubItem key={g} label={g} onClick={() => run(() => onMoveToGroup(g))} />
        ))}
      </Flyout>
      <MenuItem label={t("sidebar.archive")} onClick={() => run(onArchive)} />
      <div className={MENU_SEPARATOR} />
      <MenuItem label={text("Clear selection", "取消选择")} onClick={() => run(onClear)} />
    </div>
  );
}

/* ---- item primitives ------------------------------------------- */

type Point = [number, number];

/** The submenu the pointer is heading for: while the pointer stays inside
 *  `area` (the triangle from where it left the row to the submenu's near
 *  edge), that submenu stays open and other rows don't open theirs. */
const safeArea: { owner: symbol | null; area: Point[] | null } = { owner: null, area: null };

function inside([x, y]: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** A row that opens its submenu to the right while the pointer is on it
 *  (or on click / ArrowRight), like Claude's "Open in ›". Leaving the row
 *  toward the submenu, or resting in the gap between the two, keeps it
 *  open (a safe triangle, as in Claude's and Radix's menus). */
function Flyout({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => Symbol("flyout"));
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const stopTracking = useRef<(() => void) | null>(null);

  const release = () => {
    stopTracking.current?.();
    stopTracking.current = null;
    if (safeArea.owner === id) { safeArea.owner = null; safeArea.area = null; }
  };
  const show = () => {
    window.clearTimeout(closeTimer.current);
    release();
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    release();
    setOpen(false);
  };
  /** Pointer over the row: open, unless it is crossing another row's
   *  safe triangle on its way to that row's submenu. */
  const hover = (e: React.PointerEvent) => {
    if (safeArea.owner && safeArea.owner !== id && safeArea.area
      && inside([e.clientX, e.clientY], safeArea.area)) return;
    if (!open || stopTracking.current) show();
  };
  const leaveRow = (e: React.PointerEvent) => {
    const panel = panelRef.current?.getBoundingClientRect();
    if (!open || !panel) { hide(); return; }
    const near = panel.left;
    safeArea.owner = id;
    safeArea.area = [[e.clientX - 4, e.clientY], [near, panel.top - 8], [near + 8, panel.top - 8],
      [near + 8, panel.bottom + 8], [near, panel.bottom + 8]];
    const move = (ev: PointerEvent) => {
      const p: Point = [ev.clientX, ev.clientY];
      const r = panelRef.current?.getBoundingClientRect();
      if (r && p[0] >= r.left && p[0] <= r.right && p[1] >= r.top && p[1] <= r.bottom) {
        release();
        return;
      }
      if (safeArea.area && inside(p, safeArea.area)) return;
      hide();
    };
    stopTracking.current?.();
    document.addEventListener("pointermove", move);
    stopTracking.current = () => document.removeEventListener("pointermove", move);
  };
  const leavePanel = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => { window.clearTimeout(closeTimer.current); release(); }, []);
  return (
    <Popover open={open} onOpenChange={(next) => (next ? show() : hide())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={itemCls(open)}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerEnter={hover}
          onPointerMove={hover}
          onPointerLeave={leaveRow}
          onClick={show}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); show(); }
          }}
        >
          <span className="flex-1 text-left">{label}</span>
          <span className="flex w-[16px] shrink-0 items-center justify-center text-text-muted"><ChevronRight size={14} /></span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        // The row sits 4px inside its panel, so 10 leaves a 4px gap
        // between the two frames; the submenu's top lines up with the
        // row, as in Claude's.
        sideOffset={10}
        alignOffset={0}
        collisionPadding={8}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Returning focus to this row on close would count as "focus
        // outside" for the sibling submenu the pointer just opened.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => { window.clearTimeout(closeTimer.current); release(); }}
        onPointerLeave={leavePanel}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); hide(); }
        }}
      >
        <div ref={panelRef} role="menu" className={`${MENU_PANEL} min-w-[180px]`}>{children}</div>
      </PopoverContent>
    </Popover>
  );
}

// MenuItem / SubItem share the canonical `itemCls` from menu-styles, so
// this context menu is pixel-identical to the topbar pickers. Danger
// (Delete) and the orange "new group" accent are the only per-item
// variants; the shortcut hint uses the shared SHORTCUT style.
function MenuItem({
  label,
  shortcut,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={itemCls(false, danger)}>
      <span className="flex-1 text-left">{label}</span>
      {shortcut ? (
        <span className={SHORTCUT + " w-[16px] text-center"}>{shortcut}</span>
      ) : null}
    </button>
  );
}

function SubItem({
  label,
  accent,
  onClick,
}: {
  label: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={itemCls(false) + (accent ? " !text-[var(--accent-orange)]" : "")}
    >
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  );
}
