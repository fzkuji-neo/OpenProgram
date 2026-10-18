"use client";

/**
 * The right-click menu of every terminal view: Copy, Paste where the view
 * takes input, and "Add selection to chat", as Codex's terminal has.
 */
import { useState, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ClipboardPaste, Copy, MessageSquarePlus } from "lucide-react";
import type { Terminal } from "@xterm/xterm";

import { appendToComposer } from "@/components/chat/messages/quote-to-chat";
import { MENU_ITEM_STATES, MENU_PANEL, MENU_SEPARATOR, itemCls } from "@/components/chat/top-bar/menu-styles";
import { useSidebarMenu } from "@/components/sidebar/use-sidebar-menu";
import { targetChat } from "@/lib/chat/target-chat";
import { terminalSelectionText } from "@/lib/chat/terminal-selection";
import { showToast } from "@/lib/format-utils/toast";
import { useTranslation } from "@/lib/i18n";

const MENU_ITEM = `${itemCls(false)} ${MENU_ITEM_STATES}`;

export function TerminalContextMenu({ terminal, onPaste, canPaste = true, onClose, children }: {
  terminal: () => Terminal | null | undefined;
  /** Omitted for read-only views. */
  onPaste?: () => void;
  canPaste?: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const { text } = useTranslation();
  const menu = useSidebarMenu();
  const [selection, setSelection] = useState("");

  const copy = () => {
    if (selection) void navigator.clipboard.writeText(selection).catch(() => showToast(text("Clipboard copy failed", "复制到剪贴板失败")));
  };
  const addToChat = () => {
    if (!selection.trim()) return;
    const chat = targetChat();
    if (!chat) {
      showToast(text("Open a conversation to add the selection to", "先打开一个对话，再加入选中内容"));
      return;
    }
    appendToComposer(chat.key, terminalSelectionText(selection), false);
    showToast(chat.title
      ? text(`Selection added to the message in “${chat.title}”`, `选中内容已加入“${chat.title}”的消息`)
      : text("Selection added to your message", "选中内容已加入消息"));
  };

  return (
    <Menu.Root open={menu.open} onOpenChange={menu.onOpenChange}>
      <Menu.Trigger asChild>
        <span aria-hidden="true" style={{ position: "fixed", left: menu.point.x, top: menu.point.y, width: 0, height: 0, pointerEvents: "none" }} />
      </Menu.Trigger>
      <div style={{ display: "contents" }} onContextMenu={(event) => {
        // xterm has already applied its right-click word selection by now.
        setSelection(terminal()?.getSelection() ?? "");
        menu.show(event, []);
      }}>
        {children}
      </div>
      <Menu.Portal>
        <Menu.Content side="bottom" align="start" sideOffset={2}
          onCloseAutoFocus={(event) => { event.preventDefault(); onClose?.(); }}
          className={`${MENU_PANEL} min-w-[200px]`}>
          <Menu.Item className={MENU_ITEM} disabled={!selection} onSelect={copy}>
            <Copy size={14} aria-hidden="true" />{text("Copy", "复制")}
          </Menu.Item>
          {onPaste && (
            <Menu.Item className={MENU_ITEM} disabled={!canPaste} onSelect={onPaste}>
              <ClipboardPaste size={14} aria-hidden="true" />{text("Paste", "粘贴")}
            </Menu.Item>
          )}
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Item className={MENU_ITEM} disabled={!selection.trim()} onSelect={addToChat}>
            <MessageSquarePlus size={14} aria-hidden="true" />{text("Add selection to chat", "把选中内容加入对话")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
