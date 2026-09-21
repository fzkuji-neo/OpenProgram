import type { GoalVerification } from "@/lib/chat/goal-verification";
import { useTranslation } from "@/lib/i18n";

export function VerificationDetails({ value, raw, settled }: {
  value: GoalVerification; raw: string; settled: boolean;
}) {
  const { text } = useTranslation();
  return <details className="goal-verdict" data-goal-verification={value.id}>
    <summary>{text("Verification details", "验收详情")}</summary>
    {value.reason ? <p>{value.reason}</p> : null}
    {value.requirements?.map(row => <section key={row.id}>
      <p>{row.text || row.id} — {row.verdict === "met" ? text("Passed", "通过")
        : row.verdict === "unmet" ? text("Not met", "未满足") : text("Uncertain", "无法确认")}</p>
      {row.reason ? <p>{row.reason}</p> : null}
      {row.evidence?.length ? <p>{text("Evidence", "证据")}: {row.evidence.join(", ")}</p> : null}
    </section>)}
    {settled && raw ? <details><summary>{text("Raw report", "原始报告")}</summary><pre>{raw}</pre></details>
      : <p>{text("The report is not available yet.", "报告尚未生成。")}</p>}
  </details>;
}
