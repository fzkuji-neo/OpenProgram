"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BrainIcon,
  FolderCodeIcon,
  MessageCircleIcon,
  SettingsIcon,
} from "@/components/animated-icons";

import { ChatsPage } from "@/components/chats/chats-page";
import { MemoryPage } from "@/components/memory";
import { ProjectsPage } from "@/components/projects/projects-page";
import { SearchInput } from "@/components/ui/search-input";
import { ManagePage, ManagePageHeader, managePageStyles as shared } from "@/components/ui/manage-page";
import { useTranslation } from "@/lib/i18n";
import { pushPath } from "@/lib/shallow-nav";

export type HistoryKind = "chats" | "projects" | "memory";

/** Survives remounts when tab routes swap page.tsx. */
let persistedQuery = "";

function kindFromPath(pathname: string): HistoryKind {
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/memory")) return "memory";
  return "chats";
}

function kindHref(id: string): string {
  if (id === "projects") return "/projects";
  if (id === "memory") return "/memory";
  return "/chats";
}

export function HistoryPage() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { t, text } = useTranslation();
  const [kind, setKind] = useState(() => kindFromPath(pathname));
  const [query, setQueryState] = useState(persistedQuery);

  useEffect(() => {
    const onPop = () => setKind(kindFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setQuery = (value: string) => {
    persistedQuery = value;
    setQueryState(value);
  };

  const goKind = (id: string) => {
    const href = kindHref(id);
    setKind(kindFromPath(href));
    pushPath(href);
  };

  const actions = useMemo(() => {
    if (kind === "memory") {
      return [
        { label: text("Memory settings", "Memory 设置"), onClick: () => router.push("/settings/memory"), icon: SettingsIcon },
      ];
    }
    return [];
  }, [kind, text, router]);

  return (
    <ManagePage>
        <ManagePageHeader
          title={t("nav.history")}
          tabs={[
            { id: "chats", label: t("nav.chats"), icon: MessageCircleIcon },
            { id: "projects", label: t("nav.projects"), icon: FolderCodeIcon },
            { id: "memory", label: t("nav.memory"), icon: BrainIcon },
          ]}
          activeTab={kind}
          onTabChange={goKind}
          tabLabel={text("History sections", "历史分区")}
          panelId="history-panel"
          toolbar={(
            <SearchInput
              className="min-w-[96px] flex-1 sm:flex-none sm:min-w-[140px] sm:w-[clamp(150px,24vw,280px)]"
              value={query}
              onChange={setQuery}
              placeholder={text("Search chats, projects, memory...", "搜索会话、项目、记忆...")}
            />
          )}
          actions={actions}
        />
        <div
          id="history-panel"
          role="tabpanel"
          aria-labelledby={`history-panel-tab-${kind}`}
          className={shared.panel}
        >
        {kind === "chats" && (
          <ChatsPage
            embedded
            query={query}
          />
        )}
        {kind === "projects" && (
          <ProjectsPage
            embedded
            query={query}
          />
        )}
        {kind === "memory" && (
          <MemoryPage
            embedded
            query={query}
          />
        )}
        </div>
    </ManagePage>
  );
}
