"use client";

/**
 * ConvMenu — the right-click / ⋯ context menu for a Recents row.
 *
 * Built on the shadcn (radix-nova) DropdownMenu: the parent (ConvItem in
 * sessions-list.tsx) owns the DropdownMenu root, its open state and the
 * anchor at the click point, so the ⋯ button and a right-click on the row
 * open the same menu; this file renders the DropdownMenuContent. The
 * "Move to group" / "Move to project" / "Export" rows are DropdownMenuSub
 * submenus, so hover-to-open, the pointer grace on the way to a submenu
 * and keyboard navigation are Radix's own.
 *
 * Items mirror Claude.ai's conversation menu, minus the ones we have
 * no backing infra for (Open in / Mark as read / Share). Each item
 * shows a right-aligned single-key shortcut; while the menu is open,
 * pressing that key fires the item (menu-local, see onKeyDown — it runs
 * before Radix's typeahead, which it replaces in the top-level menu).
 */

import { ChevronRight } from "lucide-react";

import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GROUP_LABEL,
  MENU_ITEM_STATES,
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

/** The DropdownMenuContent both menus share: opened at the click point,
 *  and kept from leaking clicks / right-clicks to the row behind it (the
 *  portal still bubbles through the React tree). */
function MenuContent({ onKeyDown, children }: {
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuContent
      align="start"
      side="bottom"
      sideOffset={4}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={onKeyDown}
      className={cn(MENU_PANEL, "min-w-[200px] text-[var(--text-primary)]")}
    >
      {children}
    </DropdownMenuContent>
  );
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

  function run(fn: () => void) {
    fn();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Single-key shortcuts mirror Claude's menu. Ignore when a
    // modifier is held so they don't hijack browser shortcuts, and
    // inside a submenu (its keys bubble here through the React tree).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    const action = ({ r: onRename, p: onTogglePin, c: onCopyLink, a: onToggleArchive, d: onDelete } as
      Record<string, () => void>)[e.key.toLowerCase()];
    if (action) { e.preventDefault(); run(action); }
  }

  return (
    <MenuContent onKeyDown={onKeyDown}>
      <MenuItem label={t("sidebar.rename")} shortcut="R" onSelect={onRename} />
      <MenuItem label={t("sidebar.auto_rename")} onSelect={onAutoRename} />
      <MenuItem
        label={conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
        shortcut="P"
        onSelect={onTogglePin}
      />

      <Submenu label={t("sidebar.move_to_group")}>
        {conv.group ? (
          <MenuItem label={t("sidebar.remove_from_group")} onSelect={() => onMoveToGroup("")} />
        ) : null}
        {groups
          .filter((g) => g && g !== conv.group)
          .map((g) => (
            <MenuItem key={g} label={g} onSelect={() => onMoveToGroup(g)} />
          ))}
        <MenuItem label={t("sidebar.new_group")} accent onSelect={onNewGroup} />
      </Submenu>

      {/* Dragging the row onto a project header does the same thing. */}
      {projects && onMoveToProject && projects.length > 0 && (
        <Submenu label={t("sidebar.move_to_project")}>
          {projects.map((project) => (
            <MenuItem key={project.id} label={project.name} onSelect={() => onMoveToProject(project.id)} />
          ))}
        </Submenu>
      )}

      <MenuItem label={t("sidebar.copy_link")} shortcut="C" onSelect={onCopyLink} />

      <Submenu label={t("sidebar.export")}>
        <MenuItem label={t("sidebar.export_markdown")} onSelect={() => onExport("md")} />
        <MenuItem label={t("sidebar.export_html")} onSelect={() => onExport("html")} />
      </Submenu>

      <MenuItem
        label={conv.archived ? t("sidebar.unarchive") : t("sidebar.archive")}
        shortcut="A"
        onSelect={onToggleArchive}
      />

      <DropdownMenuSeparator className={MENU_SEPARATOR} />

      <MenuItem label={t("sidebar.delete")} shortcut="D" danger onSelect={onDelete} />
    </MenuContent>
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
  return (
    <MenuContent>
      <div className={GROUP_LABEL}>{text(`${count} chats selected`, `已选 ${count} 个聊天`)}</div>
      {projects && onMoveToProject && projects.length > 0 && (
        <Submenu label={t("sidebar.move_to_project")}>
          {projects.map((project) => (
            <MenuItem key={project.id} label={project.name} onSelect={() => onMoveToProject(project.id)} />
          ))}
        </Submenu>
      )}
      <Submenu label={t("sidebar.move_to_group")}>
        <MenuItem label={t("sidebar.remove_from_group")} onSelect={() => onMoveToGroup("")} />
        {groups.filter(Boolean).map((g) => (
          <MenuItem key={g} label={g} onSelect={() => onMoveToGroup(g)} />
        ))}
      </Submenu>
      <MenuItem label={t("sidebar.archive")} onSelect={onArchive} />
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <MenuItem label={text("Clear selection", "取消选择")} onSelect={onClear} />
    </MenuContent>
  );
}

/* ---- item primitives ------------------------------------------- */

/** A row that opens its submenu to the right (hover, click or
 *  ArrowRight) — Nova's DropdownMenuSub with its trailing chevron. */
function Submenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={cn(itemCls(false), MENU_ITEM_STATES)}>
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronRight className="ml-auto size-4 shrink-0 text-text-muted" aria-hidden="true" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn(MENU_PANEL, "text-[var(--text-primary)]")}>
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

// Rows share the canonical `itemCls` from menu-styles, so this context
// menu is pixel-identical to the topbar pickers. Danger (Delete) and the
// orange "new group" accent are the only per-item variants; the shortcut
// hint uses the shared SHORTCUT style. Selecting a row closes the menu
// (Radix), which reaches the parent through onOpenChange.
function MenuItem({
  label,
  shortcut,
  danger,
  accent,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  danger?: boolean;
  accent?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(
        itemCls(false, danger),
        MENU_ITEM_STATES,
        danger && "data-[highlighted]:bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)] data-[highlighted]:text-[var(--accent-red)]",
        accent && "!text-[var(--accent-orange)]",
      )}
    >
      <span className="flex-1 truncate text-left">{label}</span>
      {shortcut ? (
        <span className={SHORTCUT + " w-[16px] text-center"}>{shortcut}</span>
      ) : null}
    </DropdownMenuItem>
  );
}
