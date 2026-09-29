"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BrainIcon, SearchIcon, CheckIcon, ChevronDownIcon } from "@/components/animated-icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jsonFetch } from "@/lib/net/fetch-client";
import { AgentButton } from "./agent-controls";
import type { Agent, Text } from "./agent-types";
import styles from "./agents-page.module.css";

export type CatalogModel = {
  provider: string; id: string; name: string; enabled?: boolean;
  thinking_levels?: string[]; default_thinking_level?: string;
};
type Provider = { id: string; label?: string; enabled?: boolean; configured?: boolean };
export function useAgentModels() {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [inherited, setInherited] = useState<{ provider: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setLoading(true); setError("");
    void (async () => {
      const [catalog, settings] = await Promise.all([
        jsonFetch<{ providers: Provider[] }>("/api/providers/list", options),
        jsonFetch<{ chat?: { provider?: string; model?: string } }>("/api/agent_settings", options),
      ]);
      const providers = catalog.providers.filter((provider) => provider.enabled !== false && provider.configured !== false);
      const results = await Promise.all(providers.map(async (provider) => {
        const data = await jsonFetch<{ models: Omit<CatalogModel, "provider">[] }>(`/api/providers/${encodeURIComponent(provider.id)}/models`, options);
        return data.models.filter((model) => model.enabled !== false).map((model) => ({ ...model, provider: provider.id }));
      }));
      if (!active) return;
      setModels(results.flat());
      setInherited(settings.chat?.provider && settings.chat.model ? { provider: settings.chat.provider, id: settings.chat.model } : null);
    })().catch((cause) => {
      if (active && cause.name !== "AbortError") setError(String(cause.message || cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  return { models, inherited, loading, error, retry: () => setAttempt((value) => value + 1) };
}
export type ModelCatalog = ReturnType<typeof useAgentModels>;
export function selectedModel(agent: Agent, catalog: ModelCatalog) {
  const ref = !agent.model.id && !agent.model.provider ? catalog.inherited : agent.model;
  return catalog.models.find((model) => model.id === ref?.id && model.provider === ref?.provider);
}
export function ModelPicker({ draft, update, catalog, text }: {
  draft: Agent; update: (patch: Partial<Agent>) => void; catalog: ModelCatalog; text: Text;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState("");
  const current = selectedModel(draft, catalog);
  const inherited = !draft.model.id && !draft.model.provider;
  const effortSupported = !draft.thinking_effort || Boolean(current?.thinking_levels?.includes(draft.thinking_effort));
  const filtered = useMemo(() => catalog.models.filter((model) =>
    `${model.name} ${model.provider} ${model.id}`.toLowerCase().includes(search.trim().toLowerCase())), [catalog.models, search]);
  function select(model: Agent["model"]) { update({ model }); setOpen(false); setSearch(""); }
  return <>
    <label className={styles.fieldLabel} htmlFor="agent-model-picker">{text("Model", "模型")}</label>
    <AgentButton ref={trigger} id="agent-model-picker" className={styles.modelTrigger} variant="outline" icon={BrainIcon} onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span><strong>{inherited ? text("Inherit default model", "继承默认模型") : current?.name || draft.model.id || draft.model.provider}</strong>
        <small>{inherited ? catalog.inherited ? `${catalog.inherited.provider} / ${catalog.inherited.id}` : text("Default model is not configured", "尚未配置默认模型") : `${draft.model.provider}${!current && !catalog.loading ? text(" · Unavailable", " · 不可用") : ""}`}</small></span><ChevronDownIcon size={16} aria-hidden />
    </AgentButton>
    {catalog.error ? <p className={styles.inlineError} role="alert">{catalog.error} <button type="button" onClick={catalog.retry}>{text("Retry loading models", "重新加载模型")}</button></p> : null}
    {!catalog.loading && !catalog.error && !current ? <p className={styles.inlineError}>{text("This model is unavailable. Keep the reference or choose an enabled model before starting a conversation.", "此模型不可用。可保留引用，或在发起对话前选择已启用模型。")}</p> : null}
    <label className={styles.dialogField} htmlFor="agent-effort">{text("Thinking effort", "思考强度")}
      <select id="agent-effort" value={draft.thinking_effort} onChange={(event) => update({ thinking_effort: event.target.value })} aria-describedby={!effortSupported ? "agent-effort-warning" : undefined}>
        <option value="">{text("Inherit model default", "继承模型默认值")}{current?.default_thinking_level ? ` (${current.default_thinking_level})` : ""}</option>
        {!effortSupported && draft.thinking_effort ? <option value={draft.thinking_effort}>{draft.thinking_effort} — {text("not supported by this model", "当前模型不支持")}</option> : null}
        {(current?.thinking_levels || []).map((level) => <option key={level} value={level}>{level}</option>)}
      </select>
    </label>
    {!effortSupported && !catalog.loading ? <p id="agent-effort-warning" className={styles.inlineError} role="alert">{text("Choose a supported effort or inherit the model default. Your previous choice has been kept.", "请选择支持的思考强度或继承模型默认值；此前选择已保留。")}</p> : null}
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setSearch(""); }}>
      <DialogContent className={styles.modelDialog} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}><DialogHeader><DialogTitle>{text("Choose model", "选择模型")}</DialogTitle><DialogDescription>{text("This changes only this Agent's draft.", "仅修改此 Agent 的草稿。")}</DialogDescription></DialogHeader>
        <label className={styles.searchField}><SearchIcon size={16} aria-hidden /><input autoFocus aria-label={text("Search models", "搜索模型")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text("Search models…", "搜索模型…")} /></label>
        <div className={styles.modelList}>
          <AgentButton variant="ghost" icon={BrainIcon} className={styles.modelOption} onClick={() => select({ provider: "", id: "" })}><span><strong>{text("Inherit default model", "继承默认模型")}</strong><small>{catalog.inherited ? `${catalog.inherited.provider} / ${catalog.inherited.id}` : text("No default configured", "尚未配置默认模型")}</small></span>{inherited ? <CheckIcon size={16} aria-hidden /> : null}</AgentButton>
          {catalog.loading ? <p role="status">{text("Loading models…", "正在加载模型…")}</p> : catalog.error ? <p role="alert">{catalog.error}</p> : filtered.length === 0 ? <p>{text("No matching enabled models", "没有匹配的已启用模型")}</p> : filtered.map((model) => <AgentButton variant="ghost" icon={BrainIcon} key={`${model.provider}:${model.id}`} className={styles.modelOption} onClick={() => select({ provider: model.provider, id: model.id })}><span><strong>{model.name || model.id}</strong><small>{model.provider} / {model.id}</small></span>{draft.model.provider === model.provider && draft.model.id === model.id ? <CheckIcon size={16} aria-hidden /> : null}</AgentButton>)}
          {!inherited && !current ? <p>{text("Current unavailable reference", "当前不可用引用")}: {draft.model.provider} / {draft.model.id}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
