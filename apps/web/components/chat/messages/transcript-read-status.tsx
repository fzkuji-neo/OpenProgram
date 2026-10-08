"use client";
import { useSessionStore } from '@/lib/session-store';
import { useTranslation } from '@/lib/i18n';
import { requestSessionLoad } from '@/lib/runtime-bridge/session-load';

export function TranscriptReadStatus({ sessionId }: { sessionId: string | null }) {
  const status = useSessionStore(s => sessionId ? s.transcriptReadStatus[sessionId] : undefined);
  const { text } = useTranslation();
  if (!sessionId || (status !== 'error' && status !== 'disconnected')) return null;
  return <div role="status" className="flex items-center gap-3 px-4 py-3 text-sm">
    <span>{status === 'disconnected' ? text('Disconnected. History is unavailable.', '连接已断开，暂时无法加载历史。') : text('Could not load history.', '历史加载失败。')}</span>
    <button type="button" className="underline" onClick={() => requestSessionLoad({ action: 'load_session', session_id: sessionId })}>{text('Retry', '重试')}</button>
  </div>;
}
