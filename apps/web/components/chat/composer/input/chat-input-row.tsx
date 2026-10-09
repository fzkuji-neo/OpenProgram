"use client";

/**
 * Chat-mode input row inside the composer wrapper.
 *
 * Stacks paste chips, the markdown editor (a textarea-compatible facade,
 * see markdown-editor.tsx), and the @-mention file
 * popover into one cohesive block. Extracted from composer/index.tsx
 * so the main file stops growing every time a new chip kind or
 * caret-tracking handler lands on the textarea.
 *
 * Pure presentation — every piece of state (input, caret, paste store,
 * file menu) comes through props, owned by the composer.
 */
import type React from "react";

import { FileMenu, type FileMatch } from "../attach/file-menu";
import { useFileMention } from "../attach/use-file-mention";
import { PasteChips } from "../paste/paste-chips";
import { MarkdownEditor } from "./markdown-editor";
import type { PastedEntry } from "../paste/paste-store";
import styles from "./chat-input-row.module.css";

interface ChatInputRowProps {
  /* ---- textarea ---------------------------------------------------- */
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: (s: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  setCaretPos: (n: number) => void;
  /** Placeholder hint (e.g. "type to steer the running task…" while busy). */
  placeholder?: string;
  /** DOM id for the textarea. Defaults to the singleton
   *  "composer-chat-input"; a split-view pane passes a per-session id so
   *  two mounted composers don't collide on one id. */
  inputId?: string;
  autoFocus?: boolean;

  /* ---- paste chips ------------------------------------------------- */
  pastedEntries: PastedEntry[];
  pasteMissing: Set<number>;
  removePaste: (id: number) => void;

  /* ---- @-mention file popover -------------------------------------- */
  atToken: ReturnType<typeof useFileMention>["atToken"];
  fileMatches: FileMatch[];
  fileMenuIndex: number;
  setFileMenuIndex: (n: number | ((prev: number) => number)) => void;
  fileMenuLoading: boolean;
  fileMenuPos: { left: number; top: number; bottom?: number } | null;
  pickFile: (item: FileMatch) => void;
}

export function ChatInputRow({
  textareaRef,
  input,
  setInput,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur,
  setCaretPos,
  placeholder,
  inputId = "composer-chat-input",
  autoFocus,
  pastedEntries,
  pasteMissing,
  removePaste,
  atToken,
  fileMatches,
  fileMenuIndex,
  setFileMenuIndex,
  fileMenuLoading,
  fileMenuPos,
  pickFile,
}: ChatInputRowProps) {
  return (
    <>
      <PasteChips
        entries={pastedEntries}
        missing={pasteMissing}
        onRemove={removePaste}
      />
      <div key="top-half" className={styles.inputTopRow}>
        <div className={styles.inputField}>
          {input.length === 0 && (
            <span className={styles.chatPlaceholder} aria-hidden="true">
              {placeholder || "create / run / edit or ask anything... (type / for commands)"}
            </span>
          )}
          <MarkdownEditor
            textareaRef={textareaRef}
            id={inputId}
            autoFocus={autoFocus}
            ariaLabel={placeholder || "create / run / edit or ask anything... (type / for commands)"}
            className={styles.chatInput}
            value={input}
            onChange={(next, caret) => {
              setInput(next);
              setCaretPos(caret);
            }}
            onCaret={setCaretPos}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            // File drops are caught at the window level (see
            // useComposerAttachments), so the editor needs no drop handler.
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </div>
        <FileMenu
          items={fileMatches}
          selectedIndex={fileMenuIndex}
          position={atToken ? fileMenuPos : null}
          onHover={setFileMenuIndex}
          onPick={pickFile}
          loading={fileMenuLoading}
          query={atToken?.partial ?? ""}
        />
      </div>
    </>
  );
}
