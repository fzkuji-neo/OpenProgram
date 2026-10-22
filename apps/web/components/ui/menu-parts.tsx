"use client";

/**
 * The parts of one menu row, shared by every action menu: the ⋯ and
 * right-click menus in the app and the desktop overlay menus that cover
 * native web views. A row is
 *
 *   [Solar icon]  label                [key badge | check | ›]
 *
 * The icon is a Solar Bold Duotone glyph, the family of the folder icons.
 * The trailing column holds a key badge (MenuKey) for a key that works
 * while the menu is open or a system shortcut, the row's check when it is
 * checkable, and the chevron when it opens a submenu. The rows themselves
 * are each menu's radix item with itemCls (menu-styles.ts).
 */

import { ChevronRight } from "lucide-react";

import { SolarIcon } from "@/components/solar-icons";
import type { SolarIconName } from "@/components/solar-icons/bodies";
import { CHECK_SLOT_PAD, MENU_KEY } from "@/components/chat/top-bar/menu-styles";
import { MenuCheck } from "@/components/chat/top-bar/menu-check";
import { cn } from "@/lib/utils";

/** A key a row answers to. `mod` is ⌘ on macOS and Ctrl elsewhere; a key
 *  with no modifier is a menu-local letter (it works while the menu is
 *  open). */
export interface MenuKeys {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type MenuGlyph = SolarIconName;

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** The key as the system writes it: ⌥⇧⌘T on macOS, Ctrl+Alt+Shift+T
 *  elsewhere. */
export function formatMenuKeys(keys: MenuKeys, mac = isMacPlatform()): string {
  const key = keys.key.length === 1 ? keys.key.toUpperCase() : keys.key;
  if (mac) return `${keys.alt ? "⌥" : ""}${keys.shift ? "⇧" : ""}${keys.mod ? "⌘" : ""}${key}`;
  return [keys.mod && "Ctrl", keys.alt && "Alt", keys.shift && "Shift", key].filter(Boolean).join("+");
}

export function MenuKey({ keys }: { keys: MenuKeys }) {
  return <kbd className={MENU_KEY}>{formatMenuKeys(keys)}</kbd>;
}

export function MenuIcon({ glyph, className }: { glyph: MenuGlyph; className?: string }) {
  return <SolarIcon name={glyph} size={16} motionPreset="none" className={cn("menu-row-icon shrink-0 text-text-muted", className)} aria-hidden="true" />;
}

/** The inside of a row. `checked` undefined: not checkable; false keeps
 *  the check column so labels stay aligned. */
export function MenuRow({ glyph, icon, label, keys, checked, submenu, danger, iconClassName }: {
  glyph?: MenuGlyph;
  /** A non-Solar leading mark (a favicon, a coloured dot) in the icon slot. */
  icon?: React.ReactNode;
  label: React.ReactNode;
  keys?: MenuKeys;
  checked?: boolean;
  submenu?: boolean;
  /** A destructive row: its icon turns red with its label. */
  danger?: boolean;
  iconClassName?: string;
}) {
  return (
    <>
      {glyph ? <MenuIcon glyph={glyph} className={cn(danger && "text-[var(--accent-red)]", iconClassName)} /> : icon ? <span className="inline-flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {keys ? <MenuKey keys={keys} /> : null}
      {checked === undefined ? null : checked ? <MenuCheck /> : <span className={CHECK_SLOT_PAD} aria-hidden="true" />}
      {submenu ? <ChevronRight className="menu-row-chevron size-4 shrink-0 text-text-muted" aria-hidden="true" /> : null}
    </>
  );
}
