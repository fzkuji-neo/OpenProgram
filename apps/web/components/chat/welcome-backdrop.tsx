/**
 * WelcomeBackdrop — the animated canvas behind the empty chat.
 *
 * Several scenes take turns like a wallpaper: each page load picks the
 * next one (the rotation index lives in localStorage, best effort), and
 * the scene stays put for that load. Colors come from the theme tokens
 * so light and dark both work; reduced-motion draws a single still frame.
 */
"use client";

import { useEffect, useRef } from "react";

import styles from "./welcome-screen.module.css";

type Palette = { ink: string; accent: string };
type Scene = {
  init(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, t: number, width: number, height: number, pal: Palette): void;
};

const ROTATION_KEY = "openprogram.welcome.backdrop";

/** A call tree: functions fire, a pulse runs down each call, the callee lights up. */
function callGraph(): Scene {
  type Node = { x: number; y: number; px: number; py: number; parent: number; lit: number };
  type Pulse = { to: number; s: number };
  let nodes: Node[] = [];
  let pulses: Pulse[] = [];
  let last = 0;
  return {
    init(w, h) {
      nodes = [];
      pulses = [];
      // 四层调用树，从上方居中的根往下展开。
      const levels = [1, 3, 5, 7];
      const top = h * 0.12;
      const span = h * 0.5;
      let prevStart = 0;
      levels.forEach((count, depth) => {
        const start = nodes.length;
        const prevCount = depth ? levels[depth - 1] : 0;
        for (let i = 0; i < count; i++) {
          const spread = w * Math.min(0.78, 0.2 + depth * 0.2);
          const x = w / 2 + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread);
          const y = top + (span * depth) / (levels.length - 1);
          const parent = depth === 0 ? -1 : prevStart + Math.floor(((i + 0.5) / count) * prevCount);
          nodes.push({ x, y, px: Math.random() * 6.28, py: Math.random() * 6.28, parent, lit: 0 });
        }
        prevStart = start;
      });
    },
    draw(ctx, t, _w, _h, pal) {
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      const pos = nodes.map((n) => ({
        x: n.x + Math.sin(t * 0.35 + n.px) * 6,
        y: n.y + Math.cos(t * 0.3 + n.py) * 5,
      }));
      if (Math.random() < dt * 2.2) {
        const children = nodes.map((n, i) => (n.parent >= 0 ? i : -1)).filter((i) => i >= 0);
        pulses.push({ to: children[Math.floor(Math.random() * children.length)], s: 0 });
      }
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = pal.ink;
      ctx.globalAlpha = 0.34;
      nodes.forEach((n, i) => {
        if (n.parent < 0) return;
        const a = pos[n.parent], b = pos[i];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y);
        ctx.stroke();
      });
      ctx.fillStyle = pal.accent;
      pulses = pulses.filter((p) => {
        p.s += dt * 0.9;
        if (p.s >= 1) {
          nodes[p.to].lit = 1;
          return false;
        }
        const a = pos[nodes[p.to].parent], b = pos[p.to];
        const s = p.s, m = (a.y + b.y) / 2, u = 1 - s;
        const x = u * u * u * a.x + 3 * u * u * s * a.x + 3 * u * s * s * b.x + s * s * s * b.x;
        const y = u * u * u * a.y + 3 * u * u * s * m + 3 * u * s * s * m + s * s * s * b.y;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      nodes.forEach((n, i) => {
        const p = pos[i];
        n.lit = Math.max(0, n.lit - dt * 0.8);
        if (n.lit > 0) {
          ctx.strokeStyle = pal.accent;
          ctx.globalAlpha = n.lit * 0.7;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5 + (1 - n.lit) * 12, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = n.lit > 0.05 ? pal.accent : pal.ink;
        ctx.globalAlpha = 0.55 + n.lit * 0.45;
        ctx.beginPath();
        ctx.arc(p.x, p.y, n.parent < 0 ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  };
}

/** Code rain: columns of glyphs fall, a bright head and a fading tail. */
function codeRain(): Scene {
  const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789{}()<>=;:+*/";
  const CELL = 16;
  type Drop = { y: number; speed: number; len: number; glyphs: string[] };
  let drops: Drop[] = [];
  let last = 0;
  const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  const spawn = (h: number, scatter: boolean): Drop => {
    const len = 8 + Math.floor(Math.random() * 18);
    return {
      // 首帧把雨点散在整屏，之后从顶端上方落下。
      y: scatter ? Math.random() * (h / CELL + len) : -Math.random() * 20,
      speed: 5 + Math.random() * 9,
      len,
      glyphs: Array.from({ length: len }, glyph),
    };
  };
  return {
    init(w, h) {
      last = 0;
      drops = Array.from({ length: Math.ceil(w / CELL) }, () => spawn(h, true));
    },
    draw(ctx, t, _w, h, pal) {
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      ctx.font = `${CELL - 3}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      drops.forEach((d, col) => {
        d.y += d.speed * dt;
        if (d.y - d.len > h / CELL) Object.assign(d, spawn(h, false));
        if (Math.random() < dt * 4) d.glyphs[Math.floor(Math.random() * d.len)] = glyph();
        const head = Math.floor(d.y);
        const x = col * CELL + CELL / 2;
        for (let k = 0; k < d.len; k++) {
          const row = head - k;
          if (row < 0 || row * CELL > h) continue;
          const isHead = k === 0;
          ctx.fillStyle = isHead ? pal.accent : pal.ink;
          ctx.globalAlpha = isHead ? 0.85 : 0.42 * (1 - k / d.len);
          ctx.fillText(d.glyphs[(row % d.len + d.len) % d.len], x, row * CELL);
        }
      });
    },
  };
}

const SCENES = [callGraph, codeRain];

let chosen: number | null = null;
function pickScene(): number {
  if (chosen !== null) return chosen;
  let next = Math.floor(Math.random() * SCENES.length);
  try {
    const prev = Number.parseInt(localStorage.getItem(ROTATION_KEY) ?? "", 10);
    if (Number.isFinite(prev)) next = (prev + 1) % SCENES.length;
    localStorage.setItem(ROTATION_KEY, String(next));
  } catch {
    // Storage unavailable: the random pick still varies between loads.
  }
  chosen = next;
  return next;
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  return {
    ink: css.getPropertyValue("--text-primary").trim() || "#444",
    accent: css.getPropertyValue("--primary").trim() || "#5b6cff",
  };
}

export function WelcomeBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scene = SCENES[pickScene()]();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0, height = 0, frame = 0, raf = 0;
    let palette = readPalette(canvas);

    const render = (now: number) => {
      // 主题切换后每秒重读一次 token，不必订阅主题事件。
      if (frame++ % 60 === 0) palette = readPalette(canvas);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene.draw(ctx, now / 1000, width, height, palette);
      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(render);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      scene.init(width, height);
      if (still) render(4000);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!still) raf = requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.backdrop} aria-hidden="true" />;
}
