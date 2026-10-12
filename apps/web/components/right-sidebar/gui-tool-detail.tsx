"use client";

import { useState } from "react";
import type { DetailNode } from "@/lib/session-store";
import { useTranslation } from "@/lib/i18n";
import { AttachmentPreview } from "../chat/messages/attachment-preview";
import { guiCapabilityLabel, guiStatusLabel, guiToolView } from "../chat/messages/gui-tool-view";
import styles from "./gui-tool-detail.module.css";

export function GuiToolDetail({ node }: { node: DetailNode }) {
  const { text } = useTranslation();
  const [preview, setPreview] = useState<{ path: string; sessionId: string }>();
  const view = guiToolView(node);
  if (!view) return null;
  return <section className={styles.activity} aria-label={text("GUI activity", "GUI 操作记录")}>
    <div className={styles.heading}>
      <strong>{guiCapabilityLabel(node.name, text)}</strong>
      <span data-gui-status={view.status}>{guiStatusLabel(view.status, text)}</span>
    </div>
    {typeof node.params?.task === "string" && <p>{node.params.task}</p>}
    {view.summary && <p>{view.summary}</p>}
    {(view.blocker || view.handoff) && <div className={styles.handoff}>
      {view.blocker && <p>{view.blocker}</p>}
      {view.handoff && <p><strong>{text("User action", "用户操作")}: </strong>{view.handoff}</p>}
    </div>}
    {!view.steps.length && <p>{text("No recorded steps yet.", "暂无已记录步骤。")}</p>}
    <ol className={styles.steps}>{view.steps.map((step, i) => <li key={i}>
      <details>
        <summary>
          <span>{guiCapabilityLabel(step.capability, text)}{step.target ? ` · ${step.target}` : ""}</span>
          <small data-gui-status={step.status}>{guiStatusLabel(step.status, text)}</small>
        </summary>
        {step.action && <p className={styles.action}>{step.action}</p>}
        {step.summary && <p>{step.summary}</p>}
        {step.blocker && <p>{step.blocker}</p>}
        {step.handoff && <p>{step.handoff}</p>}
        {step.screenshot && node.session_id ? <>
          <button type="button" className={styles.preview} onClick={() => setPreview({ path: step.screenshot!, sessionId: node.session_id! })}>
            {text("Open recorded screenshot", "打开记录截图")}
          </button>
          <small>{text("Observation from this step, not a live view or post-action verification.", "本步骤的观察记录，不是实时画面或动作后的验证。")}</small>
        </> : <small>{text("No recorded screenshot available.", "无可用的记录截图。")}</small>}
      </details>
    </li>)}</ol>
    {preview && <AttachmentPreview path={preview.path} sessionId={preview.sessionId}
      filename={preview.path.split(/[\\/]/).pop() || text("Recorded screenshot", "记录截图")}
      onClose={() => setPreview(undefined)} />}
  </section>;
}
