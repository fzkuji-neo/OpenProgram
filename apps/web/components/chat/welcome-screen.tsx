/**
 * WelcomeScreen — empty-chat centered greeting.
 *
 * Uses the same static three-node mark as the app icon, one short
 * capability sentence and a few starter prompts. A prompt only fills the
 * focused session's draft and focuses the composer; it never sends. Visible whenever the session store says so;
 * mounted as a portal inside the #welcome-mount placeholder that PageShell
 * leaves in the chat area.
 */
"use client";

import { CalendarClock, FolderSearch, Globe, SquareTerminal } from "lucide-react";

import { useSessionStore } from "@/lib/session-store";
import { useTranslation } from "@/lib/i18n";

import styles from "./welcome-screen.module.css";

export function WelcomeScreen() {
  const visible = useSessionStore((s) => s.welcomeVisible);
  const { text } = useTranslation();

  if (!visible) return null;

  return (
    <div className={styles.welcome}>
      <div className={styles.top}>
        <img
          className={styles.mark}
          src="/icon.svg"
          width={34}
          height={34}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <div className={styles.tagline}>
          {text(
            "Run functions, build agents, or just ask.",
            "运行函数、搭建 agent，或者直接提问。",
          )}
        </div>
      </div>
      <div className={styles.starters}>
        {STARTERS.map(({ Icon, en, zh }) => (
          <button
            key={en}
            type="button"
            className={styles.starter}
            onClick={() => {
              const store = useSessionStore.getState();
              store.setComposerInputFor(store.activeChatKey, text(en, zh));
              store.focusComposer();
            }}
          >
            <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
            <span>{text(en, zh)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const STARTERS = [
  { Icon: FolderSearch, en: "Summarize what this project does", zh: "总结一下这个项目是做什么的" },
  { Icon: SquareTerminal, en: "Write a Python script and run it", zh: "写一个 Python 脚本并运行" },
  { Icon: Globe, en: "Search the web and brief me on ", zh: "上网搜索并给我一份简报：" },
  { Icon: CalendarClock, en: "Set up a task that runs every morning", zh: "设置一个每天早上运行的任务" },
];
