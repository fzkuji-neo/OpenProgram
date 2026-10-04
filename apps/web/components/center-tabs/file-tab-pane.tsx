"use client";
import { DocumentWindow } from "@/components/files/lazy-document-window";

export function FileTabPane({ projectId, path, sessionId, readOnly }: { projectId: string; path: string; sessionId?: string; readOnly?: boolean }) {
  return <DocumentWindow projectId={projectId} path={path} sessionId={sessionId} readOnly={readOnly} />;
}
