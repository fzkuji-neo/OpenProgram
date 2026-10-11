"use client";

import { create } from "zustand";
import { followNativeWindow } from "../chat/session-resources.ts";

/** The native app window an Agent last operated in a conversation. */
export type NativeWindow = {
  sessionId: string;
  executionId: string;
  windowId: number;
  appName: string;
  sequence: number;
  hasFrame: boolean;
};

export const useNativeWindows = create<{ windows: Record<string, NativeWindow> }>(() => ({
  windows: {},
}));

export function ingestNativeWindow(data: unknown): NativeWindow | null {
  if (!data || typeof data !== "object") return null;
  const item = data as Record<string, unknown>;
  if (typeof item.session_id !== "string" || !item.session_id
      || !Number.isInteger(item.window_id) || typeof item.app_name !== "string"
      || !Number.isInteger(item.sequence)) return null;
  const next: NativeWindow = {
    sessionId: item.session_id,
    executionId: typeof item.execution_id === "string" ? item.execution_id : "",
    windowId: item.window_id as number,
    appName: item.app_name,
    sequence: item.sequence as number,
    hasFrame: item.has_frame === true,
  };
  const previous = useNativeWindows.getState().windows[next.sessionId];
  // Events can arrive twice or out of order across reconnects.
  if (previous && previous.sequence >= next.sequence) return previous;
  useNativeWindows.setState(state => ({ windows: { ...state.windows, [next.sessionId]: next } }));
  followNativeWindow(next.sessionId, next.windowId);
  return next;
}

/** Cache-busted address of the latest frame the Agent saw of this window. */
export function nativeWindowFrameUrl(window: NativeWindow): string | null {
  if (!window.hasFrame) return null;
  const session = encodeURIComponent(window.sessionId);
  return `/api/session/${session}/native-window/frame?window_id=${window.windowId}&v=${window.sequence}`;
}

if (typeof window !== "undefined") {
  window.addEventListener("op:ws-message", (event) => {
    const detail = (event as CustomEvent<{ type?: string; data?: unknown }>).detail;
    if (detail?.type === "native.window") ingestNativeWindow(detail.data);
  });
}
