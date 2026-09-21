import { wsRequest } from "@/lib/net/ws-request";
import { showToast } from "@/lib/format-utils/toast";
import { translateText } from "@/lib/i18n";

const pending = new Set<string>();

/** Explicit user action shared by native and web conversation menus. */
export async function autoRenameSession(sessionId: string): Promise<void> {
  if (pending.has(sessionId)) return;
  pending.add(sessionId);
  showToast(translateText("Generating a name…", "正在生成会话名称…"));
  try {
    const result = await wsRequest<{ status: string }>(
      "rename_session", { session_id: sessionId }, "session_rename_result",
      { requestId: true }, 65_000,
    );
    if (result?.status === "ok") {
      showToast(translateText("Conversation renamed", "会话已重命名"));
    } else if (result?.status === "superseded") {
      showToast(translateText("Conversation changed; generated name was not applied", "会话已变更，未应用生成的名称"));
    } else if (!result) {
      showToast(translateText("Rename not confirmed. Check the conversation title after reconnecting.", "未收到命名确认，请在连接恢复后查看会话名称。"), { tone: "warn" });
    } else {
      showToast(translateText("Could not generate a name. The previous title is unchanged.", "名称生成失败，原名称已保留。"), { tone: "error" });
    }
  } catch {
    showToast(translateText("Could not request a name", "无法请求生成会话名称"), { tone: "error" });
  } finally {
    pending.delete(sessionId);
  }
}
