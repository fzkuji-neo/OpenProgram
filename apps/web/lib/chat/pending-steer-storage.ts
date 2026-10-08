import type { QueuedMessage } from "./send-queue";

const KEY = "openprogram.pending-steers.v1";
type Queues = Record<string, QueuedMessage[]>;

/** Only text steering receipts and explicitly held steering drafts survive reload.
 * Ordinary unsent messages and attachment bytes never enter this storage. */
export function savePendingSteers(queues: Queues): void {
  try {
    const retained = Object.fromEntries(Object.entries(queues).map(([sid, rows]) => [sid,
      rows.filter(row => row.steerCommand || ["cancelled", "ended"].includes(row.steerError ?? ""))
        .filter(row => !row.images?.length && !row.docs?.length)
        .map(row => ({id:row.id,text:row.text,queuedAt:row.queuedAt,
          thinking:row.thinking,toolsEnabled:row.toolsEnabled,toolsProfile:row.toolsProfile,
          webSearchEnabled:row.webSearchEnabled,serviceTier:row.serviceTier,background:row.background,
          steerCommand:row.steerCommand,steerError:row.steerError})),
    ]).filter(([, rows]) => (rows as QueuedMessage[]).length));
    if (Object.keys(retained).length) sessionStorage.setItem(KEY, JSON.stringify(retained));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be disabled or full. Keep the live queue and immutable receipt.
  }
}

export function loadPendingSteers(): Queues {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    const queues: Queues = {};
    for (const [sid, rows] of Object.entries(saved)) {
      if (!Array.isArray(rows)) continue;
      const valid: QueuedMessage[] = [];
      for (const row of rows) {
        if (!row || typeof row.id !== "string" || typeof row.text !== "string"
          || !Number.isFinite(row.queuedAt) || typeof row.thinking !== "string"
          || typeof row.toolsEnabled !== "boolean" || typeof row.webSearchEnabled !== "boolean"
          || typeof row.background !== "boolean" || row.images?.length || row.docs?.length) continue;
        const command = row.steerCommand;
        if (command) {
          if (command.type !== "execution.command" || command.action !== "execution.steer"
            || typeof command.command_id !== "string" || typeof command.execution_id !== "string"
            || !Number.isInteger(command.expected_version) || command.payload?.message !== row.text) continue;
        } else if (!["cancelled", "ended"].includes(row.steerError)) continue;
        valid.push({...row, injecting:false, editing:false,
          steerError: ["cancelled", "ended"].includes(row.steerError) ? row.steerError : "unconfirmed"});
      }
      if (valid.length) Object.defineProperty(queues, sid, {value:valid,enumerable:true,writable:true,configurable:true});
    }
    return queues;
  } catch { return {}; }
}
