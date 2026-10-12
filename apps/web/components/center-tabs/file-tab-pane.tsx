"use client";
import type { FileSectionNavigation } from "@/lib/tabs/file-section-requests";
import { DocumentWindow } from "@/components/files/lazy-document-window";

export function FileTabPane({ projectId, path, sessionId, readOnly, sectionNavigation }: { projectId: string; path: string; sessionId?: string; readOnly?: boolean; sectionNavigation?: FileSectionNavigation }) {
  return <DocumentWindow projectId={projectId} path={path} sessionId={sessionId} readOnly={readOnly} sectionNavigation={sectionNavigation} />;
}
