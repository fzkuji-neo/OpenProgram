"use client";

/**
 * "Move to…": pick any folder in the project without dragging through the
 * tree. Typing searches every folder in the project (the server's search,
 * folders only); with nothing typed the dialog offers the project root,
 * the folders moved to recently and the top-level folders. A typed path
 * that names no folder yet can be created and moved into in one step.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { SolarIcon, type SolarIconName } from "@/components/solar-icons";
import { useTranslation } from "@/lib/i18n";
import { wsRequest } from "@/lib/net/ws-request";
import { fileResponseMatchesOwner } from "@/lib/files/file-state-shared";
import { baseOf, parentOf } from "./file-tree-query";
import { canMoveInto, recentMoveTargets, typedFolder } from "./move-targets";

interface FolderRow { name: string; path?: string; type: string }
interface FolderPage { project_id?: string; entries?: FolderRow[]; results?: FolderRow[]; error_code?: string }

function query(action: string, payload: Record<string, unknown>): Promise<FolderPage | null> {
  return wsRequest<FolderPage>(action, payload, `${action}_result`,
    data => fileResponseMatchesOwner(data as unknown as Record<string, unknown>, payload), 4000);
}

export interface MoveToDialogProps {
  open: boolean;
  projectId: string;
  rootName: string;
  /** The entries being moved. */
  paths: string[];
  onOpenChange(open: boolean): void;
  onMove(targetDir: string): void;
  onCreateAndMove(targetDir: string): void;
}

export function MoveToDialog({ open, projectId, rootName, paths, onOpenChange, onMove, onCreateAndMove }: MoveToDialogProps) {
  const { text } = useTranslation();
  const [search, setSearch] = useState("");
  const [topLevel, setTopLevel] = useState<string[]>([]);
  const [found, setFound] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setFound(null);
    let live = true;
    void query("project_file_tree", { project_id: projectId, path: "", page_size: 500 }).then(page => {
      if (live) setTopLevel((page?.entries ?? []).filter(row => row.type === "dir").map(row => row.name));
    });
    return () => { live = false; };
  }, [open, projectId]);

  useEffect(() => {
    const term = search.trim();
    if (!open || !term) { setFound(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      void query("project_file_search", { project_id: projectId, path: "", query: term, mode: "fuzzy", type: "dir", page_size: 50 })
        .then(page => { if (live) setFound((page?.results ?? []).map(row => row.path ?? row.name)); });
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [open, projectId, search]);

  const blocked = (dir: string) => paths.some(path => dir === path || dir.startsWith(path + "/"));
  const usable = (dir: string) => canMoveInto(paths, dir);
  const first = paths.length ? parentOf(paths[0]) : null;
  const here = first !== null && paths.every(path => parentOf(path) === first) ? first : null;

  const recent = useMemo(() => open ? recentMoveTargets(projectId).filter(usable) : [], [open, projectId, paths]); // eslint-disable-line react-hooks/exhaustive-deps
  const typed = typedFolder(search);
  const exists = typed !== null && (found ?? []).includes(typed);

  const choose = (dir: string) => { onOpenChange(false); onMove(dir); };
  const row = (dir: string, icon: SolarIconName = "folder") => (
    <CommandItem key={dir || "."} value={`dir:${dir}`} disabled={!usable(dir)} onSelect={() => choose(dir)}>
      <SolarIcon name={icon} size={16} motionPreset="none" aria-hidden="true" />
      <span className="min-w-0 truncate">{dir ? baseOf(dir) : rootName}</span>
      {dir && parentOf(dir) ? <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{parentOf(dir)}</span> : null}
      {dir === here ? <span className="ml-auto text-xs text-muted-foreground">{text("Current", "当前位置")}</span> : null}
    </CommandItem>
  );

  const count = paths.length === 1 ? baseOf(paths[0]) : text(`${paths.length} items`, `${paths.length} 项`);
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}
      title={text(`Move ${count} to…`, `将 ${count} 移动到…`)}
      description={text("Search for a folder in this project", "搜索项目中的文件夹")}>
      <Command shouldFilter={false} loop>
        <CommandInput value={search} onValueChange={setSearch}
          placeholder={text(`Move ${count} to… (search or type a path)`, `将 ${count} 移动到…（搜索或输入路径）`)} />
        <CommandList>
          {found !== null && found.length === 0 && !typed ? <CommandEmpty>{text("No folders match", "没有匹配的文件夹")}</CommandEmpty> : null}
          {found === null ? <>
            <CommandGroup heading={text("Project", "项目")}>{row("")}</CommandGroup>
            {recent.length ? <CommandGroup heading={text("Recent", "最近")}>{recent.map(dir => row(dir, "history"))}</CommandGroup> : null}
            {topLevel.length ? <CommandGroup heading={text("Folders", "文件夹")}>{topLevel.map(dir => row(dir))}</CommandGroup> : null}
          </> : <CommandGroup heading={text("Folders", "文件夹")}>{found.map(dir => row(dir))}</CommandGroup>}
          {typed && found !== null && !exists && !blocked(typed) ? (
            <CommandGroup heading={text("New folder", "新建文件夹")}>
              <CommandItem value={`new:${typed}`} onSelect={() => { onOpenChange(false); onCreateAndMove(typed); }}>
                <SolarIcon name="add-folder" size={16} motionPreset="none" aria-hidden="true" />
                <span className="min-w-0 truncate">{text(`Create “${typed}” and move here`, `新建“${typed}”并移到这里`)}</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
