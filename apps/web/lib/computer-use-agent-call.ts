/** Reading a ``computer_use_agent`` call: which screen it operates and, for
 *  application windows, the same flat step shape the app renderers use. */
export type Args = Record<string, unknown>;

function record(value: unknown): Args {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Args : {};
}

/** "app" | "browser" | "chrome" | "vm", or "" when the call names none. */
export function computerUseAgentTarget(args: Args): string {
  return typeof args.target === "string" ? args.target : "";
}

export function isFreshCall(args: Args): boolean {
  return args.context === "fresh";
}

/** One step with its arguments beside its action: {action, ref, …}. */
function flatStep(step: unknown): Args {
  const item = record(step);
  const { args, ...rest } = item;
  return { ...rest, ...record(args) };
}

/** An app call as one flat step: {action, app, …}. Several steps become a
 *  batch, code and a fresh agent become their own actions, and a call with
 *  no action reads the app (or lists apps). Null for the other targets. */
export function appStepArgs(args: Args): Args | null {
  if (computerUseAgentTarget(args) !== "app") return null;
  const shared = record(args.args);
  if (isFreshCall(args)) return { ...shared, action: "fresh", brief: args.brief };
  if (typeof args.code === "string" && args.code.trim()) return { ...shared, action: "code", code: args.code };
  if (Array.isArray(args.actions) && args.actions.length) {
    return { ...shared, action: "batch", actions: args.actions.map(flatStep) };
  }
  const action = typeof args.action === "string" && args.action
    ? args.action : typeof shared.app === "string" && shared.app ? "get_app_state" : "list_apps";
  return { ...shared, action };
}

/** A browser or VM call's action, or how many steps it runs. */
export function screenStep(args: Args): { action: string; steps: number; url: string } {
  const shared = record(args.args);
  const steps = Array.isArray(args.actions) ? args.actions.length : 0;
  const first = steps ? flatStep((args.actions as unknown[])[0]) : shared;
  const action = isFreshCall(args) ? "fresh"
    : typeof args.code === "string" && args.code.trim() ? "code"
    : typeof args.action === "string" ? args.action : "";
  return { action, steps, url: typeof first.url === "string" ? first.url : "" };
}
