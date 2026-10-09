"use client";

/**
 * Composer text field with markdown live preview (CodeMirror 6).
 *
 * The document IS the markdown the user sends — formatting is drawn over
 * it and syntax markers hide unless the caret touches them — so the draft,
 * history recall, slash commands, @file mentions and paste tokens keep
 * working on plain string offsets. Those hooks were written against a
 * <textarea>; `textareaRef` receives a small facade with the subset they
 * use (value, selectionStart/End, setSelectionRange, focus, blur,
 * getBoundingClientRect), and key/paste events reach them shaped like
 * React textarea events.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type React from "react";
import { Annotation, EditorSelection, EditorState, Prec } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";

import { composerMarkdown, livePreviewRanges } from "@/lib/chat/markdown-live-preview";

/** Marks a dispatch that mirrors the `value` prop, so it isn't echoed back. */
const External = Annotation.define<boolean>();

export interface ComposerInputHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  focus(): void;
  blur(): void;
  getBoundingClientRect(): DOMRect;
  /** Viewport coordinates of a document offset (for caret-anchored menus). */
  coordsAt(pos: number): { left: number; top: number; bottom: number } | null;
  /** Autosize writes land here harmlessly; CSS caps the editor height. */
  style: Record<string, string>;
  scrollHeight: number;
}

function decorations(view: EditorView): DecorationSet {
  const ranges = livePreviewRanges(view.state);
  const all = [];
  for (const line of ranges.lines) {
    all.push(Decoration.line({ class: `cm-md-line-${line.kind}` }).range(line.from));
  }
  for (const mark of ranges.marks) {
    if (mark.to > mark.from) all.push(Decoration.mark({ class: `cm-md-${mark.kind}` }).range(mark.from, mark.to));
  }
  let lastHiddenEnd = -1;
  for (const hidden of ranges.hidden) {
    // Replace decorations may not overlap.
    if (hidden.to > hidden.from && hidden.from >= lastHiddenEnd) {
      all.push(Decoration.replace({}).range(hidden.from, hidden.to));
      lastHiddenEnd = hidden.to;
    }
  }
  return Decoration.set(all, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = decorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Smallest single change turning `prev` into `next`, so the caret maps
 *  through external edits (file pick, paste token) instead of resetting. */
function diff(prev: string, next: string) {
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < max - start
    && prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
  ) end++;
  return { from: start, to: prev.length - end, insert: next.slice(start, next.length - end) };
}

function keyEvent(e: KeyboardEvent, target: ComposerInputHandle) {
  return {
    key: e.key,
    code: e.code,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    repeat: e.repeat,
    nativeEvent: e,
    currentTarget: target,
    target,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
    get defaultPrevented() { return e.defaultPrevented; },
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
}

function clipboardEvent(e: ClipboardEvent, target: ComposerInputHandle) {
  return {
    clipboardData: e.clipboardData,
    nativeEvent: e,
    currentTarget: target,
    target,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
    get defaultPrevented() { return e.defaultPrevented; },
  } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
}

export interface MarkdownEditorProps {
  value: string;
  onChange(value: string, caret: number): void;
  onCaret(caret: number): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void;
  onFocus(): void;
  onBlur(): void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  id: string;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Handlers change every render; the editor reads the latest via a ref.
  const live = useRef(props);
  live.current = props;
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let facade: ComposerInputHandle;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: live.current.value,
        selection: EditorSelection.cursor(live.current.value.length),
        extensions: [
          composerMarkdown,
          livePreview,
          history(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            id: live.current.id,
            "aria-label": live.current.ariaLabel,
            "aria-multiline": "true",
            "data-composer-input": "",
            spellcheck: "true",
          }),
          // Composer handlers run first and may claim the key (Enter to
          // send, arrows for menus / history); otherwise CodeMirror edits.
          Prec.highest(EditorView.domEventHandlers({
            keydown(e) {
              live.current.onKeyDown(keyEvent(e, facade));
              return e.defaultPrevented;
            },
            paste(e) {
              live.current.onPaste(clipboardEvent(e, facade));
              return e.defaultPrevented;
            },
            focus() { live.current.onFocus(); },
            blur() { live.current.onBlur(); },
          })),
          keymap.of([
            { key: "Enter", run: insertNewline },
            { key: "Shift-Enter", run: insertNewline },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            const caret = update.state.selection.main.head;
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
              live.current.onChange(update.state.doc.toString(), caret);
            } else if (update.selectionSet || update.docChanged) {
              live.current.onCaret(caret);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    facade = {
      get value() { return view.state.doc.toString(); },
      get selectionStart() { return view.state.selection.main.from; },
      get selectionEnd() { return view.state.selection.main.to; },
      setSelectionRange(start: number, end: number) {
        // A caller may set the caret right after setInput, before the new
        // value reaches the editor; apply it once the value lands.
        const len = view.state.doc.length;
        if (live.current.value !== view.state.doc.toString() || start > len || end > len) {
          pendingSelection.current = [start, end];
          if (start > len || end > len) return;
        }
        view.dispatch({
          selection: EditorSelection.range(Math.min(start, len), Math.min(end, len)),
          scrollIntoView: true,
        });
      },
      focus() { view.focus(); },
      blur() { view.contentDOM.blur(); },
      getBoundingClientRect() { return view.dom.getBoundingClientRect(); },
      coordsAt(pos: number) {
        const rect = view.coordsAtPos(Math.min(pos, view.state.doc.length));
        return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
      },
      style: {},
      scrollHeight: 0,
    };
    (props.textareaRef as React.MutableRefObject<unknown>).current = facade;
    (view.contentDOM as HTMLElement & { composerInput?: ComposerInputHandle }).composerInput = facade;
    if (live.current.autoFocus) view.focus();
    return () => {
      (props.textareaRef as React.MutableRefObject<unknown>).current = null;
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; prop changes flow through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror external value changes (draft switch, history recall, slash
  // pick, file pick) into the editor as one minimal change.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const pending = pendingSelection.current;
    if (current === props.value) {
      if (pending) {
        pendingSelection.current = null;
        const len = view.state.doc.length;
        view.dispatch({ selection: EditorSelection.range(Math.min(pending[0], len), Math.min(pending[1], len)) });
      }
      return;
    }
    const change = diff(current, props.value);
    pendingSelection.current = null;
    const len = props.value.length;
    // An external edit at the caret (file pick, paste token, recall) leaves
    // the caret after the inserted text, as typing would.
    const head = view.state.selection.main.head;
    const afterInsert = change.from + change.insert.length;
    const selection = pending
      ? EditorSelection.range(Math.min(pending[0], len), Math.min(pending[1], len))
      : head >= change.from && head <= change.to
        ? EditorSelection.cursor(afterInsert)
        : undefined;
    view.dispatch({
      changes: change,
      selection,
      annotations: External.of(true),
      scrollIntoView: true,
    });
  }, [props.value]);

  return <div ref={hostRef} className={props.className} />;
}
