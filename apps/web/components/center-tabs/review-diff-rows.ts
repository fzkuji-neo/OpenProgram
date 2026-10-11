/** What the Review pane shows of a file's diff, as plain data so tests
 *  can load it without the React renderer. */
import { parseUnifiedDiff, type DiffLine } from "../chat/messages/unified-diff-parse.ts";
import { fileCapabilities, fileExtension } from "../../lib/documents/file-formats.ts";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const FILE_HEADER = /^(---|\+\+\+|diff |index |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/;

/** "Lines 1–232" for a hunk, counted on the side that has lines. */
export function hunkRange(header: string): { from: number; to: number; context: string } | null {
  const match = HUNK.exec(header);
  if (!match) return null;
  const oldStart = Number(match[1]);
  const oldLength = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newLength = match[4] === undefined ? 1 : Number(match[4]);
  const [start, length] = newLength > 0 ? [newStart, newLength] : [oldStart, oldLength];
  return { from: start, to: start + Math.max(length, 1) - 1, context: match[5].trim() };
}

/** Rows worth showing: the pane's file header already names the file. */
export function reviewRows(diff: string): DiffLine[] {
  return parseUnifiedDiff(diff).filter((row) => row.kind !== "meta" || !FILE_HEADER.test(row.text));
}

/** Files that read better rendered than as a diff: documents and images. */
export function canPreview(file: { path: string; op?: string }): boolean {
  if (file.op === "delete") return false;
  if (["md", "markdown", "mdx"].includes(fileExtension(file.path))) return true;
  const kind = fileCapabilities(file.path).preview;
  return kind === "image" || kind === "pdf";
}
