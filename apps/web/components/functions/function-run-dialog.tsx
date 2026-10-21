"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Eye, Loader2, Folder } from "lucide-react";
import type { AgenticFunction, FunctionParamDetail } from "@/lib/types";
import { api } from "@/lib/net/api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { useFolderPicker } from "@/components/ui/folder-picker";
import { pushPath } from "@/lib/shallow-nav";
import { runtimeState } from "@/lib/runtime-bridge/state";

interface Props {
  fn: AgenticFunction;
  onClose: () => void;
  onRun?: (name: string) => void;
}

export function FunctionRunDialog({ fn, onClose }: Props) {
  const { t, text } = useTranslation();
  const router = useRouter();
  const visible = fn.params_detail.filter((p) => !p.hidden);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of visible) {
      init[p.name] =
        p.default && p.default !== "None" ? String(p.default) : "";
    }
    return init;
  });
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { pickFolder, folderPickerDialog } = useFolderPicker();

  async function runInChat() {
    // Build typed kwargs and POST the new function-call endpoint.
    const kwargs: Record<string, unknown> = {};
    for (const p of visible) {
      const v = values[p.name];
      if (v === "" || v === undefined) {
        if (!p.required) continue;
      }
      if (p.type === "bool") kwargs[p.name] = v === "true";
      else if (p.type === "int") kwargs[p.name] = Number(v);
      else if (p.type === "float") kwargs[p.name] = Number(v);
      else kwargs[p.name] = v;
    }
    const curSession = runtimeState.currentSessionId;
    const body: Record<string, unknown> = { kwargs };
    if (curSession) body.session_id = curSession;
    try {
      await fetch(`/api/function/${encodeURIComponent(fn.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("function call failed:", e);
    }
    pushPath(curSession ? `/s/${curSession}` : "/chat");
    onClose();
  }

  async function runInline() {
    setRunning(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const p of visible) {
        const v = values[p.name];
        if (v === "" && !p.required) continue;
        if (p.type === "bool") payload[p.name] = v === "true";
        else if (p.type === "int") payload[p.name] = Number(v);
        else if (p.type === "float") payload[p.name] = Number(v);
        else payload[p.name] = v;
      }
      // Run into the conversation the user last had open (the chat
      // PageShell stays mounted across routes and keeps this field
      // current). Falls back to a fresh session when there's none.
      const curSession = runtimeState.currentSessionId;
      if (curSession) payload._session_id = curSession;
      const r = await api.runFunction(fn.name, payload);
      setResult(JSON.stringify(r.result ?? r.error ?? r, null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle>{fn.name}</DialogTitle>
          <DialogDescription className="text-xs">{fn.description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {fn.continuation?.supported
              ? text("Declares durable steps. State and dependencies are checked before execution.", "已声明可恢复步骤，执行前会检查状态和依赖是否兼容。")
              : text("No durable steps declared. Interrupted calls require a new run.", "未声明可恢复步骤，中断后需要重新运行。")}
            {fn.continuation?.reason && <span> {fn.continuation.reason}</span>}
          </p>
          {visible.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {text("No parameters. Click Run to execute.", "没有参数。点击运行即可执行。")}
            </p>
          ) : (
            visible.map((p) => (
              <ParamInput
                key={p.name}
                p={p}
                value={values[p.name] ?? ""}
                onChange={(v) => setValues({ ...values, [p.name]: v })}
                pickFolder={pickFolder}
              />
            ))
          )}
          {result !== null && (
            <div className="mt-4">
              <h3
                className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-secondary)" }}
              >
                {text("Result", "结果")}
              </h3>
              <pre
                className="max-h-64 overflow-auto rounded-md border p-3 font-mono text-[11px]"
                style={{
                  background: "var(--bg-input)",
                  borderColor: "var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                {result}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="m-0">
          <Button variant="outline" onClick={onClose}>
            {t("sidebar.cancel")}
          </Button>
          <Button variant="outline" onClick={runInline} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <Eye />}
            {text("Run inline", "直接运行")}
          </Button>
          <Button onClick={runInChat}>
            <Play />
            {text("Run in chat", "在对话中运行")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {folderPickerDialog}
    </>
  );
}

function ParamInput({
  p,
  value,
  onChange,
  pickFolder,
}: {
  p: FunctionParamDetail;
  value: string;
  onChange: (v: string) => void;
  pickFolder(start?: string): Promise<string | null>;
}) {
  const { text } = useTranslation();
  const [pickerError, setPickerError] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label
          className="text-[12px] font-medium"
          style={{ color: "var(--text-bright)" }}
        >
          {p.name}
        </label>
        <span
          className="text-[10px]"
          style={{ color: "var(--text-muted)" }}
        >
          {p.type}
        </span>
        {p.required && (
          <span
            className="text-[10px]"
            style={{ color: "var(--accent-red)" }}
          >
            {text("required", "必填")}
          </span>
        )}
      </div>
      {p.description && (
        <p className="mb-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {p.description}
        </p>
      )}
      {p.type === "bool" ? (
        <SimpleSelect label={p.name}
          className="w-full"
          value={value || "false"}
          onValueChange={onChange}
          options={[
            { value: "false", label: "false" },
            { value: "true", label: "true" },
          ]}
        />
      ) : p.choices && p.choices.length > 0 ? (
        <SimpleSelect label={p.name}
          className="w-full"
          value={value}
          onValueChange={onChange}
          options={p.choices.map((c) => ({ value: c, label: c }))}
        />
      ) : p.multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={p.placeholder}
          rows={3}
          className="w-full resize-y rounded-md border p-2 text-[13px]"
          style={{
            background: "var(--bg-input)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        />
      ) : /(Path|folder|dir|directory|workdir)/i.test(p.type) ||
        /(workdir|folder|directory|dir_path|work_dir)/i.test(p.name) ? (
        <div>
          <div className="flex gap-2">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={p.placeholder ?? "/path/to/folder"}
              className="h-8 flex-1 font-mono text-[12px]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={async () => {
                setPickerError(null);
                try {
                  const path = await pickFolder(value);
                  if (path) onChange(path);
                } catch (error) {
                  const detail = error instanceof Error ? error.message : String(error);
                  setPickerError(
                    text(`Folder picker unavailable: ${detail}`, `文件夹选择器不可用：${detail}`),
                  );
                }
              }}
            >
              <Folder />
              {text("Browse", "浏览")}
            </Button>
          </div>
          {pickerError ? (
            <p className="mt-1 text-[11px] text-destructive" role="alert">
              {pickerError}
            </p>
          ) : null}
        </div>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={p.placeholder}
          className="h-8 w-full text-[13px]"
        />
      )}
    </div>
  );
}
