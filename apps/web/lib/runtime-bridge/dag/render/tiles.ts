/**
 * Renderer: node tiles (dag/rendering.md §4).
 *
 * Every node is a rounded tile with an icon, the same tile the execution
 * timeline draws beside each step: a call gets the icon and tone
 * `presentTool` gives it there, so "ran npm test" looks alike in the
 * transcript and on the graph. Conversation nodes get their own icons:
 * your message, a model reply, the session start, a sub-agent, a
 * compaction summary, a merge.
 *
 * The tile's colour comes from `--tone` (app/styles/tool-tones.css), set
 * by a `t-<tone>` class, so status, coverage and theme are CSS states of
 * the same element rather than repainted attributes.
 */

import { presentTool, type ToolTone } from "@/components/chat/messages/tool-presentation";
import { SOLAR_BODIES, SOLAR_VIEWBOXES, type SolarIconName } from "@/components/solar-icons/bodies";
import { translateText } from "@/lib/i18n";
import { type GNode } from "../types";
import { isSpawnRoot } from "../passes/thread";
import { _svg } from "./shapes";

export type TileTone = ToolTone | "user" | "llm" | "root";

export interface Tile {
  icon: SolarIconName;
  tone: TileTone;
  /** What the node does, for the agent's activity bubble. */
  doing: string;
  /** What the node did, for its caption on the canvas (render/captions.ts);
   *  empty for kinds that need none. */
  did?: string;
}

/** Half the tile's side. The grid (types.ts) leaves a gap of one tile
 *  between neighbours, so a belt between two tiles stays visible. */
export const TILE_R = 12;
const ICON = 18;

// The transcript names a call by what it did ("Ran", "Edited"); a bubble
// over a working agent says what it is doing. Chinese titles are plain
// verbs and read right either way.
const NOW: Record<string, string> = {
  "Analyzed image": "Analyzing image", Asked: "Asking", Edited: "Editing",
  "Executed code": "Executing code", Fetched: "Fetching", "Found files": "Finding files",
  "Generated image": "Generating image", "Handed to a new agent": "Handing to a new agent",
  "Inspected code": "Inspecting code", Listed: "Listing", Messaged: "Messaging",
  Patched: "Patching", "Ran program": "Running program", Ran: "Running",
  "Read conversation": "Reading conversation", Read: "Reading", Scheduled: "Scheduling",
  "Searched code": "Searching code", "Searched the web": "Searching the web",
  Searched: "Searching", Typed: "Typing", "Updated todos": "Updating todos",
  "Used skill": "Using skill", "Waited for output": "Waiting for output", Wrote: "Writing",
};

function toolName(node: GNode): string {
  return String(node.name || node.function || "");
}

export function tileFor(node: GNode): Tile {
  const record = node as Record<string, unknown>;
  if (node.display === "root") {
    return { icon: "home-2", tone: "root", doing: translateText("Starting", "开始") };
  }
  if (Array.isArray(record.covers_ids) || record.superseded_summary) {
    return { icon: "archive", tone: "memory", doing: translateText("Compacting", "压缩上下文") };
  }
  if (isSpawnRoot(node)) {
    return { icon: "ghost", tone: "agent", doing: translateText("Handing to an agent", "交给子 agent") };
  }
  if (node.function === "merge") {
    return { icon: "git-pull-request", tone: "plan", doing: translateText("Merging", "合并分支") };
  }
  if (node.function === "attach") {
    return { icon: "link", tone: "plan", doing: translateText("Attaching", "挂接分支") };
  }
  const isCall = node.role === "tool" || node.display === "runtime"
    || (node.role === "assistant" && !!node.function);
  if (isCall) {
    const input = typeof node.input === "string" ? node.input : undefined;
    const shown = presentTool(toolName(node), input, translateText);
    const title = NOW[shown.title] ?? shown.title;
    const doing = shown.target ? `${title} ${shown.target}` : title;
    const did = shown.target ? `${shown.title} ${shown.target}` : shown.title;
    return { icon: shown.icon, tone: shown.tone, doing, did };
  }
  if (node.role === "assistant" || node.role === "llm") {
    return { icon: "stars", tone: "llm", doing: translateText("Thinking…", "思考中…") };
  }
  const said = String(node.preview || "").replace(/\s+/g, " ").trim();
  return { icon: "user-rounded", tone: "user",
    doing: translateText("Reading your message", "读取你的消息"), did: said };
}

/** A short name for an agent that has none: the start of its task. */
export function taskLabel(root: GNode | undefined): string {
  const text = String(root?.preview || "").replace(/\s+/g, " ").trim();
  if (!text || text.startsWith("[")) return "";
  const chars = Array.from(text);
  return chars.length > 14 ? chars.slice(0, 13).join("") + "…" : text;
}

/** The tile group: a flat block and its icon. Running, the block
 *  breathes (app/styles/dag/nodes.css). */
export function buildTile(tile: Tile): SVGElement {
  const g = _svg("g", { class: `dag-tile t-${tile.tone}`, "pointer-events": "none" });
  // The plate hugs the icon, so a belt runs right up to it. Your own
  // messages are buttons you can press (fork, edit), so theirs is the
  // app's raised button: a full tile with a shadow (nodes.css).
  const raised = tile.tone === "user";
  const plate = raised ? TILE_R : ICON / 2 + 1;
  g.appendChild(_svg("rect", {
    x: -plate, y: -plate, width: plate * 2, height: plate * 2,
    rx: raised ? 7 : 5, ry: raised ? 7 : 5, "data-node-shape": "1", "data-shape": "tile",
  }));
  const box = SOLAR_VIEWBOXES[tile.icon] ?? "0 0 24 24";
  const size = raised ? ICON - 2 : ICON;
  const icon = _svg("svg", {
    x: -size / 2, y: -size / 2, width: size, height: size,
    viewBox: box, class: "dag-tile-icon", "aria-hidden": "true",
  });
  icon.innerHTML = SOLAR_BODIES[tile.icon];
  g.appendChild(icon);
  return g;
}
