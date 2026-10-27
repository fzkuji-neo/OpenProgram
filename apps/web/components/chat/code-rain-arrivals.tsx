/**
 * CodeRainArrivals — with the code rain on (Settings → General → Welcome
 * animation), a message that arrives live comes in through the rain.
 *
 * A sent message: drops fall from above into every column its text
 * covers, and each character shows as code once a drop reaches it, then
 * decodes into the real character and fades from green to the text
 * colour. A streamed reply: every new piece gets short drops that land on
 * the new characters, which decode the same way. History that loads or
 * comes back into view shows as it is.
 *
 * Nothing in the transcript DOM changes. The characters not yet decoded
 * are hidden and tinted through CSS custom highlights (transcript.css),
 * and the drops and code glyphs are drawn on one canvas over the chat
 * area, so selection, find-in-page and React rendering are untouched.
 */
"use client";

import { useEffect } from "react";

import { CODE_RAIN_FONT, codeRainPalette, drawMirrored, randomGlyph } from "@/lib/chat/code-rain";
import { useWelcomeBackdropPref } from "@/lib/prefs/welcome-backdrop-pref";

/** Seconds a decoded character takes to fade from green to its colour. */
const FADE = 0.6;
const FADE_STEPS = 6;
/** Drop geometry: glyph spacing in a falling column, and column width. */
const STEP = 18;
const BAND = 16;
/** Pieces this long (or the first text of a message) fall from above. */
const BURST = 40;
/** Past this many new characters, only those on screen are animated. */
const MAX_ANIMATED = 900;

type CharState = { ch: string; reveal: number; settle: number; glyph: string; next: number; fade: number };
type Tracker = {
  el: HTMLElement;
  role: "user" | "assistant";
  /** Characters of its text already handed out (decoded or in flight). */
  seen: number;
  chars: Map<number, CharState>;
  observer: MutationObserver | null;
  dirty: boolean;
  /** When the element left the DOM; a re-keyed row is picked up again. */
  lostAt: number | null;
};
type Fresh = { index: number; ch: string; rect: DOMRect; fade: number };
type Drop = { x: number; y0: number; start: number; stopY: number; v: number; len: number; glyphs: string[] };

const ROOTS = { user: ".user-md", assistant: ".chat-text" } as const;

export function CodeRainArrivals({ mount }: { mount: HTMLElement }) {
  const { enabled } = useWelcomeBackdropPref();
  useEffect(() => {
    if (!enabled) return;
    if (typeof Highlight === "undefined" || !("highlights" in CSS)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return startArrivals(mount);
  }, [enabled, mount]);
  return null;
}

function startArrivals(mount: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "code-rain-arrivals";
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return () => {}; }

  const hidden = new Highlight();
  const fades = Array.from({ length: FADE_STEPS }, () => new Highlight());
  CSS.highlights.set("code-rain-hidden", hidden);
  fades.forEach((h, i) => CSS.highlights.set(`code-rain-fade-${i}`, h));

  const trackers: Tracker[] = [];
  let drops: Drop[] = [];
  let raf = 0;
  let running = false;
  const now = () => performance.now() / 1000;
  const area = () => mount.closest<HTMLElement>(".chat-area");

  // ---- Text model: a message's text is the concatenation of its roots ----
  function roots(t: Tracker): HTMLElement[] {
    return Array.from(t.el.querySelectorAll<HTMLElement>(ROOTS[t.role]));
  }
  function textOf(t: Tracker): string {
    return roots(t).map((r) => r.textContent ?? "").join("");
  }
  /** Maps text offsets to DOM positions; built once per use, since a
   *  streamed reply's markdown replaces its text nodes on every piece. */
  function locator(t: Tracker) {
    const nodes: Text[] = [];
    const starts: number[] = [];
    let total = 0;
    for (const root of roots(t)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n as Text);
        starts.push(total);
        total += (n as Text).data.length;
      }
    }
    return (index: number, length: number): Range | null => {
      let lo = 0, hi = nodes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= index) lo = mid; else hi = mid - 1;
      }
      const node = nodes[lo];
      if (!node) return null;
      const offset = index - starts[lo];
      if (offset + length > node.data.length) return null;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + length);
      return range;
    };
  }

  // ---- New characters get their timing ----
  function schedule(t: Tracker) {
    t.dirty = false;
    const text = textOf(t);
    if (text.length < t.seen) {
      // The markdown re-rendered shorter (a closing marker consumed text).
      for (const i of t.chars.keys()) if (i >= text.length) t.chars.delete(i);
      t.seen = text.length;
      return;
    }
    if (text.length === t.seen) return;
    const from = t.seen;
    t.seen = text.length;
    const box = area()?.getBoundingClientRect();
    if (!box) return;
    const locate = locator(t);
    const fresh: Fresh[] = [];
    for (let i = from; i < text.length; i++) {
      let ch = text[i];
      const code = ch.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) ch = text.slice(i, i + 2);
      const at = i;
      i += ch.length - 1;
      if (!ch.trim()) continue;
      const range = locate(at, ch.length);
      const rect = range?.getClientRects()[0];
      if (!range || !rect || !rect.width) continue;
      // Off-screen text is not animated: it would decode unseen.
      if (rect.bottom < box.top || rect.top > box.bottom) continue;
      fresh.push({ index: at, ch, rect, fade: plainColour(range) ? FADE : 0 });
    }
    if (fresh.length > MAX_ANIMATED) fresh.length = MAX_ANIMATED;
    if (!fresh.length) return;
    const t0 = now();
    if (from === 0 || fresh.length > BURST) fallFromAbove(t, fresh, box, t0);
    else fallOnto(t, fresh, t0);
  }

  /** Whole messages: one drop per column falls from above the text and
   *  decodes it line by line as it passes. */
  function fallFromAbove(t: Tracker, fresh: Fresh[], box: DOMRect, t0: number) {
    const v = 1100;
    const top = Math.min(...fresh.map((f) => f.rect.top));
    const y0 = Math.max(box.top, top - 240) - box.top;
    const bands = new Map<number, typeof fresh>();
    for (const f of fresh) {
      const key = Math.floor((f.rect.left + f.rect.width / 2 - box.left) / BAND);
      const list = bands.get(key);
      if (list) list.push(f); else bands.set(key, [f]);
    }
    for (const [key, list] of bands) {
      const start = t0 + Math.random() * 0.25;
      // The drop sinks into the column's first character; the characters
      // below it keep decoding at the same speed, as if it went on.
      const first = Math.min(...list.map((f) => f.rect.top + f.rect.height / 2 - box.top));
      drops.push(drop(key * BAND + BAND / 2, y0, start, first, v, 10 + Math.floor(Math.random() * 9)));
      for (const f of list) {
        const reveal = start + (f.rect.top + f.rect.height / 2 - box.top - y0) / v;
        t.chars.set(f.index, state(f, reveal, reveal + 0.18 + Math.random() * 0.32));
      }
    }
  }

  /** Streamed pieces: short drops land on the new characters. */
  function fallOnto(t: Tracker, fresh: Fresh[], t0: number) {
    const box = area()?.getBoundingClientRect();
    if (!box) return;
    const v = 800;
    const landed = new Set<string>();
    for (const f of fresh) {
      const x = f.rect.left + f.rect.width / 2 - box.left;
      const y = f.rect.top + f.rect.height / 2 - box.top;
      const fall = (3 + Math.random() * 3) * STEP;
      const reveal = t0 + fall / v + Math.random() * 0.04;
      const key = `${Math.floor(x / BAND)}:${Math.round(y)}`;
      if (!landed.has(key)) {
        landed.add(key);
        drops.push(drop(x, y - fall, t0, y, v, 5 + Math.floor(Math.random() * 4)));
      }
      t.chars.set(f.index, state(f, reveal, reveal + 0.12 + Math.random() * 0.22));
    }
  }

  const state = (f: Fresh, reveal: number, settle: number): CharState =>
    ({ ch: f.ch, reveal, settle, glyph: randomGlyph(), next: 0, fade: f.fade });
  /** The green fades into the message's body colour (transcript.css), so
   *  only characters in that colour fade; code, links and the like decode
   *  straight into their own colour. */
  function plainColour(range: Range): boolean {
    const parent = range.startContainer.parentElement;
    const root = parent?.closest<HTMLElement>(`${ROOTS.user}, ${ROOTS.assistant}`);
    return !!parent && !!root && getComputedStyle(parent).color === getComputedStyle(root).color;
  }
  const drop = (x: number, y0: number, start: number, stopY: number, v: number, len: number): Drop =>
    ({ x, y0, start, stopY, v, len, glyphs: Array.from({ length: len }, randomGlyph) });

  // ---- Tracking messages that arrive live ----
  function track(el: HTMLElement) {
    const role = el.classList.contains("user") ? "user" : el.classList.contains("assistant") ? "assistant" : null;
    if (!role || trackers.some((t) => t.el === el)) return;
    // A row re-keyed by the server (the sent turn's local id replaced by
    // its real one) mounts again with the same text: keep its timing.
    const text = el.querySelector(ROOTS.user)?.textContent ?? "";
    const lost = role === "user"
      ? trackers.find((t) => t.lostAt !== null && t.role === "user" && textOf({ ...t, el }) === text)
      : undefined;
    if (lost) {
      lost.el = el;
      lost.lostAt = null;
      observe(lost);
      return;
    }
    const t: Tracker = { el, role, seen: 0, chars: new Map(), observer: null, dirty: true, lostAt: null };
    trackers.push(t);
    // Older replies stop decoding after a while; keep the work bounded.
    while (trackers.length > 4) dispose(trackers.shift()!);
    observe(t);
    wake();
  }
  function observe(t: Tracker) {
    t.observer?.disconnect();
    t.observer = new MutationObserver(() => { t.dirty = true; wake(); });
    t.observer.observe(t.el, { childList: true, subtree: true, characterData: true });
  }
  function dispose(t: Tracker) {
    t.observer?.disconnect();
    t.chars.clear();
  }
  const rows = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const row = node.matches("[data-appear]") ? node : node.querySelector<HTMLElement>("[data-appear]");
        if (!row) continue;
        for (const message of row.querySelectorAll<HTMLElement>(".message.user, .message.assistant")) {
          if (!message.parentElement?.closest(".message")) track(message);
        }
      }
    }
  });
  rows.observe(mount, { childList: true, subtree: true });

  // ---- Drawing ----
  function wake() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function frame() {
    const t = now();
    for (const tr of trackers) {
      if (!tr.el.isConnected) { if (tr.lostAt === null) tr.lostAt = t; continue; }
      if (tr.dirty) schedule(tr);
    }
    for (let i = trackers.length - 1; i >= 0; i--) {
      const tr = trackers[i];
      if (tr.lostAt !== null && t - tr.lostAt > 1) { dispose(tr); trackers.splice(i, 1); }
    }
    const busy = paint(t);
    if (busy) raf = requestAnimationFrame(frame);
    else { running = false; clear(); }
  }
  function clear() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    hidden.clear();
    fades.forEach((h) => h.clear());
  }

  function paint(t: number): boolean {
    const el = area();
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.style.left = `${box.left}px`;
    canvas.style.top = `${box.top}px`;
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, w, h);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Never draw over the composer floating at the bottom of the chat.
    const composer = document.getElementById("composer-mount")?.firstElementChild?.getBoundingClientRect();
    const floor = composer && composer.top < box.bottom && composer.bottom > box.top ? composer.top - box.top : box.height;
    ctx!.save();
    ctx!.beginPath();
    ctx!.rect(0, 0, box.width, floor);
    ctx!.clip();
    const pal = codeRainPalette();
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";

    hidden.clear();
    fades.forEach((hl) => hl.clear());
    let busy = drops.length > 0;

    // Characters: hidden until reached, code while decoding, then green.
    for (const tr of trackers) {
      if (!tr.chars.size || tr.lostAt !== null) continue;
      busy = true;
      const locate = locator(tr);
      for (const [index, c] of tr.chars) {
        if (t >= c.settle + c.fade) { tr.chars.delete(index); continue; }
        const range = locate(index, c.ch.length);
        if (!range) { tr.chars.delete(index); continue; }
        if (t >= c.settle) {
          fades[Math.min(FADE_STEPS - 1, Math.floor(((t - c.settle) / FADE) * FADE_STEPS))].add(range);
          continue;
        }
        hidden.add(range);
        if (t < c.reveal) continue;
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (t >= c.next) { c.glyph = randomGlyph(); c.next = t + 0.05 + Math.random() * 0.05; }
        const hot = t - c.reveal < 0.08;
        ctx!.font = `600 ${Math.max(11, Math.round(rect.height * 0.72))}px ${CODE_RAIN_FONT}`;
        ctx!.fillStyle = hot ? pal.head : pal.tail;
        ctx!.globalAlpha = 1;
        ctx!.shadowColor = pal.tail;
        ctx!.shadowBlur = pal.dark ? (hot ? 10 : 5) : 0;
        drawMirrored(ctx!, c.glyph, rect.left + rect.width / 2 - box.left, rect.top + rect.height / 2 - box.top);
      }
    }

    // Drops: a bright head and a fading tail that keep falling and sink
    // into the text, so nothing ever rises back up.
    ctx!.font = `600 15px ${CODE_RAIN_FONT}`;
    drops = drops.filter((d) => {
      const head = d.y0 + (t - d.start) * d.v;
      if (head < d.y0) return true;
      if (head - (d.len - 1) * STEP > d.stopY) return false;
      for (let k = 0; k < d.len; k++) {
        const y = head - k * STEP;
        if (y < d.y0) break;
        if (y > d.stopY) continue;
        // Streams fade in where they start instead of popping into view.
        const enter = Math.min(1, 0.25 + (y - d.y0) / (3 * STEP));
        if (k === 0) {
          ctx!.fillStyle = pal.head;
          ctx!.globalAlpha = enter;
          ctx!.shadowColor = pal.tail;
          ctx!.shadowBlur = pal.dark ? 10 : 0;
        } else {
          ctx!.fillStyle = pal.tail;
          ctx!.globalAlpha = enter * Math.max(0.05, 1 - k / d.len) * (pal.dark ? 0.9 : 0.75);
          ctx!.shadowBlur = 0;
        }
        if (Math.random() < 0.03) d.glyphs[k] = randomGlyph();
        drawMirrored(ctx!, d.glyphs[k], d.x, y);
      }
      return true;
    });
    ctx!.restore();
    ctx!.globalAlpha = 1;
    ctx!.shadowBlur = 0;
    return busy;
  }

  return () => {
    cancelAnimationFrame(raf);
    rows.disconnect();
    trackers.forEach(dispose);
    CSS.highlights.delete("code-rain-hidden");
    fades.forEach((_, i) => CSS.highlights.delete(`code-rain-fade-${i}`));
    canvas.remove();
  };
}
