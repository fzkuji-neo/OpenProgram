/**
 * WelcomeScreen — the empty chat.
 *
 * No mark, tagline or starter buttons: the composer floats over an empty
 * area, or over the code rain when the "Code rain style" setting is on.
 * Visible whenever the session store says so; mounted as a portal inside
 * the #welcome-mount placeholder that PageShell leaves in the chat area.
 * When the chat gets its first message the rain is kept a moment longer
 * so it can stop and fade instead of vanishing.
 */
"use client";

import { useEffect, useState } from "react";

import { useSessionStore } from "@/lib/session-store";

import { WelcomeBackdrop } from "./welcome-backdrop";
import styles from "./welcome-screen.module.css";

const STOP_MS = 1200;

export function WelcomeScreen() {
  const visible = useSessionStore((s) => s.welcomeVisible);
  const [stopping, setStopping] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    setStopping(!visible);
  }
  useEffect(() => {
    if (!stopping) return;
    const timer = setTimeout(() => setStopping(false), STOP_MS);
    return () => clearTimeout(timer);
  }, [stopping]);

  // The canvas is absolutely placed in .chat-area, so without the
  // flex-filling .welcome wrapper it takes no room from the messages.
  if (!visible) return stopping ? <WelcomeBackdrop stopping /> : null;

  return (
    <div className={styles.welcome}>
      <WelcomeBackdrop />
    </div>
  );
}
