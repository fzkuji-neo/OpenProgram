"use client";

import { useSyncExternalStore } from "react";

import type { ResolvedThemeMode } from "./theme-config";

/**
 * The light/dark mode currently applied to <html data-theme-mode>
 * (written by theme-bootstrap). Anything not explicitly light is dark —
 * the :root defaults are the dark palette, matching the Tailwind
 * `dark:` variant in app/globals.css.
 */
function read(): ResolvedThemeMode {
  return document.documentElement.getAttribute("data-theme-mode") === "light"
    ? "light"
    : "dark";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-mode"],
  });
  return () => observer.disconnect();
}

export function useResolvedThemeMode(): ResolvedThemeMode {
  return useSyncExternalStore(subscribe, read, () => "dark");
}

/**
 * Button variant for the composer's bottom control row: shadcn
 * `secondary` (grey pill) reads clearly on dark themes but goes muddy on
 * the light off-white surfaces, where the `outline` pill is the crisp
 * one. Both are official variants — only the choice follows the mode.
 */
export function useControlRowVariant(): "outline" | "secondary" {
  return useResolvedThemeMode() === "light" ? "outline" : "secondary";
}
