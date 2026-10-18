import type { ProgramKind } from "./programs-logic";

export type ProgramExplorerEntry = {
  name: string;
  path: string;
  kind: "folder" | "file";
  entity_kind?: "package";
  source_path?: string;
  program_kind: ProgramKind | null;
  has_children: boolean;
  logic_path?: string | null;
  description?: string;
  callable_name?: string;
  /** User workflows: load state, error, and what to do next. */
  workflow_state?: "loaded" | "pending" | "error";
  workflow_error?: string;
  workflow_note?: string;
};

export function programInvocationName(
  entry: { name: string; callable_name?: string } | null | undefined,
): string {
  return entry?.callable_name || entry?.name || "";
}
