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

type Palette = { dark: boolean };
type Scene = {
  init(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, t: number, width: number, height: number, pal: Palette): void;
};

/** Code rain after The Matrix: a fixed grid of mirrored glyphs (katakana,
 *  Latin capitals, digits, symbols) that drops of light run down, a
 *  glowing head with a long green tail. A visible glyph changes at random,
 *  but never again within MIN_GAP seconds of its last change; after that it
 *  rolls once per frame (however many drops light it) so that, gap
 *  included, it changes about every MEAN_GAP seconds. Always green. */
function codeRain(): Scene {
  const GLYPHS =
    "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.=*+-<>|\"_";
  const CELL = 20;
  const MEAN_GAP = 10;
  const MIN_GAP = 4;
  const RATE_AFTER_GAP = 1 / (MEAN_GAP - MIN_GAP);
  // rolled: the last frame this glyph was rolled, so two drops over one
  // cell don't roll it twice. changed: when it last changed.
  type Cell = { ch: string; rolled: number; changed: number };
  type Drop = { col: number; y: number; speed: number; len: number };
  let grid: Cell[][] = [];
  let drops: Drop[] = [];
  let rows = 0;
  let last = 0;
  let frame = 0;
  const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  const cell = (): Cell => ({ ch: glyph(), rolled: -1, changed: -Infinity });
  const spawn = (col: number, scatter: boolean): Drop => {
    const len = 18 + Math.floor(Math.random() * 30);
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
      frame++;
      const dark = pal.dark;
      const tail = dark ? "#22e35b" : "#118a3a";
      const head = dark ? "#eafff0" : "#063d18";
      ctx.font = `600 ${CELL - 3}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const d of drops) {
        d.y += d.speed * dt;
        if (d.y - d.len > rows) Object.assign(d, spawn(d.col, false));
        const top = Math.floor(d.y);
        const x = d.col * CELL + CELL / 2;
        for (let k = 0; k < d.len; k++) {
          const row = top - k;
          if (row < 0 || row >= rows) continue;
          const g = grid[d.col][row];
          // 看得见的字每帧掷一次；刚变过的字歇满 MIN_GAP 秒才参与。
          if (g.rolled !== frame) {
            g.rolled = frame;
            if (t - g.changed >= MIN_GAP && Math.random() < dt * RATE_AFTER_GAP) {
              g.ch = glyph();
              g.changed = t;
            }
          }
          const y = row * CELL + CELL / 2;
          if (k === 0) {
            ctx.fillStyle = head;
            ctx.globalAlpha = 1;
            ctx.shadowColor = dark ? tail : "transparent";
            ctx.shadowBlur = dark ? 10 : 0;
          } else {
            ctx.fillStyle = tail;
            // 拖尾前六成保持明亮，最后四成才淡出。
            const fade = Math.min(1, (1 - k / d.len) / 0.4);
            ctx.globalAlpha = Math.max(0.06, fade) * (dark ? 0.92 : 0.78);
            ctx.shadowBlur = 0;
          }
          // 所有字都镜像。
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(-1, 1);
          ctx.fillText(g.ch, 0, 0);
          ctx.restore();
        }
      }
      ctx.shadowBlur = 0;
    },
  };
}

/** The resolved light/dark mode the theme bootstrap writes on <html>.
 *  Reading the ink colour instead broke on oklch() tokens (Vivid), which
 *  drew the dark-mode rain on a light page. */
function readPalette(): Palette {
  return { dark: document.documentElement.dataset.themeMode === "dark" };
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
    let palette = readPalette();

    const render = (now: number) => {
      // 主题切换后每秒重读一次 token，不必订阅主题事件。
      if (frame++ % 60 === 0) palette = readPalette();
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
