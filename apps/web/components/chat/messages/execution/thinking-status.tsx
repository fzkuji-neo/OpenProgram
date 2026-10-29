"use client";

/**
 * The "thinking…" status shown while a reply has not started: the spinner
 * and a grey label. With the code rain style on, the same spinner sits next
 * to a label that decodes from code (components/chat/welcome/code-rain-style.tsx).
 */
import { useTranslation } from "@/lib/i18n";
import { CodeRainText, useCodeRainStyle } from "../../welcome/code-rain-style";
import { ActivityIndicator } from "./activity-indicator";

export function ThinkingStatus() {
  const { text } = useTranslation();
  const codeRain = useCodeRainStyle();
  const label = text("thinking…", "思考中…");
  return (
    <>
      <ActivityIndicator />
      {codeRain ? <CodeRainText className="pending-label" text={label} /> : <span className="pending-label">{label}</span>}
    </>
  );
}
