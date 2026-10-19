export type TurnHistoryOperation = "undo" | "revert" | "redo" | "reapply";

/** Why the history action is withheld, as reported by ``turn_history_state``. */
export type TurnHistoryReason =
  | "files_changed"
  | "not_recoverable"
  | "inactive_branch"
  | "agent_running"
  | "run_active"
  | "in_progress";

export interface TurnHistoryState {
  status: string;
  operation: TurnHistoryOperation | null;
  reason?: string;
  error?: string;
}

/** Notices keyed by reason; ``fallback`` covers states with no known reason. */
export type TurnHistoryNotices = Partial<Record<TurnHistoryReason, string>> & { fallback: string };

/**
 * What the card shows next to Review. Expected states (files edited since,
 * a run still going) read as a quiet ``info`` line; only an action that just
 * failed is a ``warning``. Engine error text is never shown as the notice.
 */
export function historyPresentation(
  state: TurnHistoryState | null,
  transientError: string,
  notices: TurnHistoryNotices,
) {
  if (transientError) {
    return { notice: transientError, tone: "warning" as const, operation: null };
  }
  if (state && state.status !== "ready") {
    const known = state.reason ? notices[state.reason as TurnHistoryReason] : undefined;
    return { notice: known || notices.fallback, tone: "info" as const, operation: null };
  }
  return { notice: "", tone: "info" as const, operation: state?.operation ?? null };
}
