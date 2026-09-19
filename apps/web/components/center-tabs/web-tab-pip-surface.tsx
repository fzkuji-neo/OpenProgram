"use client";

import { useEffect, useRef } from "react";
import * as desktop from "@/lib/desktop/desktop-bridge";
import { isWebTabOccluded, measureWebTabBounds } from "@/lib/browser/web-tab-bounds";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { useTranslation } from "@/lib/i18n";
import styles from "./center-tabs.module.css";

/** Hosts the existing native Page; it never captures or duplicates its contents. */
export function WebTabPipSurface({ tabId, url, native }: {
  tabId: string; url: string; native: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const initialUrl = useRef(url);
  const { text } = useTranslation();
  useEffect(() => {
    const bridge = desktop.desktopBridge();
    const body = bodyRef.current;
    if (!native || !bridge || !body) return;
    desktop.installDesktopMenuHandlers();
    desktop.ensureWebView(bridge, tabId, initialUrl.current);
    let disposed = false;
    let frame = 0;
    let zoomWidth = 0;
    const report = () => {
      if (disposed) return;
      const bounds = measureWebTabBounds(body);
      const occluded = isWebTabOccluded(bounds, document.querySelectorAll(
        '[role="dialog"], [role="menu"], [role="listbox"], .branches-merge-modal-backdrop, [data-native-view-occluder="true"]',
      ));
      if (occluded || bounds.width <= 0 || bounds.height <= 0) {
        desktop.removeVisibleWebTabBounds(bridge, tabId);
        desktop.setWebTabReady(tabId, false);
        return;
      }
      if (zoomWidth !== bounds.width) {
        bridge.webTab.setPipZoom?.(tabId, bounds.width);
        zoomWidth = bounds.width;
      }
      desktop.registerVisibleWebTabBounds(bridge, tabId, bounds);
      desktop.setWebTabReady(tabId, true);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; report(); });
    };
    const pip = body.closest('[data-pip="true"]');
    // Drag writes already occur once per animation frame. Publish in that frame,
    // rather than waiting for ResizeObserver (which does not observe transforms).
    pip?.addEventListener("op:pip-geometry", report);
    const resize = new ResizeObserver(schedule);
    resize.observe(body);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const unsubscribe = bridge.webTab.onState(state => {
      if (state.id !== tabId) return;
      const patch: { url?: string; title?: string; faviconUrl?: string } = {};
      if (state.url) patch.url = state.url;
      if (state.title) patch.title = state.title;
      if (state.faviconUrl !== undefined) patch.faviconUrl = state.faviconUrl;
      if (Object.keys(patch).length) useCenterTabs.getState().updateWebTab(tabId, patch);
    });
    report();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      pip?.removeEventListener("op:pip-geometry", report);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      unsubscribe();
      desktop.removeVisibleWebTabBounds(bridge, tabId);
      desktop.setWebTabReady(tabId, false);
      bridge.webTab.setPipZoom?.(tabId, null);
    };
  }, [native, tabId]);

  if (native) return <div ref={bodyRef} className={styles.webPipLive} data-pip-live="native" />;
  return <div className={styles.webPipEmbedded} data-pip-live="iframe">
    <div className={styles.webPipEmbedHint}>{text(
      "Embedded page · some sites require Open page",
      "嵌入页面 · 部分网站需点击打开页面",
    )}</div>
    {/^https?:\/\//i.test(url) ? <iframe
      key={tabId}
      src={url}
      title={text("Interactive page preview", "可交互页面预览")}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      className={styles.webPipFrame}
    /> : <div className={styles.webPipFallback}>{text("This page cannot be embedded", "此页面无法嵌入")}</div>}
  </div>;
}
