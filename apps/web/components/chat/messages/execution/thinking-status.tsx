"use client";

/**
 * The "thinking…" status shown while a reply has not started: the spinner
 * and a grey label. With the code rain style on it is the same "Thinking… ›"
 * row a running tool group shows (execution-strip.tsx), its label decoding
 * from code (components/chat/welcome/code-rain-style.tsx); it has nothing to
 * open yet, so it is not a button.
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
        <span className="tl-chev" aria-hidden="true">›</span>
      </span>
    );
  }
  return <><ActivityIndicator /><span className="pending-label">{text("thinking…", "思考中…")}</span></>;
}
