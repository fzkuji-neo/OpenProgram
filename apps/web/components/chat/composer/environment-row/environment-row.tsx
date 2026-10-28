"use client";

import { useRef } from "react";

import { GoalChip } from "../../badges/goal-chip";
import { ProjectBadge, WorkingDirChips } from "../../top-bar";
import { ChannelChip } from "./chips/channel-chip";
import { EnvironmentChip } from "./chips/environment-chip";
import { WebPreviewChip } from "./chips/web-preview-chip";
import { WebSurfaceChip } from "./chips/web-surface-chip";
import { useCompactEnvironmentRow } from "./use-compact-environment-row";
import styles from "./environment-row.module.css";

interface EnvironmentRowProps {
  sessionId: string | null;
  toolsEnabled: boolean;
  onToggleAccess(): void;
}

export function EnvironmentRow({
  sessionId,
  toolsEnabled,
  onToggleAccess,
}: EnvironmentRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useCompactEnvironmentRow(rowRef);

  return (
    <div ref={rowRef} className={styles.envChips} data-environment-row>
      <EnvironmentChip />
      <ChannelChip />
      <ProjectBadge />
      <WorkingDirChips />
      <GoalChip />
      {/* Web tab access + picture-in-picture: right-aligned (CSS). */}
      <WebSurfaceChip
        sessionId={sessionId}
        toolsEnabled={toolsEnabled}
        onToggleAccess={onToggleAccess}
      />
      <WebPreviewChip />
    </div>
  );
}
