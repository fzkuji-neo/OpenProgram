/**
 * Code rain style preference (Settings → General → Code rain style):
 * whether the chat uses the Matrix look, and how dense the empty chat's
 * rain is. Off by default; saved on this
 * device (localStorage) and broadcast to every mounted reader, including
 * other windows.
 */
"use client";

import { useEffect, useState } from "react";

export const WELCOME_BACKDROP_STORAGE_KEY = "openprogram.welcome.codeRain";
export const WELCOME_BACKDROP_DENSITY_KEY = "openprogram.welcome.codeRainDensity";

/** Density in percent: 100 puts about 1.35 drops on every column. */
export const CODE_RAIN_DENSITY = { min: 10, max: 100, default: 40 } as const;

type State = { enabled: boolean; density: number };

let current: State = { enabled: false, density: CODE_RAIN_DENSITY.default };
const subscribers = new Set<(value: State) => void>();

function clampDensity(value: number): number {
  if (!Number.isFinite(value)) return CODE_RAIN_DENSITY.default;
  return Math.min(CODE_RAIN_DENSITY.max, Math.max(CODE_RAIN_DENSITY.min, Math.round(value)));
}

function read(): State {
  try {
    const stored = window.localStorage.getItem(WELCOME_BACKDROP_DENSITY_KEY);
    return {
      enabled: window.localStorage.getItem(WELCOME_BACKDROP_STORAGE_KEY) === "on",
      density: stored === null ? CODE_RAIN_DENSITY.default : clampDensity(Number(stored)),
    };
  } catch {
    return { enabled: false, density: CODE_RAIN_DENSITY.default };
  }
}

function update(next: State, persist: boolean): void {
  current = next;
  // The code rain style's CSS keys off this (code-rain-style.css).
  document.documentElement.dataset.codeRain = next.enabled ? "on" : "off";
  if (persist) {
    try {
      window.localStorage.setItem(WELCOME_BACKDROP_STORAGE_KEY, next.enabled ? "on" : "off");
      window.localStorage.setItem(WELCOME_BACKDROP_DENSITY_KEY, String(next.density));
    } catch { /* The current document still updates if storage is unavailable. */ }
  }
  subscribers.forEach((subscriber) => subscriber(next));
}

export function useWelcomeBackdropPref() {
  const [state, setState] = useState(current);
  useEffect(() => {
    subscribers.add(setState);
    update(read(), false);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === WELCOME_BACKDROP_STORAGE_KEY
        || event.key === WELCOME_BACKDROP_DENSITY_KEY
        || event.key === null
      ) update(read(), false);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      subscribers.delete(setState);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return {
    enabled: state.enabled,
    density: state.density,
    setEnabled: (enabled: boolean) => update({ ...current, enabled }, true),
    setDensity: (density: number) => update({ ...current, density: clampDensity(density) }, true),
  };
}
