/**
 * WelcomeScreen — the empty chat.
 *
 * No mark, tagline or starter buttons: only an animated backdrop that
 * rotates between scenes per load, with the composer floating over it.
 * Visible whenever the session store says so; mounted as a portal inside
 * the #welcome-mount placeholder that PageShell leaves in the chat area.
 */
"use client";

import { useSessionStore } from "@/lib/session-store";

import { WelcomeBackdrop } from "./welcome-backdrop";
import styles from "./welcome-screen.module.css";

export function WelcomeScreen() {
  const visible = useSessionStore((s) => s.welcomeVisible);

  if (!visible) return null;

  return (
    <div className={styles.welcome}>
      <WelcomeBackdrop />
    </div>
  );
}
