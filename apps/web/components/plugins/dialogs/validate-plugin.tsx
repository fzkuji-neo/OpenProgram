"use client";

import { useEffect, useState } from "react";
import styles from "../plugins.module.css";
import { usePluginsStore } from "@/lib/abilities/plugins-store";
import { useTranslation } from "@/lib/i18n";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Props {
  name: string;
  onClose: () => void;
}

export function ValidatePluginDialog({ name, onClose }: Props) {
  const { text } = useTranslation();
  const validate = usePluginsStore((s) => s.validate);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    validate(name)
      .then((r) => setChecks(r.checks))
      .catch((e) => setErr(String(e)));
  }, [name, validate]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={styles.dialog} aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{text(`Validate ${name}`, `校验 ${name}`)}</DialogTitle></DialogHeader>
        <div className={styles.dialogBody}>
          {err && <div style={{ color: "#ef4444" }}>{err}</div>}
          {!checks && !err && <div className={styles.empty}>{text("Validating...", "正在校验...")}</div>}
          {checks?.map((c) => (
            <div key={c.name} className={styles.checkRow}>
              <span className={c.ok ? styles.checkOk : styles.checkFail}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: "var(--text-dim)" }}>{c.detail}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{text("Close", "关闭")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
