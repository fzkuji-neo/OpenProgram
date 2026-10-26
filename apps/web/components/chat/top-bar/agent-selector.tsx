"use client";

/**
 * Agent selector — the content of the chat / exec `<AgentBadge />`
 * popover.
 *
 * Lists every model the user enabled in Settings, grouped by provider.
 * With more than one provider the panel lists providers and each opens
 * its models in a submenu (hover, click or →); the provider of the
 * current model shows that model's name where the others show a count.
 * Chat picks always pin the current conversation (`/api/model`), using
 * the draft `local_*` id when the backend has not acked yet.
 *
 * Positioning / click-outside / portal are handled by the shadcn
 * <Popover> in `index.tsx`.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { useBoundChat } from "./bound-chat";
import { api } from "@/lib/net/api";
import { updatePendingAgentModel } from "@/lib/agents/start-conversation";
import { useTranslation } from "@/lib/i18n";
import {
  CHECK_SLOT_PAD,
  GROUP_LABEL,
  MENU_ITEM_STATES,
  MENU_PANEL,
  itemCls,
} from "./menu-styles";
import { MenuCheck } from "./menu-check";
import { SolarIcon } from "@/components/solar-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type EnabledModel = Awaited<ReturnType<typeof api.listEnabledModels>>[number];

export function AgentSelector({
  kind,
  currentProvider,
  currentModel,
  onClose,
}: {
  kind: "chat" | "exec";
  currentProvider?: string;
  currentModel?: string;
  onClose: () => void;
}) {
  const { sessionId: currentSessionId, chatKey } = useBoundChat();
  const { t, text } = useTranslation();
  const { data: models } = useQuery({
    queryKey: ["models-enabled"],
    queryFn: api.listEnabledModels,
  });
  // Group headings name the provider as Settings does, not by its id.
  const { data: providers } = useQuery({
    queryKey: ["provider-labels"],
    queryFn: api.listProviders,
    staleTime: 5 * 60_000,
  });
  const providerName = (id: string) => providers?.find((p) => p.id === id)?.label || id;

  async function pick(provider: string, model: string) {
    onClose();
    try {
      if (kind === "exec") {
        await api.setAgentSettings({ exec: { provider, model } });
      } else {
        let sid: string | undefined =
          currentSessionId ||
          (chatKey && chatKey !== "__new__" ? chatKey : undefined);
        if (!sid) {
          const { useCenterTabs } = await import("@/lib/tabs/center-tabs-store");
          const { newSession } = await import("@/lib/runtime-bridge/conversations");
          const tabs = useCenterTabs.getState();
          const existing = tabs.tabs.find(
            (tab: { kind: string; draft?: boolean; sessionId?: string }) =>
              tab.kind === "session" && tab.draft && tab.sessionId,
          );
          sid = existing?.sessionId ?? tabs.openDraftSessionTab();
          if (!sid) return;
          newSession(sid);
        }
        if (await updatePendingAgentModel(sid, { provider, id: model })) return;
        await api.switchModel(provider, model, sid);
      }
      const { useSessionStore } = await import("@/lib/session-store");
      useSessionStore.getState().setAgentSettings({
        [kind]: { provider, model },
      });
    } catch (e) {
      alert(t("agent.switch_failed") + String(e));
    }
  }

  // Group enabled models by provider, preserving first-seen order.
  const byProvider: { provider: string; models: typeof models }[] = [];
  for (const m of models ?? []) {
    let group = byProvider.find((g) => g.provider === m.provider);
    if (!group) {
      group = { provider: m.provider, models: [] };
      byProvider.push(group);
    }
    group.models!.push(m);
  }

  const isActive = (m: EnabledModel) =>
    currentProvider === m.provider &&
    (currentModel === m.id || currentModel === `${m.provider}:${m.id}`);
  const modelRows = (list: EnabledModel[]) =>
    list.map((m) => (
      <ModelRow key={m.id} model={m} active={isActive(m)} onPick={() => pick(m.provider, m.id)} />
    ));

  return (
    <div className={MENU_PANEL}>
      {/* Grammar-A header naming the dimension. */}
      <div className={GROUP_LABEL}>{text("Models", "模型")}</div>
      {(models ?? []).length === 0 ? (
        <div className="px-[8px] py-[8px] text-[12px] text-text-muted">
          {t("agent.no_enabled_models")}{" "}
          <a
            href="/settings/providers"
            onClick={onClose}
            className="text-[var(--accent-blue)] no-underline"
          >
            {t("agent.enable_models")} →
          </a>
        </div>
      ) : byProvider.length === 1 ? (
        // One provider has nothing to choose between: its models directly.
        <div key={byProvider[0].provider}>
          <div className={GROUP_LABEL}>{providerName(byProvider[0].provider)}</div>
          {modelRows(byProvider[0].models!)}
        </div>
      ) : (
        <ProviderMenu
          groups={byProvider.map((group) => ({
            id: group.provider,
            label: providerName(group.provider),
            current: group.models!.find(isActive)?.name,
            count: group.models!.length,
            rows: modelRows(group.models!),
          }))}
        />
      )}
    </div>
  );
}

function ModelRow({ model: m, active, onPick }: { model: EnabledModel; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      // 选中不铺底色（hover 是唯一底色），选中态只靠右侧勾。
      className={`${itemCls(false)} w-full text-left`}
    >
      {/* Claude 实测：元数据（badge/能力/上下文窗）紧贴名字
          左侧成簇，不推到右缘——右缘只留勾位。 */}
      <span className="flex min-w-0 flex-1 items-center gap-[6px]">
        <span className="truncate">{m.name}</span>
        <CapIcons caps={m.capabilities} />
        {m.context ? (
          <span className="shrink-0 text-[11px] text-text-muted">
            {fmtCtx(m.context)}
          </span>
        ) : null}
      </span>
      {active ? <MenuCheck /> : <span className={CHECK_SLOT_PAD} />}
    </button>
  );
}

interface ProviderGroup {
  id: string;
  label: string;
  /** Name of the current model when it belongs to this provider. */
  current?: string;
  count: number;
  rows: React.ReactNode;
}

/** Provider rows, each opening its models to the side. One submenu is
 *  open at a time; leaving a row closes it after a short grace so the
 *  pointer can travel into the submenu. */
function ProviderMenu({ groups }: { groups: ProviderGroup[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const closer = useRef<number | undefined>(undefined);
  const hold = (id: string) => {
    window.clearTimeout(closer.current);
    setOpen(id);
  };
  const release = () => {
    window.clearTimeout(closer.current);
    closer.current = window.setTimeout(() => setOpen(null), 150);
  };
  useEffect(() => () => window.clearTimeout(closer.current), []);
  return groups.map((group) => (
    <Popover
      key={group.id}
      open={open === group.id}
      // A closing submenu only clears itself, so it cannot shut the one
      // the pointer just opened.
      onOpenChange={(next) => setOpen((cur) => (next ? group.id : cur === group.id ? null : cur))}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${itemCls(false)} ${MENU_ITEM_STATES} w-full text-left`}
          onPointerEnter={() => hold(group.id)}
          onPointerLeave={release}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              hold(group.id);
            }
          }}
        >
          {/* Baseline-aligned, so the smaller trailing text sits on the
              label's line. The provider name never shrinks; the model name
              keeps a clear gap from it and truncates first. */}
          <span className="flex min-w-0 flex-1 items-baseline gap-6">
            <span className="shrink-0">{group.label}</span>
            {group.current ? (
              <span className="ml-auto min-w-0 max-w-[140px] truncate text-xs text-text-secondary">{group.current}</span>
            ) : (
              <span className="ml-auto shrink-0 text-xs text-text-muted">{group.count}</span>
            )}
          </span>
          <ChevronRight className="menu-row-chevron size-4 shrink-0 text-text-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={4}
        alignOffset={-4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => hold(group.id)}
        onPointerLeave={release}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        <div className={MENU_PANEL}>{group.rows}</div>
      </PopoverContent>
    </Popover>
  ));
}

/** Capability icons — vision / video / tools / reasoning. `ctx` is
 *  dropped here (the context window already shows as a number). Solar
 *  glyphs, same roles the legacy `_CAP_ICONS` used in providers.js. */
function CapIcons({ caps }: { caps: string[] }) {
  const shown = caps.filter((c) => c !== "ctx");
  if (shown.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-[5px] text-text-muted">
      {shown.map((c) => {
        const icon = CAP_ICON[c];
        return icon ? (
          <span key={c} data-tip={c[0].toUpperCase() + c.slice(1)}>
            {icon}
          </span>
        ) : null;
      })}
    </span>
  );
}

const CAP_ICON: Record<string, React.ReactNode> = {
  vision: <SolarIcon motionPreset="none" name="eye" size={14} />,
  video: <SolarIcon motionPreset="none" name="videocamera" size={14} />,
  // The briefcase fills its 24-unit box (y 2–21) while eye and camera
  // span 4–20, so at 14px it looked bigger and higher than its
  // neighbours; 12px gives it the same visual height and the same edges.
  tools: <SolarIcon motionPreset="none" name="case-minimalistic" size={12} />,
  reasoning: <SolarIcon motionPreset="none" name="lightbulb-bolt" size={14} />,
};

/** Compact context-window label: 200000 → "200k", 1048576 → "1M". */
function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
