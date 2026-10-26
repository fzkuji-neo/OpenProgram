import type { FileTreeIcons } from "@pierre/trees";
import { SOLAR_BODIES } from "@/components/solar-icons/bodies";

export const pierreTreeIcons: FileTreeIcons = {
  set: "complete", colored: true,
  byFileName: Object.fromEntries(Object.getOwnPropertyNames(Object.prototype).map(name => [name.toLowerCase(), "file-tree-builtin-default"])),
  byFileExtension: Object.fromEntries(Object.getOwnPropertyNames(Object.prototype).map(name => [name.toLowerCase(), "file-tree-builtin-default"])),
  remap: { "file-tree-icon-chevron": "openprogram-folder" },
  // The main sidebar's Solar folder (duotone, --folder-color); the row's
  // expanded state swaps in Solar folder-open.
  spriteSheet: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true"><symbol id="openprogram-folder" viewBox="0 0 24 24"><g style="display:var(--op-folder-closed,inline)">${SOLAR_BODIES.folder}</g><g style="display:var(--op-folder-open,none)">${SOLAR_BODIES["folder-open"]}</g></symbol></svg>`,
};
export const fileColumnWidths = { size: 100, modified: 200, kind: 140, padding: 8 };
export const fileColumnGrid = "var(--op-files-name-width, 220px) 100px 200px 140px";
// Below 720px only Name and Size fit, so the row ends after Size (Codex's
// tree likewise keeps every row inside the panel; nothing scrolls sideways).
export const fileColumnsWidth = "calc(var(--op-files-name-width, 220px) + var(--op-files-meta-width, 448px))";

export const pierreTreeCSS = `
:host { --trees-font-family-override: var(--right-panel-font-family, var(--font-sans)); --trees-font-size-override: var(--right-panel-text-size, 13px); --trees-bg-override: var(--files-tree-bg, var(--bg-secondary)); --trees-padding-inline-override: 8px; --trees-fg-override: var(--text-secondary); font-family: inherit; }
[data-item-type="folder"] > [data-item-section="icon"] > svg { transform: none !important; color: var(--folder-color); }
[data-item-type="folder"][aria-expanded="true"], [data-item-type="folder"][data-file-tree-sticky-row="true"] { --op-folder-closed: none; --op-folder-open: inline; }
[data-item-selected="true"]::before { outline: none !important; }
[data-file-tree-virtualized-scroll="true"] { padding-inline: 0; overflow-x: hidden; }
/* The app's overlay thumb (attachOverlayScrollbar) replaces the vertical bar, so rows reach the right edge. */
[data-file-tree-virtualized-scroll="true"] { scrollbar-gutter: auto; }
[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar:vertical { width: 0; }
[data-type="item"] { width: ${fileColumnsWidth}; box-sizing: border-box; margin-inline: 0; padding-inline: 8px; }
[data-file-tree-virtualized-list="true"], [data-file-tree-sticky-overlay="true"] { width: ${fileColumnsWidth}; }
[data-item-section="spacing"] { max-width: max(0px, calc(var(--op-files-name-width, 220px) - 96px)); flex-shrink: 0; overflow: hidden; }
[data-item-section="content"] { flex: 1 1 0; }
[data-item-section="decoration"] { width: calc(var(--op-files-meta-width, 448px) - 8px); overflow: hidden; }
[data-item-section="decoration"] > span { display: grid; grid-template-columns: 100px 200px 140px; width: 440px; max-width: none; }
[data-item-section="decoration"] > span > span { min-width: 0; box-sizing: border-box; padding: 0 10px 0 12px; overflow: hidden; text-overflow: ellipsis; text-align: left; }
[data-item-section="decoration"] > span > span:first-child { text-align: right; }
[data-item-section="decoration"] { flex: none; font-size: var(--right-panel-meta-size, 11px); line-height: var(--right-panel-line-height, normal); color: var(--text-tertiary); white-space: nowrap; }
[data-item-section="decoration"] span[style*="--op-size-scanning"] { animation: folder-size-pulse 1.8s ease-in-out infinite; }
@keyframes folder-size-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { [data-item-section="decoration"] span[style*="--op-size-scanning"] { animation: none; } }
`;
