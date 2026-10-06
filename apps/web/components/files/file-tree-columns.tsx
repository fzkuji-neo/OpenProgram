"use client";

import { forwardRef } from "react";
import { useTranslation } from "@/lib/i18n";

import { fileColumnGrid, fileColumnsWidth } from "./pierre-tree-theme";

export function fileKind(path: string, type: "file" | "dir", text: (...variants: string[]) => string) {
  if (type === "dir") return text("Folder", "文件夹");
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
  return extension ? text(`${extension} file`, `${extension} 文件`) : text("File", "文件");
}

export const FileColumnsHeader = forwardRef<HTMLDivElement, { sort?: string; onSortChange?(value: string): void }>(function FileColumnsHeader({ sort, onSortChange }, ref) {
  const { text } = useTranslation();
  const fields = sort?.split(":");
  const change = (key: string) => {
    if (!fields || !onSortChange) return;
    const direction = fields[0] === key ? (fields[1] === "asc" ? "desc" : "asc") : (key === "size" || key === "mtime" ? "desc" : "asc");
    onSortChange([key, direction, ...fields.slice(2)].join(":"));
  };
  return <div ref={ref} role="table" aria-label={text("File columns", "文件列")} data-file-columns-header style={{ flex: "none", overflow: "hidden", fontSize: "var(--right-panel-meta-size, 11px)", color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
    <div role="row" aria-label={text("File columns", "文件列")} style={{ width: fileColumnsWidth, display: "grid", gridTemplateColumns: fileColumnGrid, paddingRight: 8, boxSizing: "border-box", height: 30 }}>
      {[["name", text("Name", "名称")], ["size", text("Size", "大小")], ["mtime", text("Date Modified", "修改时间")], ["kind", text("Kind", "类型")]].map(([key, label]) => {
        const active = !!onSortChange && fields?.[0] === key;
        const content = <><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>{active ? <span aria-hidden="true" style={{ fontSize: 10 }}>{fields?.[1] === "asc" ? "⌃" : "⌄"}</span> : null}</>;
        const style = { display: "flex", alignItems: "center", justifyContent: key === "size" ? "flex-end" : "space-between", gap: 4, height: "100%", width: "100%", padding: `0 10px 0 ${key === "name" ? 32 : 12}px`, boxSizing: "border-box" as const, textAlign: "left" as const };
        return <div key={key} role="columnheader" aria-label={label} aria-sort={active ? fields?.[1] === "asc" ? "ascending" : "descending" : undefined} style={{ minWidth: 0, borderRight: key === "kind" ? undefined : "1px solid var(--border)" }}>
          {sort && onSortChange ? <button type="button" className="hover:bg-bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" onClick={() => change(key)} style={{ ...style, cursor: "pointer", color: active ? "var(--text-primary)" : "inherit", background: "transparent", border: 0, font: "inherit" }}>{content}</button> : <span style={style}>{content}</span>}
        </div>;
      })}
    </div>
  </div>;
});
