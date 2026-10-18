"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X, Save, Loader2, FileCode } from "lucide-react";
import type { AgenticFunction } from "@/lib/types";
import { api } from "@/lib/net/api";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface Props {
  fn: AgenticFunction;
  onClose: () => void;
}

export function SourceModal({ fn, onClose }: Props) {
  const { text } = useTranslation();
  const qc = useQueryClient();
  const [edited, setEdited] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["source", fn.name],
    queryFn: () => api.getFunctionSource(fn.name),
  });

  const display = edited ?? data?.source ?? "";
  const dirty = edited !== null && edited !== (data?.source ?? "");

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const r = await fetch(
        `/api/function/${encodeURIComponent(fn.name)}/edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: edited }),
        }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      qc.invalidateQueries({ queryKey: ["source", fn.name] });
      qc.invalidateQueries({ queryKey: ["functions"] });
      setEdited(null);
    } catch (e) {
      alert(text("Save failed: ", "保存失败：") + String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileCode className="size-4 shrink-0 text-muted-foreground" />
            <DialogTitle className="font-mono text-sm">{fn.name}</DialogTitle>
            {data?.filepath && (
              <DialogDescription className="truncate font-mono text-xs">
                {data.filepath.replace(/^.*\/openprogram\//, "openprogram/")}
              </DialogDescription>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {text("Save", "保存")}
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label={text("Close", "关闭")}>
                <X />
              </Button>
            </DialogClose>
          </div>
        </div>

        <textarea
          value={display}
          onChange={(e) => setEdited(e.target.value)}
          spellCheck={false}
          aria-label={text("Source of ", "源码：") + fn.name}
          className="flex-1 resize-none bg-[var(--bg-input)] p-4 font-mono text-xs leading-[1.55] text-[var(--text-primary)] outline-none"
        />
      </DialogContent>
    </Dialog>
  );
}
