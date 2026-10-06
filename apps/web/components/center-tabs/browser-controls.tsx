"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  ArrowRight,
  Check,
  Clock3,
  Download,
  House,
  Import,
  Library,
  MoreVertical,
  PictureInPicture2,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  ZoomIn,
  ZoomOut,
  ExternalLink,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  itemCls,
  MENU_PANEL,
  MENU_SEPARATOR,
} from "@/components/chat/top-bar/menu-styles";
import { activeThemeId } from "@/lib/prefs/theme-pref";
import {
  requestBrowserImport,
  setShowBookmarksBar,
  showBookmarksBar,
} from "@/lib/browser/browser-prefs";
import { desktopBridge } from "@/lib/desktop/desktop-bridge";
import type { DesktopContextMenuItem } from "@/lib/desktop/desktop-bridge-types";
import {
  browserActionPrefix,
  browserResponsiveMenuItems,
  ownedActionId,
} from "@/lib/browser/browser-layout";
import { useTranslation } from "@/lib/i18n";
import { useCenterTabs } from "@/lib/tabs/center-tabs-store";
import styles from "./center-tabs.module.css";
import { useBookmarksBarPreference } from "./bookmark-bar";

type BrowserMenuActions = {
  home(): void;
  forward?: () => void;
  openExternal(): void;
  find?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  resetZoom?: () => void;
  print?: () => void;
  collapseToPip?: () => void;
};

function runBrowserAction(
  id: string,
  router: ReturnType<typeof useRouter>,
  actions: BrowserMenuActions,
) {
  const tabs = useCenterTabs.getState();
  switch (id) {
    case "new-tab":
      tabs.openBuiltinTab("browser");
      break;
    case "collapse-to-pip":
      actions.collapseToPip?.();
      break;
    case "home":
      actions.home();
      break;
    case "forward":
      actions.forward?.();
      break;
    case "open-external":
      actions.openExternal();
      break;
    case "find":
      actions.find?.();
      break;
    case "zoom-in":
      actions.zoomIn?.();
      break;
    case "zoom-out":
      actions.zoomOut?.();
      break;
    case "reset-zoom":
      actions.resetZoom?.();
      break;
    case "print":
      actions.print?.();
      break;
    case "bookmarks":
      tabs.openBuiltinTab("bookmarks");
      break;
    case "history":
      tabs.openBuiltinTab("history");
      break;
    case "downloads":
      tabs.openBuiltinTab("downloads");
      break;
    case "toggle-bookmarks-bar":
      setShowBookmarksBar(!showBookmarksBar());
      break;
    case "import":
      requestBrowserImport();
      tabs.openBuiltinTab("browser");
      break;
    case "clear-data":
      router.push("/settings/browser#clear-data");
      break;
    case "settings":
      router.push("/settings/browser");
      break;
  }
}

export function BrowserMenu({
  ownerId,
  actions,
  canGoForward = true,
  canGoHome = true,
  canOpenExternal = true,
}: {
  ownerId: string;
  actions: BrowserMenuActions;
  canGoForward?: boolean;
  canGoHome?: boolean;
  canOpenExternal?: boolean;
}) {
  const router = useRouter();
  const { text } = useTranslation();
  const visible = useBookmarksBarPreference();
  const bridge = desktopBridge();
  const mainMenu = bridge?.mainMenu;
  const canImport = Boolean(bridge?.browserImport);
  const label = text("Browser menu", "浏览器菜单");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const [paneWidth, setPaneWidth] = useState(Number.POSITIVE_INFINITY);
  const responsive = browserResponsiveMenuItems(paneWidth, {
    forward: Boolean(actions.forward),
  });
  const actionPrefix = browserActionPrefix(ownerId);

  useEffect(() => {
    const pane = triggerRef.current?.closest(`.${styles.webPane}`);
    if (!pane) return;
    const update = () => setPaneWidth(pane.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mainMenu) return;
    return mainMenu.onAction((id) => {
      const action = ownedActionId(id, actionPrefix);
      if (action === null) return;
      runBrowserAction(action, router, actionsRef.current);
    });
  }, [actionPrefix, mainMenu, router]);

  if (mainMenu) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={styles.webToolbarBtn}
        title={label}
        aria-label={label}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const item = (
            id: string,
            english: string,
            chinese: string,
            extra?: Pick<DesktopContextMenuItem, "separatorBefore" | "checked" | "disabled">,
          ): DesktopContextMenuItem => ({
            id: `${actionPrefix}${id}`,
            label: text(english, chinese),
            ...extra,
          });
          mainMenu.open({
            anchor: { right: rect.right, y: rect.bottom + 4, align: "end", vw: innerWidth, vh: innerHeight },
            theme: activeThemeId(),
            items: [
              item("new-tab", "New browser tab", "新建浏览器标签页"),
              ...(actions.collapseToPip
                ? [item("collapse-to-pip", "Collapse to floating window", "收起到悬浮窗")]
                : []),
              ...(responsive.home ? [item("home", "Home", "主页", { disabled: !canGoHome })] : []),
              ...(responsive.forward ? [item("forward", "Forward", "前进", { disabled: !canGoForward })] : []),
              ...(responsive.openExternal ? [item("open-external", "Open in browser", "在浏览器中打开", { disabled: !canOpenExternal })] : []),
              item("find", "Find in page", "在页面中查找", { separatorBefore: true, disabled: !actions.find }),
              item("zoom-in", "Zoom in", "放大", { disabled: !actions.zoomIn }),
              item("zoom-out", "Zoom out", "缩小", { disabled: !actions.zoomOut }),
              item("reset-zoom", "Reset zoom", "重置缩放", { disabled: !actions.resetZoom }),
              item("print", "Print", "打印", { disabled: !actions.print }),
              item("bookmarks", "Bookmarks", "书签", { separatorBefore: true }),
              item("history", "History", "历史"),
              item("downloads", "Downloads", "下载内容"),
              item("toggle-bookmarks-bar", "Show bookmarks bar", "显示书签栏", { checked: visible }),
              item("import", "Import browser data", "导入浏览器资料", { separatorBefore: true, disabled: !canImport }),
              item("clear-data", "Clear browsing data", "清除浏览数据"),
              item("settings", "Browser settings", "浏览器设置", { separatorBefore: true }),
            ],
          });
        }}
      >
        <MoreVertical size={15} />
      </button>
    );
  }

  const row = (
    id: string,
    icon: React.ReactNode,
    english: string,
    chinese: string,
    checked = false,
    disabled = false,
  ) => (
    <DropdownMenuItem
      className={itemCls(false)}
      disabled={disabled}
      onSelect={() => runBrowserAction(id, router, actions)}
    >
      {checked ? <Check size={14} aria-hidden="true" /> : icon}
      <span className="flex-1">{text(english, chinese)}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button ref={triggerRef} type="button" className={styles.webToolbarBtn} title={label} aria-label={label}>
          <MoreVertical size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={MENU_PANEL}>
        {row("new-tab", <Plus size={14} />, "New browser tab", "新建浏览器标签页")}
        {actions.collapseToPip
          ? row("collapse-to-pip", <PictureInPicture2 size={14} />, "Collapse to floating window", "收起到悬浮窗")
          : null}
        {responsive.home ? row("home", <House size={14} />, "Home", "主页", false, !canGoHome) : null}
        {responsive.forward ? row("forward", <ArrowRight size={14} />, "Forward", "前进", false, !canGoForward) : null}
        {responsive.openExternal ? row("open-external", <ExternalLink size={14} />, "Open in browser", "在浏览器中打开", false, !canOpenExternal) : null}
        <DropdownMenuSeparator className={MENU_SEPARATOR} />
        {row("find", <Search size={14} />, "Find in page", "在页面中查找", false, !actions.find)}
        {row("zoom-in", <ZoomIn size={14} />, "Zoom in", "放大", false, !actions.zoomIn)}
        {row("zoom-out", <ZoomOut size={14} />, "Zoom out", "缩小", false, !actions.zoomOut)}
        {row("reset-zoom", <RotateCcw size={14} />, "Reset zoom", "重置缩放", false, !actions.resetZoom)}
        {row("print", <Printer size={14} />, "Print", "打印", false, !actions.print)}
        <DropdownMenuSeparator className={MENU_SEPARATOR} />
        {row("bookmarks", <Bookmark size={14} />, "Bookmarks", "书签")}
        {row("history", <Clock3 size={14} />, "History", "历史")}
        {row("downloads", <Download size={14} />, "Downloads", "下载内容")}
        {row("toggle-bookmarks-bar", <span className="w-[14px]" />, "Show bookmarks bar", "显示书签栏", visible)}
        <DropdownMenuSeparator className={MENU_SEPARATOR} />
        {canImport ? row("import", <Import size={14} />, "Import browser data", "导入浏览器资料") : null}
        {row("clear-data", <Trash2 size={14} />, "Clear browsing data", "清除浏览数据")}
        <DropdownMenuSeparator className={MENU_SEPARATOR} />
        {row("settings", <Settings size={14} />, "Browser settings", "浏览器设置")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BookmarksLibraryButton() {
  const { text } = useTranslation();
  const openBuiltinTab = useCenterTabs((state) => state.openBuiltinTab);
  const label = text("Bookmarks", "书签");
  return (
    <button
      type="button"
      className={`${styles.webToolbarBtn} ${styles.webToolbarMedium}`}
      onClick={() => openBuiltinTab("bookmarks")}
      title={label}
      aria-label={label}
    >
      <Library size={14} />
    </button>
  );
}
