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
 * Laid out like the project menu (project-menu.tsx): a muted icon on
 * every row and the rows grouped by purpose — this chat's name and pin,
 * where it lives, sharing it, archiving or deleting it. Items mirror
 * Claude.ai's conversation menu, minus the ones we have no backing infra
 * for (Open in / Mark as read / Share). While the menu is open, R / P /
 * C / A / D still fire Rename / Pin / Copy link / Archive / Delete
 * (menu-local, see onKeyDown — it runs before Radix's typeahead, which
 * it replaces in the top-level menu); the rows no longer print them.
 */

import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Download,
  FolderInput,
  FolderTree,
  Link,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

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
      <MenuItem icon={Pencil} label={t("sidebar.rename")} onSelect={onRename} />
      <MenuItem icon={Sparkles} label={t("sidebar.auto_rename")} onSelect={onAutoRename} />
      <MenuItem
        icon={conv.pinned ? PinOff : Pin}
        label={conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
        onSelect={onTogglePin}
      />

      <DropdownMenuSeparator className={MENU_SEPARATOR} />

      <Submenu icon={FolderTree} label={t("sidebar.move_to_group")}>
        {conv.group ? (
          <MenuItem label={t("sidebar.remove_from_group")} onSelect={() => onMoveToGroup("")} />
        ) : null}
        {groups
          .filter((g) => g && g !== conv.group)
          .map((g) => (
            <MenuItem key={g} label={g} onSelect={() => onMoveToGroup(g)} />
          ))}
        <DropdownMenuSeparator className={MENU_SEPARATOR} />
        <MenuItem label={t("sidebar.new_group")} onSelect={onNewGroup} />
      </Submenu>

      {/* Dragging the row onto a project header does the same thing. */}
      {projects && onMoveToProject && projects.length > 0 && (
        <Submenu icon={FolderInput} label={t("sidebar.move_to_project")}>
          {projects.map((project) => (
            <MenuItem key={project.id} label={project.name} onSelect={() => onMoveToProject(project.id)} />
          ))}
        </Submenu>
      )}

      <DropdownMenuSeparator className={MENU_SEPARATOR} />

      <MenuItem icon={Link} label={t("sidebar.copy_link")} onSelect={onCopyLink} />
      <Submenu icon={Download} label={t("sidebar.export")}>
        <MenuItem label={t("sidebar.export_markdown")} onSelect={() => onExport("md")} />
        <MenuItem label={t("sidebar.export_html")} onSelect={() => onExport("html")} />
      </Submenu>

      <DropdownMenuSeparator className={MENU_SEPARATOR} />

      <MenuItem
        icon={conv.archived ? ArchiveRestore : Archive}
        label={conv.archived ? t("sidebar.unarchive") : t("sidebar.archive")}
        onSelect={onToggleArchive}
      />
      <MenuItem icon={Trash2} label={t("sidebar.delete")} danger onSelect={onDelete} />
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
        <Submenu icon={FolderInput} label={t("sidebar.move_to_project")}>
          {projects.map((project) => (
            <MenuItem key={project.id} label={project.name} onSelect={() => onMoveToProject(project.id)} />
          ))}
        </Submenu>
      )}
      <Submenu icon={FolderTree} label={t("sidebar.move_to_group")}>
        <MenuItem label={t("sidebar.remove_from_group")} onSelect={() => onMoveToGroup("")} />
        {groups.filter(Boolean).map((g) => (
          <MenuItem key={g} label={g} onSelect={() => onMoveToGroup(g)} />
        ))}
      </Submenu>
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <MenuItem icon={Archive} label={t("sidebar.archive")} onSelect={onArchive} />
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <MenuItem icon={X} label={text("Clear selection", "取消选择")} onSelect={onClear} />
    </MenuContent>
  );
}

/* ---- item primitives ------------------------------------------- */

/** The leading icon of a row, muted like the project menu's. */
function RowIcon({ icon: Icon }: { icon?: LucideIcon }) {
  return Icon ? <Icon size={14} className="shrink-0 text-text-muted" aria-hidden="true" /> : null;
}

/** A row that opens its submenu to the right (hover, click or
 *  ArrowRight) — Nova's DropdownMenuSub with its trailing chevron. */
function Submenu({ icon, label, children }: { icon?: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={cn(itemCls(false), MENU_ITEM_STATES)}>
        <RowIcon icon={icon} />
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
// menu is pixel-identical to the topbar pickers. Delete is the one danger
// row (red text and icon). Selecting a row closes the menu (Radix), which
// reaches the parent through onOpenChange.
function MenuItem({
  icon,
  label,
  danger,
  onSelect,
}: {
  icon?: LucideIcon;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(
        itemCls(false, danger),
        MENU_ITEM_STATES,
        danger && "data-[highlighted]:bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)] data-[highlighted]:text-[var(--accent-red)] [&_svg]:!text-[var(--accent-red)]",
      )}
    >
      <RowIcon icon={icon} />
      <span className="flex-1 truncate text-left">{label}</span>
    </DropdownMenuItem>
  );
}
