/**
 * Welcome animation preference: whether the empty chat shows the code
 * rain backdrop. Off by default; saved on this device (localStorage) and
 * broadcast to every mounted reader, including other windows.
 */
"use client";

import { useEffect, useState } from "react";

export const WELCOME_BACKDROP_STORAGE_KEY = "openprogram.welcome.codeRain";

let current = false;
const subscribers = new Set<(value: boolean) => void>();

function read(): boolean {
  try { return window.localStorage.getItem(WELCOME_BACKDROP_STORAGE_KEY) === "on"; }
  catch { return false; }
}

function update(value: boolean, persist: boolean): void {
  current = value;
  if (persist) {
    try { window.localStorage.setItem(WELCOME_BACKDROP_STORAGE_KEY, value ? "on" : "off"); }
    catch { /* The current document still updates if storage is unavailable. */ }
  }
  subscribers.forEach((subscriber) => subscriber(value));
}

export function useWelcomeBackdropPref() {
  const [enabled, setEnabled] = useState(current);
  useEffect(() => {
    subscribers.add(setEnabled);
    update(read(), false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === WELCOME_BACKDROP_STORAGE_KEY || event.key === null) update(read(), false);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      subscribers.delete(setEnabled);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return { enabled, setEnabled: (value: boolean) => update(value, true) };
}
