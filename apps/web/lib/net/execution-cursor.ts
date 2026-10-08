export type ExecutionCursor = {
  execution_id: string;
  next_sequence: number;
  snapshot_status_version: number;
};

const storageKey = "openprogram.execution-cursors.v1";
type StoredCursor = ExecutionCursor & { status?: string; session_id?: string };
const cursors = new Map<string, StoredCursor>();
const terminal = new Set(["cancelled", "completed", "failed", "interrupted", "error", "done"]);
let loaded = false;
function recoverable(): ExecutionCursor[] {
  return Array.from(cursors.values()).filter(cursor => !terminal.has(cursor.status ?? ""));
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(recoverable()));
  } catch { /* Storage is optional; live delivery must continue. */ }
}

export function loadExecutionCursors(): ExecutionCursor[] {
  if (typeof window === "undefined" || loaded) return recoverable();
  loaded = true;
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(raw)) {
      for (const cursor of raw) {
        if (
          cursor && typeof cursor.execution_id === "string"
          && Number.isSafeInteger(cursor.next_sequence) && cursor.next_sequence > 0
          && Number.isSafeInteger(cursor.snapshot_status_version)
        ) cursors.set(cursor.execution_id, cursor);
      }
    }
  } catch { /* discard malformed browser state */ }
  return recoverable();
}

export function recordExecutionCursor(value: unknown, execution?: { status?: unknown; session_id?: unknown }): {
  cursor?: ExecutionCursor;
  replayAfter?: number;
} {
  if (!value || typeof value !== "object") return {};
  const raw = value as Partial<ExecutionCursor>;
  const nextSequence = raw.next_sequence;
  const snapshotStatusVersion = raw.snapshot_status_version;
  if (
    typeof raw.execution_id !== "string" || !raw.execution_id
    || typeof nextSequence !== "number" || !Number.isSafeInteger(nextSequence) || nextSequence < 1
    || typeof snapshotStatusVersion !== "number" || !Number.isSafeInteger(snapshotStatusVersion)
  ) return {};
  const cursor: ExecutionCursor = {
    execution_id: raw.execution_id,
    next_sequence: nextSequence,
    snapshot_status_version: snapshotStatusVersion,
  };
  loadExecutionCursors();
  const previous = cursors.get(cursor.execution_id);
  if (previous && (cursor.next_sequence < previous.next_sequence
      || cursor.snapshot_status_version < previous.snapshot_status_version)) return {};
  if (previous && terminal.has(previous.status ?? "") && execution?.status !== undefined && !terminal.has(String(execution.status))) return {};
  const stored: StoredCursor = {
    ...cursor,
    ...(typeof execution?.status === "string" ? { status: execution.status } : previous?.status ? { status: previous.status } : {}),
    ...(typeof execution?.session_id === "string" ? { session_id: execution.session_id } : previous?.session_id ? { session_id: previous.session_id } : {}),
  };
  if (previous && JSON.stringify(previous) === JSON.stringify(stored)) return { cursor };
  cursors.set(cursor.execution_id, stored);
  // Terminal tombstones protect against late frames during this connection,
  // but neither persisted state nor retained tombstones grow with chat age.
  const finished = Array.from(cursors.values()).filter(item => terminal.has(item.status ?? ""));
  for (const old of finished.slice(0, Math.max(0, finished.length - 256))) cursors.delete(old.execution_id);
  persist();
  // A live cursor that skips local history must be replayed before its frame
  // is allowed to advance the reducer.  A snapshot/replay response replaces
  // state and therefore calls this after recovery, with no local gap.
  return previous && cursor.next_sequence > previous.next_sequence + 1
    ? { cursor, replayAfter: previous.next_sequence - 1 }
    : { cursor };
}
