// Desktop bridge api responsibilities.
import "@/lib/net/ws-events";
import type { DesktopAttentionApi, DesktopBrowserDataApi, DesktopBrowserImportApi, DesktopDownloadsApi, DesktopHistoryApi, DesktopMainMenuApi, DesktopNativeMenuApi, DesktopTerminalApi, DesktopThemeApi, DesktopUpdateApi, DesktopWebTabApi } from "@/lib/desktop/desktop-bridge-types";
import type { DesktopTabTransferApi } from "@/lib/desktop/desktop-transfer-types";



export interface DesktopReopenState {
  updateId: string | null;
  sessionId: string | null;
  status: "inactive" | "pending" | "acknowledged" | "unavailable" | "manual_navigation";
  reason: string | null;
}

export interface DesktopBridge {
  readonly isDesktop: true;
  readonly platform?: "darwin" | "win32" | "linux";
  readonly windowId: string;
  writeClipboardText?(text: string): Promise<void>;
  selfUpdateCapture?(nonce: string): Promise<{ ok: boolean; reason?: string }>;
  /** One-time owner token after worker credential rotation. Never persisted. */
  refreshOwnerAuth?(): Promise<string | null>;
  /** Update-triggered original-session recovery; absent in older shells. */
  selfUpdateReopen?: {
    getState(): Promise<DesktopReopenState | null>;
    sessionLoaded(sessionId: string): Promise<DesktopReopenState | null>;
    onState(callback: (state: DesktopReopenState) => void): () => void;
  };
  /** Absolute native path for a user-selected/dropped File. */
  getPathForFile?(file: File): string;
  /** shell.openExternal — http/https only. */
  openExternal(url: string): void;
  /** Close this window (last tab closed → close window). */
  closeWindow?(): void;
  /** Move this window by a pixel delta (single-tab drag = move window). */
  moveWindowBy?(dx: number, dy: number): void;
  /** A JPEG of a region of this page (CSS px): a small one for overview
   *  thumbnails, or the display resolution with `full`. */
  captureRegion?(rect: { x: number; y: number; width: number; height: number }, options?: { full?: boolean }): Promise<string | null>;
  webTab: DesktopWebTabApi;
  tabTransfer: DesktopTabTransferApi;
  /** Top-layer ⋮ menu overlay. Absent in shells older than this build. */
  mainMenu?: DesktopMainMenuApi;
  contextMenu?: DesktopNativeMenuApi;
  /** Absent in shells older than the browsing-history build. */
  history?: DesktopHistoryApi;
  /** Desktop-only download history and active download controls. */
  downloads?: DesktopDownloadsApi;
  updates: DesktopUpdateApi;
  /** Notifications and keep-awake. Absent in shells older than this build. */
  attention?: DesktopAttentionApi;
  /** Desktop-only, explicit import from a detected local browser profile. */
  browserImport?: DesktopBrowserImportApi;
  /** Desktop-only clearing of the built-in browser profile. */
  browserData?: DesktopBrowserDataApi;
  /** Desktop-only local PTY. Never exposed by the Web server. */
  terminal?: DesktopTerminalApi;
  /** Keep the native window background aligned with the resolved web theme. */
  theme?: DesktopThemeApi;
  /** Draw the agent cursor at a screen point an Agent step acts on in a
   *  desktop app. Absent in shells older than this build. */
  nativeActionCue?(cue: NativeActionCue): void;
}

/** One Agent step in a desktop app: its screen point (points, origin at the
 *  top left of the main display) and the identity that dedupes the frame
 *  every App window receives. */
export interface NativeActionCue {
  session_id: string;
  x: number;
  y: number;
  sequence: number;
  at: number;
}

/** The preload-exposed bridge, or null outside the desktop shell. */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.openprogramDesktop ?? null;
}
