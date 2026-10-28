/**
 * Overlay scrollbars. TS port of the legacy
 * `public/js/shared/scrollbar.js`.
 *
 * Native scrollbar is hidden on selector-matched containers and a
 * floating thumb is drawn on top instead — the thumb takes no layout
 * width, so content extends edge to edge.
 *
 * `initOverlayScrollbars()` is called once by AppShell on mount.
 */

const SELECTORS = [
  ".chat-area",
  ".detail-body",
  ".sidebar-conversations",
  ".sidebar-conv-list",
  ".sidebar",
  ".pg-folders-nav",
  ".settings-content",
  ".live-exec-tree",
  ".main",
  ".code-modal-body",
];

const FADE_DELAY = 900;
const MIN_THUMB = 32;

const installed = new WeakSet<Element>();

/** The thumb runs down the container's right edge. When that edge is a
 *  rounded card's (a canvas pane, the centre column), the track stops
 *  short of the card's corners, so the thumb never pokes out past them. */
function track(el: HTMLElement): { top: number; height: number } {
  const rect = el.getBoundingClientRect();
  let topInset = 0, bottomInset = 0;
  for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
    const style = getComputedStyle(node);
    const tr = parseFloat(style.borderTopRightRadius) || 0;
    const br = parseFloat(style.borderBottomRightRadius) || 0;
    if (!tr && !br) continue;
    const box = node.getBoundingClientRect();
    if (Math.abs(box.right - rect.right) > 8) break;
    topInset = Math.max(0, tr - (rect.top - box.top));
    bottomInset = Math.max(0, br - (box.bottom - rect.bottom));
    break;
  }
  return { top: rect.top + topInset, height: Math.max(0, rect.height - topInset - bottomInset) };
}

function install(el: HTMLElement): () => void {
  if (installed.has(el)) return () => {};
  installed.add(el);
  el.classList.add("scroll-overlay");

  const thumb = document.createElement("div");
  thumb.className = "overlay-thumb";
  thumb.style.display = "none";
  document.body.appendChild(thumb);

  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let rafPending = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let dragging = false;
  let dragStartY = 0;
  let dragStartScrollTop = 0;
  let frameId = 0;
  let disposed = false;

  function show(): void {
    thumb.classList.add("visible");
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hide, FADE_DELAY);
  }
  function hide(): void {
    if (dragging) return;
    if (thumb.matches(":hover")) return;
    thumb.classList.remove("visible");
  }

  function apply(reveal: boolean): void {
    rafPending = false;
    const rect = el.getBoundingClientRect();
    const sh = el.scrollHeight;
    const ch = el.clientHeight;
    const needs = sh > ch + 1 && rect.height > 0;
    if (!needs) {
      thumb.style.display = "none";
      return;
    }
    const lane = track(el);
    const ratio = ch / sh;
    const thumbH = Math.min(lane.height, Math.max(MIN_THUMB, lane.height * ratio));
    const maxScroll = sh - ch;
    const scrollRatio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
    const top = lane.top + scrollRatio * (lane.height - thumbH);
    const right = window.innerWidth - rect.right + 2;
    thumb.style.display = "";
    thumb.style.height = thumbH + "px";
    thumb.style.top = top + "px";
    thumb.style.right = right + "px";
    if (reveal) show();
  }

  function frame(reveal: boolean): void {
    if (rafPending || disposed) return;
    rafPending = true;
    frameId = requestAnimationFrame(() => apply(reveal));
  }

  function schedule(reveal: boolean): void {
    if (reveal || thumb.classList.contains("visible")) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      frame(reveal);
      return;
    }
    // A hidden thumb only needs its place once things settle. Measuring it
    // every frame of a pane drag or resize forces a layout per frame.
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      frame(false);
    }, 120);
  }

  const onScroll = () => schedule(true);
  const onEnter = () => schedule(false);
  el.addEventListener("scroll", onScroll, { passive: true });
  // Reposition on hover but don't reveal — the thumb only appears while
  // actually scrolling (macOS style), not when the cursor enters the pane.
  el.addEventListener("mouseenter", onEnter);

  const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule(false)) : null;
  resize?.observe(el);
  const mutations = typeof MutationObserver !== "undefined" ? new MutationObserver(() => schedule(false)) : null;
  mutations?.observe(el, { childList: true, subtree: true });

  thumb.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (el.scrollHeight <= el.clientHeight + 1) return;
    dragging = true;
    dragStartY = e.clientY;
    dragStartScrollTop = el.scrollTop;
    thumb.classList.add("dragging");
    thumb.classList.add("visible");
    e.preventDefault();
  });

  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    const lane = track(el);
    const sh = el.scrollHeight;
    const ch = el.clientHeight;
    if (sh <= ch + 1) return;
    const thumbH = Math.min(lane.height, Math.max(MIN_THUMB, lane.height * (ch / sh)));
    const trackH = lane.height - thumbH;
    if (trackH <= 0) return;
    const maxScroll = sh - ch;
    const scrollDelta = ((e.clientY - dragStartY) / trackH) * maxScroll;
    el.scrollTop = dragStartScrollTop + scrollDelta;
  }
  function onDragEnd(): void {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("dragging");
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hide, FADE_DELAY);
  }
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);

  thumb.addEventListener("mouseenter", () => {
    if (fadeTimer) clearTimeout(fadeTimer);
    thumb.classList.add("visible");
  });
  thumb.addEventListener("mouseleave", () => {
    if (dragging) return;
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hide, FADE_DELAY);
  });

  schedule(false);
  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    installed.delete(el);
    el.classList.remove("scroll-overlay");
    el.removeEventListener("scroll", onScroll);
    el.removeEventListener("mouseenter", onEnter);
    resize?.disconnect();
    mutations?.disconnect();
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    for (const timer of [fadeTimer, idleTimer]) if (timer) clearTimeout(timer);
    thumb.remove();
  };
}

/** The overlay thumb on a scroller the selectors cannot reach, such as one
 *  inside a shadow root. The caller hides that scroller's native vertical
 *  bar; the returned function removes the thumb. */
export function attachOverlayScrollbar(el: HTMLElement): () => void {
  return install(el);
}

function scan(root?: ParentNode): void {
  (root || document)
    .querySelectorAll<HTMLElement>(SELECTORS.join(","))
    // A canvas ghost is a still copy of a leaving pane, gone in a moment.
    .forEach((el) => { if (!el.closest("[data-canvas-ghost]")) install(el); });
}

let started = false;

export function initOverlayScrollbars(): void {
  if (started) return;
  started = true;
  scan(document);
  // Pick up dynamically-added containers the moment they land in the DOM.
  // `install` is idempotent (WeakSet guard), so rescanning the whole
  // document on a batch of mutations costs one querySelectorAll — cheaper
  // and more responsive than the 2s poll this replaces. rAF-coalesced so a
  // burst of React commits triggers a single scan.
  if (typeof MutationObserver !== "undefined") {
    let scanPending = false;
    new MutationObserver(() => {
      if (scanPending) return;
      scanPending = true;
      requestAnimationFrame(() => {
        scanPending = false;
        scan(document);
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener("resize", () => {
    document.querySelectorAll(".scroll-overlay").forEach((el) => {
      el.dispatchEvent(new Event("scroll"));
    });
  });
}
