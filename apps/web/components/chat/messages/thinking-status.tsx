"use client";

/**
 * The "thinking…" status shown while a reply has not started. With the code
 * rain on (Settings → General → Welcome animation) it turns into code: the
 * spinner becomes a few columns of falling glyphs and the label decodes
 * from glyphs into its letters, then keeps flickering back into code now
 * and then, the way text scrambles in The Matrix. Otherwise it is the
 * usual spinner and grey label.
 */
import { useEffect, useRef } from "react";

import { useTranslation } from "@/lib/i18n";
import { CODE_RAIN_FONT, codeRainPalette, drawMirrored, randomGlyph } from "@/lib/chat/code-rain";
import { useWelcomeBackdropPref } from "@/lib/prefs/welcome-backdrop-pref";
import { ActivityIndicator } from "./activity-indicator";

export function ThinkingStatus() {
  const { text } = useTranslation();
  const { enabled } = useWelcomeBackdropPref();
  const label = text("thinking…", "思考中…");
  if (!enabled) {
    return <><ActivityIndicator /><span className="pending-label">{label}</span></>;
  }
  return <><CodeRainIcon /><CodeRainLabel label={label} /></>;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Three columns of falling glyphs in the spinner's 18px square. */
function CodeRainIcon() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const SIZE = 18, STEP = 6, TAIL = 4;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const columns = [3, 9, 15].map((x) => ({
      x, head: Math.random() * SIZE, v: 30 + Math.random() * 30,
      glyphs: Array.from({ length: TAIL }, randomGlyph),
    }));
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pal = codeRainPalette();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.font = `700 7px ${CODE_RAIN_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const c of columns) {
        c.head += c.v * dt;
        if (c.head - TAIL * STEP > SIZE) { c.head = -Math.random() * 6; c.v = 30 + Math.random() * 30; }
        for (let k = 0; k < TAIL; k++) {
          const y = Math.floor(c.head / STEP) * STEP - k * STEP + STEP / 2;
          if (y < -STEP || y > SIZE + STEP) continue;
          if (Math.random() < 0.04) c.glyphs[k] = randomGlyph();
          ctx.globalAlpha = k === 0 ? 1 : 1 - k / TAIL;
          ctx.fillStyle = k === 0 ? pal.head : pal.tail;
          drawMirrored(ctx, c.glyphs[k], c.x, y);
        }
      }
      ctx.globalAlpha = 1;
      if (!reducedMotion()) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="activity-indicator code-rain-thinking-icon" aria-hidden="true">
      <canvas ref={ref} width={18} height={18} />
    </span>
  );
}

/** The label decodes left to right, then a letter now and then flickers
 *  back into a glyph. The real text stays for screen readers. */
function CodeRainLabel({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const chars = Array.from(label);
  useEffect(() => {
    const host = ref.current;
    if (!host || reducedMotion()) return;
    const cells = Array.from(host.querySelectorAll<HTMLElement>("[data-ch]"));
    const start = performance.now();
    // When each cell decodes, and until when a later flicker lasts.
    const decodeAt = cells.map((_, i) => 120 + i * 70 + Math.random() * 80);
    const flickerUntil = cells.map(() => 0);
    const timer = window.setInterval(() => {
      const t = performance.now() - start;
      cells.forEach((cell, i) => {
        const real = cell.dataset.ch!;
        if (!real.trim()) return;
        if (t < decodeAt[i]) { cell.textContent = randomGlyph(); cell.dataset.state = "code"; return; }
        if (t < decodeAt[i] + 140) { cell.textContent = real; cell.dataset.state = "head"; return; }
        if (t < flickerUntil[i]) { cell.textContent = randomGlyph(); cell.dataset.state = "code"; return; }
        if (Math.random() < 0.015) flickerUntil[i] = t + 90 + Math.random() * 120;
        cell.textContent = real;
        cell.dataset.state = "";
      });
    }, 55);
    return () => window.clearInterval(timer);
  }, [label]);
  return (
    <span className="pending-label code-rain-thinking-label">
      <span className="sr-only">{label}</span>
      <span ref={ref} aria-hidden="true">
        {chars.map((ch, i) => (
          // Wide characters keep a 1em cell so a glyph in their place
          // does not shift the rest of the label.
          <span key={i} data-ch={ch} className={ch.charCodeAt(0) > 0x2e7f ? "wide" : undefined}>{ch}</span>
        ))}
      </span>
    </span>
  );
}
