"use client";

import { useEffect, useRef } from "react";
import * as desktop from "@/lib/desktop/desktop-bridge";
import { isWebTabOccluded, measureWebTabBounds } from "@/lib/browser/web-tab-bounds";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import { useTranslation } from "@/lib/i18n";
import styles from "./center-tabs.module.css";

/** Hosts the existing Page; gesture-only bitmaps keep chrome and content in one compositor. */
export function WebTabPipSurface({ tabId, url, native }: {
  tabId: string; url: string; native: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const initialUrl = useRef(url);
  const gestureFrameRef = useRef<HTMLImageElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { text } = useTranslation();
  useEffect(() => {
    const bridge = desktop.desktopBridge();
    const body = bodyRef.current;
    if (!native || !bridge || !body) return;
    desktop.installDesktopMenuHandlers();
    desktop.ensureWebView(bridge, tabId, initialUrl.current);
    let disposed = false;
    let frame = 0;
    let gesture = false;
    let generation = 0;
    let preparing = Promise.resolve();
    const waits = new Map<ReturnType<typeof setTimeout>, () => void>();
    // Capture/decoding failure must not leave a live page permanently hidden.
    const bounded = <T,>(work: Promise<T>): Promise<T | null> => new Promise(resolve => {
      const timer = setTimeout(() => { waits.delete(timer); resolve(null); }, 900);
      waits.set(timer, () => resolve(null));
      work.then(resolve, () => resolve(null)).finally(() => {
        clearTimeout(timer);
        waits.delete(timer);
      });
    });
    const captureFrame = async () => {
      const data = await bridge.webTab.capture?.(tabId, "presentation");
      if (!data) return null;
      const decoded = document.createElement("img");
      decoded.src = data;
      await decoded.decode();
      return data;
    };
    const beginGesture = () => {
      gesture = true;
      const token = ++generation;
      preparing = (async () => {
        const data = await bounded(captureFrame());
        if (disposed || token !== generation || !gesture || !data) return;
        const image = gestureFrameRef.current;
        if (!image) return;
        image.src = data;
        image.hidden = false;
        desktop.removeVisibleWebTabBounds(bridge, tabId);
        desktop.setWebTabReady(tabId, false);
      })();
    };
    const endGesture = async () => {
      const token = generation;
      await preparing;
      if (disposed || token !== generation || !gesture) return;
      const bounds = measureWebTabBounds(body);
      // Update the hidden native surface once; capturePage waits for a paint
      // without changing the fixed virtual viewport or attaching a debugger.
      bridge.webTab.setBounds(tabId, bounds);
      await bounded(bridge.webTab.capture?.(tabId, "presentation") ?? Promise.resolve(null));
      if (disposed || token !== generation) return;
      gesture = false;
      report();
    };
    let zoomWidth = 0;
    let zoomHeight = 0;
    const report = () => {
      if (disposed) return;
      const bounds = measureWebTabBounds(body);
      const occluded = isWebTabOccluded(bounds, document.querySelectorAll(
        '[role="dialog"], [role="menu"], [role="listbox"], .branches-merge-modal-backdrop, [data-native-view-occluder="true"]',
      ));
      if (occluded || bounds.width <= 0 || bounds.height <= 0) {
        const image = gestureFrameRef.current;
        if (image && !image.hidden) image.hidden = true;
        desktop.removeVisibleWebTabBounds(bridge, tabId);
        desktop.setWebTabReady(tabId, false);
        return;
      }
      if (gesture) return;
      if (zoomWidth !== bounds.width || zoomHeight !== bounds.height) {
        bridge.webTab.setPipZoom?.(tabId, bounds.width, bounds.height);
        zoomWidth = bounds.width;
        zoomHeight = bounds.height;
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
    pip?.addEventListener("op:pip-gesture-start", beginGesture);
    pip?.addEventListener("op:pip-gesture-end", endGesture);
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
      generation++;
      for (const [timer, cancel] of waits) { clearTimeout(timer); cancel(); }
      waits.clear();
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      pip?.removeEventListener("op:pip-geometry", report);
      pip?.removeEventListener("op:pip-gesture-start", beginGesture);
      pip?.removeEventListener("op:pip-gesture-end", endGesture);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      unsubscribe();
      desktop.removeVisibleWebTabBounds(bridge, tabId);
      desktop.setWebTabReady(tabId, false);
      bridge.webTab.setPipZoom?.(tabId, null);
    };
  }, [native, tabId]);

  useEffect(() => {
    if (native) return;
    const body = bodyRef.current;
    const iframe = iframeRef.current;
    if (!body || !iframe) return;
    const fit = () => {
      const scale = Math.min(body.clientWidth / 1920, body.clientHeight / 1080);
      iframe.style.transform = `scale(${scale})`;
    };
    const resize = new ResizeObserver(fit);
    resize.observe(body);
    fit();
    return () => resize.disconnect();
  }, [native, tabId, url]);

  if (native) return <div ref={bodyRef} className={styles.webPipLive} data-pip-live="native">
    {/* Retain the decoded frame underneath until the native surface is visible. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={gestureFrameRef} hidden alt="" draggable={false} data-pip-gesture-frame="true" className={styles.webPipGestureFrame} />
  </div>;
  return <div className={styles.webPipEmbedded} data-pip-live="iframe">
    <div className={styles.webPipEmbedHint}>{text(
      "Embedded page · some sites require Open page",
      "嵌入页面 · 部分网站需点击打开页面",
    )}</div>
    <div ref={bodyRef} className={styles.webPipFrameViewport}>
    {/^https?:\/\//i.test(url) ? <iframe
      ref={iframeRef}
      key={tabId}
      src={url}
      title={text("Interactive page preview", "可交互页面预览")}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      className={styles.webPipFrame}
    /> : <div className={styles.webPipFallback}>{text("This page cannot be embedded", "此页面无法嵌入")}</div>}
    </div>
  </div>;
}
