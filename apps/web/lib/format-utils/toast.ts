/**
 * Tiny app-wide transient toast.
 *
 * There was no toast component in the project (only a one-off inline
 * bubble in the sessions list and a legacy `window.__toast` global that
 * may not exist), so this is the shared one: call `showToast(...)` from
 * anywhere and `<ToastHost/>` (mounted once in the top bar) renders a
 * top-centred bubble that fades itself out after a few seconds.
 *
 * A toast may carry an optional `link` (label + href) rendered as a
 * clickable anchor inside the bubble — e.g. "→ open Settings".
 */

export type ToastTone = "info" | "warn" | "error";

export interface ToastLink {
  label: string;
  href: string;
}

/** A button in the toast, such as Undo; clicking it also dismisses the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastDetail {
  message: string;
  tone?: ToastTone;
  /** Auto-dismiss after this many ms (default 3500). */
  duration?: number;
  /** Optional inline link rendered after the message. */
  link?: ToastLink;
  action?: ToastAction;
}

export interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
  link?: ToastLink;
  action?: ToastAction;
}

export const TOAST_EVENT = "op:toast";

/** Fire a transient toast. No-op during SSR. */
export function showToast(message: string, opts: ToastOptions = {}): void {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: {
        message,
        tone: opts.tone ?? "info",
        duration: opts.duration ?? 3500,
        link: opts.link,
        action: opts.action,
      },
    }),
  );
}
