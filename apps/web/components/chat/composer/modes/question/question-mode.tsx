"use client";

import { approvalDisplayText, readSandboxEscalation, type SandboxEscalation } from "./approval-display-text";

/** Questions use a current-question panel above the composer.
 * All answers are submitted together through the existing acknowledged wait
 * command. Tool approvals retain their explicit scope and operation controls.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageCircle, X } from "lucide-react";
import { OperationCode } from "./operation-code";
import { Textarea } from "@/components/ui/textarea";

import type { PendingDecision, AskOne, FormFieldSchema } from "@/lib/session-store";
import { useTranslation } from "@/lib/i18n";

import styles from "./question-mode.module.css";
import { useWaitAnswer } from "./use-wait-answer";
import { AnswerSummary } from "./answer-summary";
import { useDecisionDrafts, type DecisionDraft, type DecisionAnswer } from "@/lib/chat/decision-drafts";
import approvalStyles from "../approval/approval-mode.module.css";
import formStyles from "./form-mode.module.css";

/** Wire value meaning "approved" in the approval protocol. Matches the
 *  locale-independent token accepted by ``_approval.await_user_approval``.
 *  Not user-visible — the button labels are translated separately. */
const APPROVE_ANSWER = "approve";

interface QuestionModeProps {
  decision: PendingDecision;
  onResolve: (id: string) => void;
  onChatAbout: (feedback: string) => void | Promise<void>;
}

/** Wire pick for an approval card. ``always_path`` is sandbox-escalation only. */
type ApprovalPick = "once" | "always" | "always_path" | "deny";

/** 一步（一道题）的统一形状。kind 决定 body 怎么渲染、答案怎么收集。 */
type Step =
  | { kind: "choice"; prompt: string; options: string[]; multi: boolean; allowCustom: boolean; optionDescriptions?: Record<string, string> }
  | {
      kind: "approval";
      prompt: string;
      detail?: string;
      risk?: "low" | "medium" | "high";
      escalation?: SandboxEscalation;
      allowedScopes?: string[];
      tool?: string;
      args?: Record<string, unknown>;
    }
  | { kind: "form"; prompt: string; detail?: string; schema: Record<string, FormFieldSchema> };

/** 一步的工作答案。choice → 选中集 + 自由文本；approval → 允许一次/总是允许/拒绝；
 *  form → 字段值对象。 */
type Answer = DecisionAnswer;

/** 把一个 decision 拍平成统一的 steps 数组。单题 → 1 步；ask_many → N 步。 */
function toSteps(q: PendingDecision): Step[] {
  if (q.kind === "form") {
    return [{ kind: "form", prompt: q.prompt, detail: q.detail, schema: q.schema ?? {} }];
  }
  if (q.kind === "approval") {
    return [{
      kind: "approval",
      prompt: q.prompt,
      detail: q.detail,
      risk: q.risk_level,
      escalation: readSandboxEscalation(q.args),
      allowedScopes: q.allowedScopes,
      tool: q.tool,
      args: q.args,
    }];
  }
  if (q.kind === "ask_many") {
    const qs: AskOne[] = q.questions ?? [];
    return qs.map((one) => ({
      kind: "choice",
      prompt: one.question_title ?? one.prompt,
      options: one.options,
      multi: one.multi,
      allowCustom: one.allow_custom,
      optionDescriptions: one.option_descriptions,
    }));
  }
  // ask / confirm —— 单题选择。
  return [{
    kind: "choice",
    prompt: q.prompt,
    options: q.options,
    multi: q.multi,
    allowCustom: q.allow_custom,
  }];
}

function seedField(f: FormFieldSchema): string | number | boolean {
  if (f.default !== undefined) return f.default;
  if (f.type === "boolean") return false;
  if (f.enum && f.enum.length) return f.enum[0];
  return "";
}

function seedAnswer(step: Step): Answer {
  if (step.kind === "choice") return { picked: new Set<string>(), custom: "" };
  if (step.kind === "approval") return { pick: null };
  const fields: Record<string, string | number | boolean> = {};
  for (const name of Object.keys(step.schema)) fields[name] = seedField(step.schema[name]);
  return { fields };
}

function stepAnswered(step: Step, a: Answer): boolean {
  if (step.kind === "choice") {
    const aa = a as { picked: Set<string>; custom: string };
    return aa.picked.size > 0 || aa.custom.trim().length > 0;
  }
  if (step.kind === "approval") return (a as { pick: unknown }).pick !== null;
  return true; // form 字段都有默认/可空，恒算已答
}

export function QuestionMode({ decision: q, onResolve, onChatAbout }: QuestionModeProps) {
  const { text } = useTranslation();
  const [discussionPending, setDiscussionPending] = useState(false);
  const { sendAnswer, submission, answerPending, answerLocked } = useWaitAnswer(q, onResolve);

  const steps = toSteps(q);
  const draftKey = JSON.stringify([q.sessionId, q.id]);
  const [initialDraft] = useState<DecisionDraft>(() => ({
    answers: steps.map(seedAnswer), stepIndex: 0, collapsed: false,
    discussionOpen: false, feedback: "", feedbackLocked: false,
  }));
  const draft = useDecisionDrafts(state => state.drafts[draftKey]) ?? initialDraft;
  const { answers, stepIndex, collapsed, discussionOpen, feedback, feedbackLocked } = draft;
  function updateDraft(patch: Partial<DecisionDraft>) {
    const store = useDecisionDrafts.getState();
    store.setDraft(draftKey, { ...(store.drafts[draftKey] ?? initialDraft), ...patch });
  }
  const setDiscussionOpen = (value: boolean) => updateDraft({ discussionOpen: value });
  const setFeedback = (value: string) => updateDraft({ feedback: value });
  const setFeedbackLocked = (value: boolean) => updateDraft({ feedbackLocked: value });
  async function sendDiscussion() {
    if (discussionPending || !feedback.trim()) return;
    setFeedbackLocked(true);
    setDiscussionPending(true);
    try { await onChatAbout(feedback); } finally { setDiscussionPending(false); }
  }
  const cur = steps[stepIndex];
  const curAns = answers[stepIndex];
  const allAnswered = steps.every((step, index) => stepAnswered(step, answers[index]));
  const currentAnswered = cur && stepAnswered(cur, curAns);
  const lastStep = stepIndex === steps.length - 1;
  const patch = (index: number, next: Answer) =>
    updateDraft({ answers: answers.map((answer, key) => key === index ? next : answer) });

  function advance() {
    if (discussionPending || answerPending) return;
    if (answerLocked || lastStep) {
      if (allAnswered || answerLocked) submit();
    } else if (currentAnswered) updateDraft({ stepIndex: stepIndex + 1 });
  }

  function submit() {
    if (discussionOpen || discussionPending || answerPending) return;
    // 按原 decision kind 收集成后端期望的格式。
    if (q.kind === "form") {
      const step = steps[0] as Extract<Step, { kind: "form" }>;
      const fields = (answers[0] as { fields: Record<string, string | number | boolean> }).fields;
      const answer: Record<string, unknown> = {};
      for (const name of Object.keys(step.schema)) {
        const f = step.schema[name];
        const v = fields[name];
        if ((f.type === "integer" || f.type === "number") && typeof v === "string") {
          answer[name] = v === "" ? null : Number(v);
        } else {
          answer[name] = v;
        }
      }
      void sendAnswer("execution.wait.answer", answer);
      return;
    }
    if (q.kind === "approval") {
      const pick = (answers[0] as { pick: ApprovalPick | null }).pick;
      // ``APPROVE_ANSWER`` is a PROTOCOL value, not UI text — it must never
      // follow the user's locale. ``_approval.await_user_approval`` accepts
      // it verbatim; a localized string would fail the comparison in every
      // language it doesn't happen to list.
      if (pick === "once") void sendAnswer("execution.wait.answer", { answer: APPROVE_ANSWER, scope: "once" });
      else if (pick === "always") void sendAnswer("execution.wait.answer", { answer: APPROVE_ANSWER, scope: "always" });
      else if (pick === "always_path") void sendAnswer("execution.wait.answer", { answer: APPROVE_ANSWER, scope: "always_path" });
      else if (pick === "deny") void sendAnswer("execution.wait.decline");
      else return;
      return;
    }
    if (q.kind === "ask_many") {
      const value = steps.map((s, i) => {
        const aa = answers[i] as { picked: Set<string>; custom: string };
        const arr = Array.from(aa.picked);
        if (aa.custom.trim()) arr.push(aa.custom.trim());
        const sc = s as Extract<Step, { kind: "choice" }>;
        return sc.multi ? arr : (arr[0] ?? "");
      });
      void sendAnswer("execution.wait.answer", value);
      return;
    }
    // ask / confirm —— 单题选择。
    const aa = answers[0] as { picked: Set<string>; custom: string };
    const arr = Array.from(aa.picked);
    if (aa.custom.trim()) arr.push(aa.custom.trim());
    const answer: string | string[] = q.multi ? arr : (arr[0] ?? "");
    void sendAnswer("execution.wait.answer", answer);
  }

  const submitLabel = answerPending ? text("Submitting…", "提交中…")
    : answerLocked ? text("Retry answer", "重试回答") : lastStep ? text("Submit", "提交") : text("Next", "下一题");

  // Shortcuts are scoped to this request. Text and IME input stay editable.
  function onKey(e: React.KeyboardEvent) {
    if (collapsed) return;
    const native = e.nativeEvent as KeyboardEvent;
    if (native.isComposing || native.keyCode === 229) return;
    const target = e.target as HTMLElement;
    if (!discussionOpen && !answerLocked && !e.ctrlKey && !e.metaKey && !e.altKey
        && /^[1-9]$/.test(e.key) && !target.closest("input, textarea, select, [contenteditable]")) {
      const option = e.currentTarget.querySelector<HTMLElement>(`[data-choice-number="${e.key}"]`);
      if (option) { e.preventDefault(); option.focus(); if (option.tagName === "BUTTON") option.click(); }
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (discussionOpen) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); void sendDiscussion(); }
      return;
    }
    if (target.tagName === "TEXTAREA") return;
    if (target.closest("button") && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    advance();
  }

  if (!cur) return null;

  return (
    <div className={styles.panel} data-question-card onKeyDown={onKey}>
      <div className={styles.header} data-fn-form-header data-decision>
        {!discussionOpen && <span className={styles.progress}
          aria-label={text(`Question ${stepIndex + 1} of ${steps.length}`, `第 ${stepIndex + 1} 题，共 ${steps.length} 题`)}>
          {stepIndex + 1}/{steps.length}
        </span>}
        <div className={styles.badge}>{discussionOpen ? text("Discuss this request", "讨论这个请求")
          : cur.kind === "approval" ? text("Approval required", "需要批准") : cur.prompt}</div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconBtn} aria-expanded={!collapsed}
            aria-label={collapsed ? text("Expand request", "展开请求") : text("Collapse request", "折叠请求")}
            onClick={() => updateDraft({ collapsed: !collapsed })}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
          {!collapsed && <button type="button" className={styles.iconBtn}
            aria-label={text("Hide request", "收起请求")} onClick={() => updateDraft({ collapsed: true })}><X size={16} /></button>}
        </div>
      </div>
      {!collapsed && <>
      {submission && <div className={styles.submissionStatus} role="status" aria-live="polite" data-answer-status={submission.status}>
        {answerPending ? text("Submitting answer…", "正在提交回答…") : submission.error}
      </div>}
      <div className={styles.body} data-fn-form-body>
        {cur.kind === "approval" ? (
          <StepBody step={cur} answer={curAns} onChange={(a) => patch(0, a)} />
        ) : discussionOpen ? (
          <AnswerSummary decision={q} answer={undefined} />
        ) : answerLocked && submission?.command.payload.answer !== undefined ? (
          <AnswerSummary decision={q} answer={submission.command.payload.answer} />
        ) : (
          <div className={styles.questionList}>
            {q.kind === "ask_many" && q.prompt && <div className={styles.groupPrompt}>{q.prompt}</div>}
            <fieldset key={stepIndex} disabled={discussionPending || answerLocked} className={styles.questionItem}>
              <StepBody step={cur} answer={curAns} onChange={(answer) => patch(stepIndex, answer)} />
            </fieldset>
          </div>
        )}
        {discussionOpen && (
          <label className={formStyles.field}>
            <span className="sr-only">{text("Discussion", "讨论内容")}</span>
            <Textarea className={styles.discussionInput} autoFocus rows={4} value={feedback} readOnly={feedbackLocked}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder={text("Add your question, concern, or a different approach…", "写下你的问题、顾虑，或希望调整的地方…")} />
            {feedbackLocked && !discussionPending && <span className={formStyles.hint}>
              {text("Not confirmed yet. Retry to confirm the same feedback.", "尚未确认，请重试发送同一条反馈。")}
            </span>}
          </label>
        )}
      </div>
        <div className={`${styles.actions} ${styles.footer}`} role="group" aria-label={text("Decision actions", "答复操作")}>
          {cur.kind === "approval" && !discussionOpen && (
            <div className={styles.actionButtons}>
              <button type="button" className={styles.navBtn}
                disabled={answerPending || (answerLocked && submission?.command.action !== "execution.wait.decline")}
                onClick={() => { patch(0, { pick: "deny" }); void sendAnswer("execution.wait.decline"); }}>
                {text("Deny", "拒绝")}
              </button>
              {(["always", "always_path"] as const).filter(scope => cur.allowedScopes?.includes(scope)).map(scope => (
                <button key={scope} type="button" className={styles.navBtn}
                  disabled={answerLocked}
                  onClick={() => { patch(0, { pick: scope }); void sendAnswer("execution.wait.answer", { answer: APPROVE_ANSWER, scope }); }}>
                  {scope === "always" ? text("Always allow", "始终允许") : text("Always allow this path", "始终允许此路径")}
                </button>
              ))}
              <button type="button" className={`${styles.navBtn} ${styles.navBtnPrimary}`}
                disabled={answerPending || (answerLocked && submission?.command.action !== "execution.wait.answer")}
                aria-busy={answerPending}
                onClick={() => { patch(0, { pick: "once" }); void sendAnswer("execution.wait.answer", { answer: APPROVE_ANSWER, scope: "once" }); }}>
                {answerPending ? text("Sending…", "提交中…") : text("Allow once", "同意")}
              </button>
            </div>
          )}
          {cur.kind !== "approval" && !discussionOpen && stepIndex > 0 && <button type="button"
            className={styles.navBtn} disabled={answerLocked || discussionPending}
            onClick={() => updateDraft({ stepIndex: stepIndex - 1 })}>{text("Back", "上一题")}</button>}
          {cur.kind !== "approval" && <div className={styles.actionButtons}>
            {discussionOpen ? <>
              <button type="button" className={styles.navBtn} disabled={feedbackLocked}
                onClick={() => setDiscussionOpen(false)}>{text("Cancel", "取消")}</button>
              <button type="button" className={`${styles.navBtn} ${styles.navBtnPrimary}`}
                disabled={discussionPending || !feedback.trim()} aria-busy={discussionPending}
                onClick={() => void sendDiscussion()}>
                {discussionPending ? text("Sending…", "发送中…") : feedbackLocked
                  ? text("Retry discussion", "重试讨论") : text("Send discussion", "发送讨论")}
              </button>
            </> : <button type="button" className={`${styles.navBtn} ${styles.discussBtn}`} disabled={answerLocked}
              onClick={() => setDiscussionOpen(true)} aria-label={text("Discuss", "先讨论")}
              title={text("Discuss before proceeding", "先讨论再继续")}>
              <MessageCircle size={15} aria-hidden="true" />
            </button>}
          {!discussionOpen && <>
            <button type="button" className={styles.navBtn} disabled={answerLocked || discussionPending}
              title={text("Skip this request without submitting answers", "跳过整组请求，不提交回答")}
              onClick={() => void sendAnswer("execution.wait.decline")}>{text("Skip", "跳过")}</button>
            <button type="button" className={`${styles.navBtn} ${styles.navBtnPrimary}`}
              onClick={advance} aria-label={submitLabel} aria-busy={answerPending}
              disabled={discussionPending || answerPending || (!answerLocked && (!currentAnswered || (lastStep && !allAnswered)))}>
              {submitLabel}<kbd className={styles.submitKey} aria-hidden="true">Ctrl ↵</kbd>
            </button>
          </>}
          </div>}
        </div>
      </>}
    </div>
  );
}

/** 当前步的 body —— 按 step.kind 渲染。外壳（header/底部）已统一在上面。 */
function StepBody({
  step,
  answer,
  onChange,
}: {
  step: Step;
  answer: Answer;
  onChange: (a: Answer) => void;
}) {
  const { text } = useTranslation();
  if (step.kind === "form") {
    const fields = (answer as { fields: Record<string, string | number | boolean> }).fields;
    const setField = (name: string, v: string | number | boolean) =>
      onChange({ fields: { ...fields, [name]: v } });
    return (
      <>
        <div className={styles.prompt}>{step.prompt}</div>
        {step.detail ? <div className={styles.detail}>{step.detail}</div> : null}
        <div className={formStyles.fields}>
          {Object.keys(step.schema).map((name) => {
            const f = step.schema[name];
            const label = f.title || name;
            // boolean：标签 + 勾选框同一行（标签在左、勾选框在右）；
            // 其它字段：标签在上、控件在下。
            if (f.type === "boolean") {
              return (
                <label key={name} className={formStyles.fieldRow}>
                  <span className={formStyles.label}>
                    {label}
                    {f.description ? <span className={formStyles.hint}> · {f.description}</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(fields[name])}
                    onChange={(e) => setField(name, e.target.checked)}
                    className={formStyles.checkbox}
                  />
                </label>
              );
            }
            return (
              <label key={name} className={formStyles.field}>
                <span className={formStyles.label}>
                  {label}
                  {f.description ? <span className={formStyles.hint}> · {f.description}</span> : null}
                </span>
                {f.enum && f.enum.length ? (
                  <select
                    className={styles.input}
                    value={String(fields[name])}
                    onChange={(e) => setField(name, e.target.value)}
                  >
                    {f.enum.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.input}
                    type={f.type === "integer" || f.type === "number" ? "number" : "text"}
                    value={String(fields[name])}
                    min={f.minimum}
                    max={f.maximum}
                    onChange={(e) => setField(name, e.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
      </>
    );
  }

  if (step.kind === "approval") {
    const esc = step.escalation;
    const { prompt, summary } = approvalDisplayText(step.prompt, step.detail, esc, text);
    const command = !esc && ["bash", "process", "shell", "exec_command"].includes(step.tool ?? "")
      && typeof step.args?.command === "string" ? step.args.command : null;
    return (
      <>
        <div className={styles.prompt}>{prompt}</div>
        {command ? <OperationCode value={command} language="bash" /> : null}
        {esc && summary ? <pre className={approvalStyles.summary}>{summary}</pre> : null}
        {step.args && Object.keys(step.args).length > 0 ? (
          command ? (
            <details className={approvalStyles.executionDetails}>
              <summary><ChevronRight size={16} aria-hidden="true" />{text("Execution details", "查看执行详情")}</summary>
              <OperationCode value={JSON.stringify(step.args, null, 2)} language="json" />
            </details>
          ) : <OperationCode value={JSON.stringify(step.args, null, 2)} language="json" />
        ) : !esc && summary ? <OperationCode value={summary} language="text" /> : null}
      </>
    );
  }

  // choice —— 选项 + 可选自由文本。
  const aa = answer as { picked: Set<string>; custom: string };
  const toggle = (opt: string) => {
    if (step.multi) {
      const next = new Set(aa.picked);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      onChange({ picked: next, custom: aa.custom });
    } else {
      // 单选：点已选的 → 取消；点别的 → 切换。
      onChange({ picked: aa.picked.has(opt) ? new Set() : new Set([opt]), custom: "" });
    }
  };
  return (
    <>
      {step.multi && <div className={styles.choiceHint}>{text("Select one or more", "可选择一项或多项")}</div>}
      {step.options.length > 0 ? (
        <div className={styles.options}>
          {step.options.map((opt, index) => (
            <button
              key={opt}
              type="button"
              className={styles.opt + (aa.picked.has(opt) ? " " + styles.optPicked : "")}
              aria-pressed={aa.picked.has(opt)} aria-label={opt} data-choice-number={index + 1}
              onClick={() => toggle(opt)}
            >
              <span className={styles.optionContent}>
                <span className={styles.optionTitle}>{opt}</span>
                {step.optionDescriptions?.[opt] && <span className={styles.optionDescription}>{step.optionDescriptions[opt]}</span>}
              </span>
              <kbd className={styles.keycap} aria-hidden="true">{index + 1}</kbd>
            </button>
          ))}
        </div>
      ) : null}
      {step.allowCustom ? (
        <label className={`${styles.customOption} ${aa.custom.trim() ? styles.optPicked : ""}`}>
          {step.options.length > 0 && <span className={styles.customTitle}>
            {text("Other", "其他")}<kbd className={styles.keycap} aria-hidden="true">{step.options.length + 1}</kbd>
          </span>}
        <input
          className={styles.input}
          value={aa.custom}
          aria-label={step.prompt} data-choice-number={step.options.length + 1}
          placeholder={step.options.length
            ? text("Type your own answer here", "输入自定义回答")
            : text("Type your answer…", "输入你的回答…")}
          onChange={(e) => {
            const custom = e.target.value;
            // 打字进自由文本时清掉单选已选项（避免两个答案打架）。
            const picked = !step.multi && aa.picked.size ? new Set<string>() : aa.picked;
            onChange({ picked, custom });
          }}
        />
        </label>
      ) : null}
    </>
  );
}
