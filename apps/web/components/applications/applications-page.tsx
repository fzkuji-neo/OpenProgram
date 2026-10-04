"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { applicationRequest, type ApplicationDefinition } from "@/lib/net/applications";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BoxesIcon, FolderOpenIcon, RefreshCwIcon } from "@/components/animated-icons";
import {
  ManageEmptyState, ManagePage, ManagePageHeader, ManageSummary, managePageStyles as shared,
} from "@/components/ui/manage-page";
import { useFolderPicker } from "@/components/ui/folder-picker";
import { useApplicationLauncher } from "./use-application-launcher";
import styles from "./applications-page.module.css";

export function ApplicationsPage() {
  const { text } = useTranslation();
  const router = useRouter();
  const launcher = useApplicationLauncher(() => router.push("/chat"));
  const { pickFolder, folderPickerDialog } = useFolderPicker();
  const [applications, setApplications] = useState<ApplicationDefinition[]>([]);
  const [directory, setDirectory] = useState("");
  const [replace, setReplace] = useState(false);
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const response = await applicationRequest<{ applications: ApplicationDefinition[] }>("/api/applications");
    setApplications(response.applications);
    setLoaded(true);
  }, []);
  useEffect(() => { void refresh().catch(reason => setError(String(reason.message ?? reason))); }, [refresh]);
  async function change(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); setNotice(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function chooseDirectory() {
    try { const selected = await pickFolder(); if (selected) { setDirectory(selected); setReplace(false); setTrust(false); } }
    catch (reason) { setError(String(reason)); }
  }
  const update = (application: ApplicationDefinition, patch: Partial<Pick<ApplicationDefinition, "enabled" | "hidden">>) => void change(
    () => applicationRequest(`/api/applications/${encodeURIComponent(application.id)}`, "PATCH", patch),
    text("Application settings saved", "应用设置已保存"),
  );
  const enabledCount = applications.filter(application => application.enabled).length;

  return <ManagePage>
    <ManagePageHeader
      title={text("Applications", "应用")}
      toolbar={loaded && applications.length > 0
        ? <ManageSummary>{text(`${enabledCount} of ${applications.length} enabled`, `${enabledCount}/${applications.length} 个已启用`)}</ManageSummary>
        : undefined}
      actions={[{ label: text("Refresh", "刷新"), onClick: () => void change(refresh, ""), icon: RefreshCwIcon, iconOnly: true, disabled: busy }]}
    />
    {(error || launcher.error) && <div role="alert" className={shared.errorBar}>{error || launcher.error}</div>}
    {notice && <div role="status" className={styles.notice}>{notice}</div>}
    <div className={shared.body}>
      <div className={styles.content}>
        <form className={styles.install} onSubmit={event => { event.preventDefault(); void change(
          () => applicationRequest("/api/applications/install", "POST", { path: directory.trim(), replace, trust }),
          text("Application installed", "应用已安装"),
        ); }}>
          <div className={styles.installHeading}>
            <h2>{text("Install from a folder", "从文件夹安装")}</h2>
            <p>{text("Applications have their own interface and saved data. Enabled applications appear on the new tab page.", "应用拥有自己的界面和数据。已启用的应用会显示在新标签页。")}</p>
          </div>
          <label className={styles.fieldLabel} htmlFor="application-directory">{text("Application directory", "应用目录")}</label>
          <div className={styles.directory}>
            <input id="application-directory" value={directory} onChange={event => { setDirectory(event.target.value); setTrust(false); }} placeholder={text("Local directory containing application.json", "包含 application.json 的本地目录")} required disabled={busy} />
            <Button type="button" variant="outline" className={styles.outlineButton} disabled={busy} onClick={() => void chooseDirectory()}>
              <FolderOpenIcon size={16} aria-hidden />{text("Browse", "浏览")}
            </Button>
          </div>
          <div className={styles.checks}>
            <label><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} disabled={busy} />{text("Replace the installed version from this source", "替换此来源的已安装版本")}</label>
            <label><input type="checkbox" checked={trust} onChange={event => setTrust(event.target.checked)} disabled={busy} />{text("I reviewed and trust this application's Python code to run locally", "我已审查并信任此应用的 Python 代码在本机运行")}</label>
          </div>
          <div className={styles.installFooter}>
            <Button type="submit" disabled={busy || !directory.trim()}>{busy ? text("Working…", "处理中…") : text("Install application", "安装应用")}</Button>
          </div>
        </form>
        {launcher.dialog}{folderPickerDialog}

        {loaded && applications.length === 0 ? (
          <ManageEmptyState
            compact
            icon={<BoxesIcon size={20} />}
            title={text("No applications installed", "尚未安装应用")}
            description={text("Install one from a local folder above. Tools and Workflows are managed in Abilities.", "可从上方的本地文件夹安装。工具与 Workflow 在能力页管理。")}
          />
        ) : applications.length > 0 && (
          <section className={styles.list} aria-label={text("Installed applications", "已安装应用")}>
            <div className={shared.sectionHeader}>
              <span>{text("Installed", "已安装")}</span>
              <span>{applications.length}</span>
            </div>
            {applications.map(application => {
              const title = application.display_title || application.title;
              return <section className={styles.application} key={application.id} aria-label={title}>
                <span className={styles.appIcon} aria-hidden><BoxesIcon size={18} /></span>
                <div className={styles.appMain}>
                  <div className={styles.appTitle}>
                    <h3>{title}</h3>
                    <span className={shared.badge}>v{application.version}</span>
                    <span className={shared.badge}>{application.scope === "project" ? text("Per project", "按项目") : text("Global", "全局")}</span>
                    {!application.enabled && <span className={`${shared.badge} ${shared.badgeYellow}`}>{text("Disabled", "已停用")}</span>}
                  </div>
                  <p className={styles.appMeta}>{application.id}</p>
                  <p className={styles.source} title={application.source}>{text("Source", "来源")}: {application.source}</p>
                  <div className={styles.toggles}>
                    <label><Switch className={styles.switch} checked={application.enabled} disabled={busy} aria-label={text("Enabled", "启用")} onCheckedChange={checked => update(application, { enabled: checked })} /><span aria-hidden>{text("Enabled", "启用")}</span></label>
                    <label><Switch className={styles.switch} checked={!application.hidden} disabled={busy} aria-label={text("Show in new tab", "在新标签页显示")} onCheckedChange={checked => update(application, { hidden: !checked })} /><span aria-hidden>{text("Show in new tab", "在新标签页显示")}</span></label>
                  </div>
                </div>
                <div className={styles.appActions}>
                  <Button disabled={busy || !application.enabled} onClick={() => void launcher.launch(application)}>{text("Open", "打开")}</Button>
                  <Button variant="outline" className={styles.outlineButton} disabled={busy} onClick={() => { setDirectory(application.source); setReplace(true); setTrust(false); setNotice(text("Review the source and use the installation form to update.", "请审查来源，并使用安装表单完成更新。")); document.getElementById("application-directory")?.focus(); }}>{text("Update", "更新")}</Button>
                  <Button variant="ghost" className={styles.uninstall} disabled={busy} onClick={() => void change(() => applicationRequest(`/api/applications/${encodeURIComponent(application.id)}`, "DELETE"), text("Application uninstalled; saved data retained", "应用已卸载，已保存的数据保留"))}>{text("Uninstall", "卸载")}</Button>
                </div>
              </section>;
            })}
          </section>
        )}
      </div>
    </div>
  </ManagePage>;
}
