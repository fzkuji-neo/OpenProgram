"use client";

import { useEffect, useRef } from "react";

/** Highest-effort decoration. Canvas stays full-width while the selected range moves. */
export function EffortField({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const refreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    activeRef.current = active;
    refreshRef.current?.();
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    let frame = 0, last = 0, envelope = 0, nextPulse = 0;
    let width = 0, height = 0, accent = "#a895e9";
    let pulses: { time: number; x: number; y: number; seed: number }[] = [];
    const hash = (n: number) => { const x = Math.sin(n * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };
    const smooth = (x: number) => x * x * (3 - 2 * x);
    const reduced = () => motion.matches || document.documentElement.dataset.reduceMotion === "true";

    function clear() { ctx!.clearRect(0, 0, width, height); }
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      accent = getComputedStyle(canvas!).color;
    }
    function draw(now: number) {
      frame = 0;
      if (document.hidden) return;
      const still = reduced();
      const dt = last ? Math.min(now - last, 64) : 16;
      last = now;
      envelope = still ? Number(activeRef.current) : Math.max(0, Math.min(1, envelope + dt / (activeRef.current ? 700 : -850)));
      clear();
      if (envelope === 0) { pulses = []; nextPulse = 0; last = 0; return; }
      if (!width || !height) return;
      const t = now / 1000;
      const pitch = height / Math.max(1, Math.round(height / 4));
      const cols = Math.ceil(width / pitch), rows = Math.round(height / pitch);
      if (!still && activeRef.current && t >= nextPulse) {
        pulses.push({ time: t, x: cols * (.94 + Math.random() * .04), y: rows * (.35 + Math.random() * .3), seed: Math.random() * 10000 });
        pulses = pulses.filter(p => t - p.time < 5).slice(-8);
        nextPulse = t + .3 + Math.random() * .45;
      }
      const alpha = smooth(envelope);
      ctx!.fillStyle = accent;
      for (let x = 0; x < cols; x++) {
        const mask = smooth(Math.min(1, (x / cols) / .6));
        for (let y = 0; y < rows; y++) {
          const seed = x * 17 + y * 43;
          let energy = still ? .25 + hash(seed) * .55 : 0;
          for (const pulse of pulses) {
            const random = hash(seed + pulse.seed);
            if (random < .2) continue;
            const distance = Math.abs(x - pulse.x) + Math.abs(y - pulse.y);
            const age = t - pulse.time - distance / 34 - random * .1;
            if (age < 0) continue;
            energy = Math.max(energy, (1.2 * Math.exp(-age * 5) + .65 * Math.exp(-age * .8)) * (1 - Math.min(1, distance / 60)) * (.35 + random * .65));
          }
          const level = Math.min(5, Math.floor(energy * 6));
          const variation = still ? 1 : .86 + .14 * Math.sin(t * 2 * Math.PI / (2.4 + hash(seed) * 1.4) + seed);
          ctx!.globalAlpha = alpha * mask * (.035 + level / 5 * .72) * variation;
          const size = Math.max(1, pitch - 1);
          ctx!.beginPath();
          ctx!.roundRect(x * pitch + .5, y * pitch + .5, size, size, .9);
          ctx!.fill();
        }
      }
      ctx!.globalAlpha = 1;
      if (!still) frame = requestAnimationFrame(draw);
    }
    function refresh() {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (document.hidden) return;
      resize();
      frame = requestAnimationFrame(draw);
    }
    refreshRef.current = refresh;
    const observer = new ResizeObserver(refresh);
    observer.observe(canvas);
    const theme = new MutationObserver(refresh);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-mode", "data-reduce-motion", "style"] });
    motion.addEventListener("change", refresh);
    scheme.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      refreshRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect(); theme.disconnect();
      motion.removeEventListener("change", refresh);
      scheme.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return <span className="effort-field" data-active={active ? "true" : undefined} aria-hidden="true"><canvas ref={canvasRef} /></span>;
}
