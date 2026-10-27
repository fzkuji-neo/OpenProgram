"use client";

/**
 * The "thinking…" status shown while a reply has not started: the spinner
 * and a grey label, or, with the code rain style on, falling glyphs and a
 * label that decodes from code (components/chat/code-rain-style.tsx).
 */
import { useTranslation } from "@/lib/i18n";
import { CodeRainIcon, CodeRainText, useCodeRainStyle } from "../code-rain-style";
import { ActivityIndicator } from "./activity-indicator";

export function ThinkingStatus() {
  const { text } = useTranslation();
  const codeRain = useCodeRainStyle();
  const label = text("thinking…", "思考中…");
  if (!codeRain) {
    return <><ActivityIndicator /><span className="pending-label">{label}</span></>;
  }
  return <><CodeRainIcon size={18} /><CodeRainText className="pending-label" text={label} /></>;
}
