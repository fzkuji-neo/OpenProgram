"use client";

/**
 * The Review pane's diff body. Same parse as the chat's inline diff
 * (parseUnifiedDiff), laid out for reading a whole file: the file
 * headers (---/+++/diff/index) are dropped because the pane's file
 * header already names the file, each hunk header becomes "Lines a–b",
 * long lines wrap instead of running off the edge, and an added or
 * deleted file shows only the line-number column it has.
 */
import { useMemo } from "react";

import { useTranslation } from "@/lib/i18n";
import { hunkRange, reviewRows } from "./review-diff-rows.ts";
import styles from "./review-diff.module.css";

export function ReviewDiff({ diff, op }: { diff: string; op?: string }) {
  const { text } = useTranslation();
  const rows = useMemo(() => reviewRows(diff), [diff]);
  const showOld = op !== "add";
  const showNew = op !== "delete";
  const columns = showOld && showNew ? "" : styles.oneNumber;
  if (rows.length === 0) return null;
  return (
    <div className={`${styles.diff} ${columns}`}>
      {rows.map((row, index) => {
        if (row.kind === "hunk") {
          const range = hunkRange(row.text);
          return (
            <div key={index} className={styles.hunk}>
              {range
                ? text(`Lines ${range.from}–${range.to}`, `第 ${range.from}–${range.to} 行`)
                : row.text}
              {range?.context ? <span className={styles.hunkContext}>{range.context}</span> : null}
            </div>
          );
        }
        if (row.kind === "meta") {
          return <div key={index} className={styles.note}>{row.text.replace(/^\\\s*/, "")}</div>;
        }
        const sign = row.kind === "add" ? "+" : row.kind === "del" ? "−" : "";
        return (
          <div key={index} className={`${styles.line} ${styles[row.kind] ?? ""}`}>
            {showOld ? <span className={styles.number}>{row.oldNo}</span> : null}
            {showNew ? <span className={styles.number}>{row.newNo}</span> : null}
            <span className={styles.sign} aria-hidden="true">{sign}</span>
            <span className={styles.text}>{row.text.slice(1) || " "}</span>
          </div>
        );
      })}
    </div>
  );
}
