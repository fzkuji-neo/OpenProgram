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
}

/** Half the tile's side. The grid (types.ts) leaves a gap of one tile
 *  between neighbours, so a belt between two tiles stays visible. */
export const TILE_R = 12;
const ICON = 15;

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
    return { icon: "bot", tone: "agent", doing: translateText("Handing to an agent", "交给子 agent") };
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
    const doing = shown.target ? `${shown.title} ${shown.target}` : shown.title;
    return { icon: shown.icon, tone: shown.tone, doing };
  }
  if (node.role === "assistant" || node.role === "llm") {
    return { icon: "stars", tone: "llm", doing: translateText("Thinking…", "思考中…") };
  }
  return { icon: "chat-round-line", tone: "user", doing: translateText("Reading your message", "读取你的消息") };
}

/** The tile group: frame, icon and the running comet that orbits it. */
export function buildTile(tile: Tile): SVGElement {
  const g = _svg("g", { class: `dag-tile t-${tile.tone}`, "pointer-events": "none" });
  g.appendChild(_svg("rect", {
    x: -TILE_R, y: -TILE_R, width: TILE_R * 2, height: TILE_R * 2,
    rx: 7, ry: 7, "data-node-shape": "1", "data-shape": "tile",
  }));
  // Running: a short arc travelling round the frame (CSS animates it).
  g.appendChild(_svg("rect", {
    x: -TILE_R - 2.5, y: -TILE_R - 2.5, width: TILE_R * 2 + 5, height: TILE_R * 2 + 5,
    rx: 9, ry: 9, pathLength: 100, class: "dag-tile-orbit",
  }));
  const box = SOLAR_VIEWBOXES[tile.icon] ?? "0 0 24 24";
  const icon = _svg("svg", {
    x: -ICON / 2, y: -ICON / 2, width: ICON, height: ICON,
    viewBox: box, class: "dag-tile-icon", "aria-hidden": "true",
  });
  icon.innerHTML = SOLAR_BODIES[tile.icon];
  g.appendChild(icon);
  return g;
}
