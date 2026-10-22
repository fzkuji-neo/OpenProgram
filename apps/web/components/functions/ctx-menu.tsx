"use client";

/**
 * The right-click menu of a program card: the shadcn (radix-nova)
 * ContextMenu, which opens at the pointer and brings keyboard navigation,
 * Esc and outside-click dismissal with it. The panel and rows are the
 * shared menu recipes (components/ui/context-menu.tsx).
 */
import type { ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MenuRow, type MenuGlyph } from "@/components/ui/menu-parts";

export interface CtxItem {
  type?: "sep";
  label?: string;
  glyph?: MenuGlyph;
  action?: () => void;
}

export function CtxMenu({ items, children }: { items: CtxItem[]; children: ReactNode }) {
  return (
    <ContextMenu>
      {/* display: contents — the card keeps its own place in the grid. */}
      <ContextMenuTrigger asChild>
        <div style={{ display: "contents" }}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-40" onClick={(e) => e.stopPropagation()}>
        {items.map((it, i) =>
          it.type === "sep" ? (
            <ContextMenuSeparator key={i} />
          ) : (
            <ContextMenuItem key={i} onSelect={() => it.action?.()}>
              <MenuRow glyph={it.glyph} label={it.label} />
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
