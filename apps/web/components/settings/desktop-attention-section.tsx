"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { desktopBridge } from "@/lib/desktop/desktop-bridge";
import type { DesktopAttentionApi, DesktopAttentionPrefs } from "@/lib/desktop/desktop-bridge-types";
import styles from "./settings-page.module.css";

/** Desktop notifications and keep-awake. Rendered only inside the desktop shell. */
export function DesktopAttentionSection() {
  const { text } = useTranslation();
  const [attention, setAttention] = useState<DesktopAttentionApi | null>(null);
  const [prefs, setPrefs] = useState<DesktopAttentionPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = desktopBridge()?.attention ?? null;
    setAttention(api);
    if (!api) return;
    let active = true;
    void api.getPrefs().then((next) => { if (active) setPrefs(next); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    const unsubscribe = api.onPrefs((next) => { if (active) setPrefs(next); });
    return () => { active = false; unsubscribe(); };
  }, []);

  if (!attention) return null;

  const update = (patch: Partial<DesktopAttentionPrefs>) => {
    setError(null);
    void attention.setPrefs(patch).then(setPrefs).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <section>
      <h3 className={styles.sectionTitle}>{text("Notifications", "通知")}</h3>
      <div className={styles.card}>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="desktop-notifications">
            {text("Notify when a session finishes or needs you while OpenProgram is in the background",
              "OpenProgram 在后台时，会话完成或需要你回复就发通知")}
          </label>
          <div className={styles.control}>
            <Switch
              id="desktop-notifications"
              checked={prefs?.notifications ?? true}
              disabled={!prefs}
              onCheckedChange={(checked) => update({ notifications: checked })}
            />
          </div>
        </div>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="desktop-keep-awake">
            {text("Keep the computer awake while a session is running", "会话运行时保持电脑不休眠")}
          </label>
          <div className={styles.control}>
            <Switch
              id="desktop-keep-awake"
              checked={prefs?.keepAwake ?? true}
              disabled={!prefs}
              onCheckedChange={(checked) => update({ keepAwake: checked })}
            />
          </div>
        </div>
        {error && (
          <div className={styles.row} role="alert">
            <div className={styles.label}>{error}</div>
          </div>
        )}
      </div>
    </section>
  );
}
