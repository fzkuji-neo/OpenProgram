"use client";

import { SolarIcon } from "@/components/solar-icons";
import { HoverTip, TipBody } from "@/components/ui/tooltip";
import { surfaceRefForChat } from "@/lib/desktop/desktop-bridge";
import { useTranslation } from "@/lib/i18n";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import styles from "../environment-row.module.css";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WebSurfaceChip({
  sessionId,
  toolsEnabled,
  onToggleAccess,
}: {
  sessionId: string | null;
  toolsEnabled: boolean;
  onToggleAccess(): void;
}) {
  const { text } = useTranslation();
  useCenterTabs((state) => state.activeId);
  useCenterTabs((state) => state.splitWebTabId);
  useCenterTabs((state) => state.tabs);
  useCenterTabs((state) => state.groups);
  const surface = surfaceRefForChat(sessionId, toolsEnabled);
  if (!surface) return null;

  const stateLabel = toolsEnabled
    ? text("Agent can access", "Agent 可访问")
    : text("Web control disabled", "网页控制未启用");
  const title =
    surface.title || new URL(surface.url || "about:blank").hostname || "Web";
  return (
    <HoverTip
      label={
        <TipBody
          title={text(`Web page: ${title}`, `网页：${title}`)}
          detail={
            toolsEnabled
              ? text("The agent can read and operate this page. Click to stop.", "agent 可以读取并操作这个网页。点击停止。")
              : text("The agent can't use this page. Click to allow it.", "agent 不能使用这个网页。点击允许。")
          }
        />
      }
    >
      <button
        type="button"
        className={`${cn(buttonVariants({ variant: "elevated", size: "sm" }))} status-badge ${styles.surfaceChip} ${toolsEnabled ? "" : "paused"}`}
        aria-label={`${stateLabel}: ${title}`}
        aria-pressed={toolsEnabled}
        onClick={onToggleAccess}
      >
        <SolarIcon name="earth" size={14} aria-hidden="true" />
        <span className={styles.surfaceChipLabel}>
          {title}
        </span>
      </button>
    </HoverTip>
  );
}
