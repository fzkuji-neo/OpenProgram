"use client";

/**
 * Branch-merge modal — picks a merge mode (equal merge vs attach-into-★)
 * and collects an optional reconciliation instruction. Triggered from
 * the BranchesPanel toolbar once the user has multi-selected ≥2 branches.
 *
 * Owns no state — every value + setter is passed down. Extracted from
 * BranchesPanel so the panel file stays focused on the list rendering.
 */
import type React from "react";

import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MergeModalProps {
  /** Selected branch head ids (≥2 when this modal is open). */
  selected: string[];
  /** Optional ★ base — when non-null the merge happens IN-PLACE on
   *  that branch; otherwise it's an equal merge with a fresh tip. */
  baseHead: string | null;
  /** Free-text instruction passed to the merge agent. */
  mergeInstruction: string;
  setBaseHead: (id: string | null) => void;
  setMergeInstruction: (s: string) => void;
  onCancel: () => void;
  onMerge: () => void;
}

export function MergeModal({
  selected,
  baseHead,
  mergeInstruction,
  setBaseHead,
  setMergeInstruction,
  onCancel,
  onMerge,
}: MergeModalProps) {
  const { t, locale } = useTranslation();
  const title =
    locale === "zh"
      ? `合并 ${selected.length} 个分支`
      : `Merge ${selected.length} branches`;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="branches-merge-modal" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="branches-merge-mode">
          <label className="branches-merge-mode-row">
            <input
              type="radio"
              name="merge-mode"
              checked={!baseHead}
              onChange={() => setBaseHead(null)}
            />
            <span>
              <strong>{t("right.equal_merge")}</strong>
              {" - "}
              {t("right.equal_merge_desc")}
            </span>
          </label>
          <label className="branches-merge-mode-row">
            <input
              type="radio"
              name="merge-mode"
              checked={!!baseHead}
              onChange={() => {
                // Default base to first selected if nothing is
                // ⌘-clicked yet — the radio is only useful when
                // a base exists.
                if (!baseHead && selected.length > 0) {
                  setBaseHead(selected[0]);
                }
              }}
            />
            <span>
              <strong>{t("right.attach_base")}</strong>
              {" - "}
              {t("right.attach_base_desc")}
            </span>
          </label>
        </div>
        <textarea
          className="branches-merge-modal-input"
          placeholder={t("right.merge_instruction_placeholder")}
          value={mergeInstruction}
          onChange={(e) => setMergeInstruction(e.target.value)}
          autoFocus
          rows={4}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onMerge();
            }
          }}
        />
        <div className="branches-merge-modal-hint">
          {t("right.merge_shortcut_hint")}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("sidebar.cancel")}
          </Button>
          <Button type="button" onClick={onMerge}>
            {t("right.merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
