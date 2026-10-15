"use client";

/**
 * Floating menu for ``@file`` mentions in the composer.
 *
 * Owns nothing of its own — the parent composer drives ``items``,
 * ``selectedIndex``, ``onPick``. Layout mirrors the slash menu (same
 * portal pattern, same row visuals via inline styles so it inherits
 * the page's CSS variables).
 */

import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/lib/i18n";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import { SolarIcon } from "@/components/solar-icons";

export interface FileMatch {
  path: string;
  is_dir: boolean;
}

interface FileMenuProps {
  items: FileMatch[];
  selectedIndex: number;
  position: { left: number; top: number; bottom?: number } | null;
  onHover: (idx: number) => void;
  onPick: (item: FileMatch) => void;
  loading: boolean;
  query: string;
}

export function FileMenu({
  items, selectedIndex, position, onHover, onPick, loading, query,
}: FileMenuProps) {
  const { text } = useTranslation();
  if (!position || typeof document === "undefined") return null;
  const content = (
    <div
      role="listbox"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: position.left,
        // `bottom` anchors the menu above the field so it grows upward.
        ...(position.bottom !== undefined ? { bottom: position.bottom } : { top: position.top }),
        zIndex: 9999,
        minWidth: 260,
        maxWidth: 480,
        maxHeight: 320,
        overflowY: "auto",
        // Shared menu frame (top-bar/menu-styles.ts MENU_PANEL): 4px padding.
        padding: 4,
        // Glass popover recipe (app/styles/base.css --glass-*).
        background: "var(--glass-surface)",
        WebkitBackdropFilter: "var(--glass-backdrop)",
        backdropFilter: "var(--glass-backdrop)",
        border: "0.5px solid var(--glass-ring)",
        borderRadius: "var(--glass-radius)",
        boxShadow: "var(--glass-shadow)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        lineHeight: "19px",
      }}
    >
      {loading && items.length === 0 ? (
        <div style={{ padding: "2.5px 8px", color: "var(--text-muted)" }}>
          {text("Searching...", "搜索中...")}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: "2.5px 8px", color: "var(--text-muted)" }}>
          {query
            ? text(`No files match "${query}"`, `没有匹配“${query}”的文件`)
            : text("Type to search files", "输入以搜索文件")}
        </div>
      ) : (
        items.map((item, i) => {
          const selected = i === selectedIndex;
          return (
            <div
              key={item.path}
              role="option"
              aria-selected={selected}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(item)}
              // Shared menu row (itemCls): 24px, 2.5px 8px, 6px radius,
              // the keyboard pick tinted like hover.
              style={{
                minHeight: 24,
                padding: "2.5px 8px",
                borderRadius: 6,
                cursor: "pointer",
                background: selected ? "var(--bg-hover)" : "transparent",
                color: selected ? "var(--text-bright)" : "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 16,
                  justifyContent: "center",
                  display: "inline-flex",
                  flexShrink: 0,
                  color: "var(--text-muted)",
                }}
              >
                {item.is_dir ? <SolarIcon name="folder-with-files" size={16} /> : <FileTypeIcon name={item.path} />}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.path}{item.is_dir ? "/" : ""}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
  return createPortal(content, document.body);
}
