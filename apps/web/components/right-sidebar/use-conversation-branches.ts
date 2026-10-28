"use client";

/**
 * The conversation's branches as the Branches panel and the DAG know them
 * (`runtimeState._branchesByConv`): name, which one is checked out, and
 * each one's lane colour in the graph. The runtime fetches them when a
 * conversation loads; this re-reads them whenever it says they changed.
 */
import { useEffect, useState } from "react";
import { runtimeState } from "@/lib/runtime-bridge/state";
import { LANE_COLORS } from "@/lib/format-utils/lane-colors";
import type { BranchRow } from "./branches/types";

export type ConversationBranch = { head: string; name: string | null; active: boolean; color: string };

function read(sessionId: string | null): ConversationBranch[] {
  if (!sessionId) return [];
  const rows = (runtimeState._branchesByConv[sessionId] as BranchRow[] | undefined) || [];
  const colors = runtimeState._branchLaneColorMap as Record<string, string>;
  return rows.map((row, index) => ({
    head: row.head_msg_id, name: row.name || null, active: Boolean(row.active),
    color: colors[row.head_msg_id] || LANE_COLORS[index % LANE_COLORS.length],
  }));
}

export function useConversationBranches(sessionId: string | null): ConversationBranch[] {
  const [branches, setBranches] = useState(() => read(sessionId));
  useEffect(() => {
    const update = () => setBranches(read(sessionId));
    update();
    window.addEventListener("branches-updated", update);
    return () => window.removeEventListener("branches-updated", update);
  }, [sessionId]);
  return branches;
}
