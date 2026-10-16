/**
 * WelcomeBackdrop — the code rain behind the empty chat.
 *
 * Shown only when the "Welcome animation" setting is on (off by default,
 * see welcome-backdrop-pref.ts). Reduced-motion draws a single still frame.
 */
"use client";

import { useEffect, useRef } from "react";

import { useWelcomeBackdropPref } from "@/lib/prefs/welcome-backdrop-pref";

import styles from "./welcome-screen.module.css";

type Palette = { ink: string };
type Scene = {
  init(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, t: number, width: number, height: number, pal: Palette): void;
};

/** Code rain after The Matrix: a fixed grid of glyphs (katakana, Latin
 *  capitals, digits, symbols; some mirrored) that drops of light run down,
 *  a glowing head with a green tail. Green regardless of the app theme. */
function codeRain(): Scene {
  const GLYPHS =
    "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.=*+-<>|\"_";
  const CELL = 20;
  type Cell = { ch: string; flip: boolean };
  type Drop = { col: number; y: number; speed: number; len: number };
  let grid: Cell[][] = [];
  let drops: Drop[] = [];
  let rows = 0;
  let last = 0;
  const cell = (): Cell => ({
    ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    flip: Math.random() < 0.3,
  });
  const spawn = (col: number, scatter: boolean): Drop => {
    const len = 10 + Math.floor(Math.random() * 22);
    return {
      col,
      // 首帧把雨点散在整屏，之后从顶端上方落下。
      y: scatter ? Math.random() * (rows + len) : -Math.random() * rows * 0.6,
      speed: 7 + Math.random() * 12,
      len,
    };
  };
  return {
    init(w, h) {
      last = 0;
      const cols = Math.ceil(w / CELL);
      rows = Math.ceil(h / CELL);
      grid = Array.from({ length: cols }, () => Array.from({ length: rows }, cell));
      // 约三分之一的列同时有两滴，疏密不一。
      drops = Array.from({ length: Math.round(cols * 1.35) }, (_, i) => spawn(i % cols, true));
    },
    draw(ctx, t, _w, _h, pal) {
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      const dark = !isDark(pal.ink); // 深色主题：正文墨色是浅的。
      const tail = dark ? "#22e35b" : "#118a3a";
      const head = dark ? "#eafff0" : "#063d18";
      ctx.font = `600 ${CELL - 3}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 暗处的字也会偶尔自己变。
      for (let n = 0; n < grid.length * dt * 6; n++) {
        const c = grid[Math.floor(Math.random() * grid.length)];
        c[Math.floor(Math.random() * rows)] = cell();
      }
      for (const d of drops) {
        d.y += d.speed * dt;
        if (d.y - d.len > rows) Object.assign(d, spawn(d.col, false));
        const top = Math.floor(d.y);
        const x = d.col * CELL + CELL / 2;
        for (let k = 0; k < d.len; k++) {
          const row = top - k;
          if (row < 0 || row >= rows) continue;
          // 被照亮的字不停地变：雨头几乎每帧换一个，拖尾每秒两三次。
          if (Math.random() < dt * (k === 0 ? 18 : 2.5)) grid[d.col][row] = cell();
          const g = grid[d.col][row];
          const y = row * CELL + CELL / 2;
          if (k === 0) {
            ctx.fillStyle = head;
            ctx.globalAlpha = 1;
            ctx.shadowColor = dark ? tail : "transparent";
            ctx.shadowBlur = dark ? 10 : 0;
          } else {
            ctx.fillStyle = tail;
            ctx.globalAlpha = Math.max(0.08, 1 - k / d.len) * (dark ? 0.9 : 0.75);
            ctx.shadowBlur = 0;
          }
          if (g.flip) {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(-1, 1);
            ctx.fillText(g.ch, 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(g.ch, x, y);
          }
        }
      }
      ctx.shadowBlur = 0;
    },
  };
}

/** True when a CSS color (hex or rgb()) is dark, i.e. the theme is light. */
function isDark(color: string): boolean {
  let r = 0, g = 0, b = 0;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    [r, g, b] = [0, 2, 4].map((o) => Number.parseInt(v.slice(o, o + 2), 16));
  } else {
    const m = color.match(/\d+(\.\d+)?/g);
    if (m) [r, g, b] = m.map(Number);
  }
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  return {
    ink: css.getPropertyValue("--text-primary").trim() || "#444",
  };
}

export function WelcomeBackdrop() {
  const { enabled } = useWelcomeBackdropPref();
  return enabled ? <CodeRainCanvas /> : null;
}

function CodeRainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const scene = codeRain();
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
