"use client";

/**
 * The "thinking…" status shown while a reply has not started: the spinner
 * and a grey label. With the code rain style on it is the green "Thinking…"
 * of a running tool group's row (execution-strip.tsx), raining in like a
 * new message (components/chat/welcome/code-rain-style.tsx). It has nothing
 * to open yet, so it is no button and has no ›; the row that can open
 * comes with the reply's first thinking or tool call.
 */
import { useTranslation } from "@/lib/i18n";
import { CodeRainText, useCodeRainStyle } from "../../welcome/code-rain-style";
import { ActivityIndicator } from "./activity-indicator";

export function ThinkingStatus() {
  const { text } = useTranslation();
  const codeRain = useCodeRainStyle();
  if (codeRain) {
    return (
      <span className="tl-toggle is-static">
        <CodeRainText className="tl-label" text={text("Thinking…", "思考中…")} />
      </span>
    );
  }
  return <><ActivityIndicator /><span className="pending-label">{text("thinking…", "思考中…")}</span></>;
}
