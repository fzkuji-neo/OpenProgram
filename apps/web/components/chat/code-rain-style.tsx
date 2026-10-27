"use client";

/**
 * The code rain style's in-progress pieces (styles in code-rain-style.css):
 * with the style on, anything still running is shown as code. A spinner
 * becomes a few columns of falling glyphs (CodeRainIcon), and a status
 * label becomes a green monospace line that decodes from glyphs into its
 * letters, then flickers back into code now and then, the way text
 * scrambles in The Matrix (CodeRainText). Under reduced motion both hold
 * still.
 */
import { useEffect, useRef } from "react";

import { CODE_RAIN_FONT, codeRainPalette, drawMirrored, randomGlyph } from "@/lib/chat/code-rain";
import { useWelcomeBackdropPref } from "@/lib/prefs/welcome-backdrop-pref";

/** Whether the code rain style is on. */
export function useCodeRainStyle(): boolean {
  return useWelcomeBackdropPref().enabled;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Three columns of falling glyphs in a square ``size`` px wide. */
export function CodeRainIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const step = size / 3, tail = 4;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    // Staggered heads, so the square is never empty.
    const columns = [0, 1, 2].map((i) => ({
      x: step * (i + 0.5),
      head: (i * size) / 3 + Math.random() * step,
      v: size * (1.8 + Math.random() * 1.4),
      glyphs: Array.from({ length: tail }, randomGlyph),
    }));
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pal = codeRainPalette();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.font = `700 ${Math.round(step * 1.15)}px ${CODE_RAIN_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const c of columns) {
        c.head += c.v * dt;
        if (c.head - (tail - 1) * step > size) { c.head = 0; c.v = size * (1.8 + Math.random() * 1.4); }
        for (let k = 0; k < tail; k++) {
          const y = Math.floor(c.head / step) * step - k * step + step / 2;
          if (y < 0 || y > size) continue;
          if (Math.random() < 0.04) c.glyphs[k] = randomGlyph();
          ctx.globalAlpha = k === 0 ? 1 : 1 - k / tail;
          ctx.fillStyle = k === 0 ? pal.head : pal.tail;
          drawMirrored(ctx, c.glyphs[k], c.x, y);
        }
      }
      ctx.globalAlpha = 1;
      if (!reducedMotion()) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return (
    <span className={`code-rain-icon ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={ref} />
    </span>
  );
}

/** A label that decodes left to right, then a character now and then
 *  flickers back into a glyph. The real text stays for screen readers. */
export function CodeRainText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || reducedMotion()) return;
    const cells = Array.from(host.querySelectorAll<HTMLElement>("[data-ch]"));
    const start = performance.now();
    // Long labels decode faster, so every label is readable within ~0.8s.
    const gap = Math.min(70, 650 / Math.max(1, cells.length));
    const decodeAt = cells.map((_, i) => 80 + i * gap + Math.random() * 80);
    const flickerUntil = cells.map(() => 0);
    const timer = window.setInterval(() => {
      const t = performance.now() - start;
      cells.forEach((cell, i) => {
        const real = cell.dataset.ch!;
        let shown = real, state = "";
        if (real.trim()) {
          if (t < decodeAt[i] || t < flickerUntil[i]) { shown = randomGlyph(); state = "code"; }
          else if (t < decodeAt[i] + 140) state = "head";
          else if (Math.random() < 0.012) flickerUntil[i] = t + 90 + Math.random() * 120;
        }
        if (cell.textContent !== shown) cell.textContent = shown;
        if ((cell.dataset.state ?? "") !== state) cell.dataset.state = state;
      });
    }, 55);
    return () => window.clearInterval(timer);
  }, [text]);
  return (
    <span className={`code-rain-text ${className}`.trim()}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden="true">
        {Array.from(text).map((ch, i) => (
          // Wide characters keep a 1em cell so a glyph in their place
          // does not shift the rest of the label.
          <span key={`${i}:${ch}`} data-ch={ch} className={ch.charCodeAt(0) > 0x2e7f ? "wide" : undefined}>{ch}</span>
        ))}
      </span>
    </span>
  );
}
