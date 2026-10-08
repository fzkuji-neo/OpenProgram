"use client";

/**
 * User message bubble — React port of legacy `addUserMessage` markup.
 * Plain text content (escaped); user turns are never markdown-rendered.
 *
 * The hover action bar is the React <MessageActions />; the pencil
 * swaps the content into an inline editor that POSTs `/api/chat/edit`
 * (a React port of legacy `message-actions-edit.js`).
 */
import { useState } from "react";

import { useSessionStore, type ChatMsg } from "@/lib/session-store";
import { useTranslation } from "@/lib/i18n";
import { Avatar } from "@/components/avatar";
import { useUserProfile } from "@/lib/prefs/user-profile";

import { MessageActions } from "./message-actions";
import { useAvatarAlign } from "./use-avatar-align";
import { AttachmentChips, parseAttachments } from "./user-attachments";
import { MessageEditor } from "./message-editor";

export function UserBubble({ msg, sessionIdOverride }: { msg: ChatMsg; sessionIdOverride?: string }) {
  const focusedSessionId = useSessionStore(s => s.currentSessionId);
  const sessionId = sessionIdOverride ?? focusedSessionId;
  const { text } = useTranslation();
  const [editing, setEditing] = useState(false);
  const profile = useUserProfile();

  // Pull attachment markers out of the prose so they render as chips
  // (Claude-Code style) instead of raw "[attached: …]" / inlined <file>
  // text. msg.content itself is untouched — this is display-only.
  const { attachments, text: cleanText } = parseAttachments(msg.content);

  // Align the side avatar to the first line of text inside the bubble.
  const { containerRef, avatarTop } = useAvatarAlign(
    `${msg.id}:${msg.content?.length || 0}:${editing}`,
  );

  return (
    <div
      ref={containerRef}
      className={"message user" + (editing ? " is-editing" : "")}
      data-msg-id={msg.id}
      /* Same per-turn article semantics as the assistant bubble, so
         screen-reader users can step through the transcript turn by
         turn and hear who is speaking. */
      role="article"
      aria-label={profile.name || text("User", "用户")}
    >
      <div className="message-header" style={{ top: avatarTop }}>
        {/* "You" avatar + name — from the local user profile
            (/settings/general → You), the counterpart to the agent
            profile. Defaults to a DiceBear glyph seeded "you" so it
            looks identical until the user customises it. */}
        <Avatar
          className="message-avatar user-avatar"
          size={28}
          radius={8}
          name={profile.name}
          config={profile.avatar}
        />
        <div className="message-sender">{profile.name || text("User", "用户")}</div>
      </div>
      <div className="message-content">
        {editing ? (
          <MessageEditor msg={msg} sessionId={sessionId} onDone={() => setEditing(false)} />
        ) : (
          <>
            <AttachmentChips sessionId={sessionId} items={attachments} />
            {cleanText}
          </>
        )}
      </div>
      {/* Action row at the bottom-right of the user bubble (mirrors the
          assistant's bottom-left). */}
      {!editing ? (
        <div className="message-actions-footer">
          <MessageActions sessionIdOverride={sessionIdOverride} msg={msg} onEdit={() => setEditing(true)} />
        </div>
      ) : null}
    </div>
  );
}
