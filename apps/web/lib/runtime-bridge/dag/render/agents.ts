/**
 * Renderer: agent tokens (dag/rendering.md §4).
 *
 * Every agent that is working stands on the step it is working on: a
 * round token with its initial in its branch colour, and beside the tile
 * a bubble saying what it is doing ("Main agent · Ran npm test"). With
 * nothing running, the main agent's token rests on HEAD without a bubble.
 *
 * Agents are read from the whole graph, not from the tiles on screen: a
 * running call folded into its turn's count still names what the agent
 * is doing, and its token stands on the nearest tile that is drawn. A
 * node belongs to the sub-agent whose spawn root its chain leads back
 * to, else to the main agent.
 *
 * The layer is rebuilt from the graph and the node DOM, so the in-place
 * status patch (render/nodes.ts) repaints it without a full render.
 */

import { translateText } from "@/lib/i18n";
import { type GNode } from "../types";
import { isSpawnRoot } from "../passes/thread-nodes";
import { _branchColor, _svg, _textWidth } from "./shapes";
import { TILE_R, tileFor } from "./tiles";

const LAYER = "dag-agents";
const BUBBLE_FONT = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif";
const BUBBLE_MAX = 260;
const BUBBLE_H = 20;
const MAIN = "";

type NodeG = SVGGElement & { _nodeData?: GNode };

interface Worker {
  agent: string;
  node: GNode;
  order: number;
}

function parentOf(n: GNode): string | null {
  const p = n.predecessor || n.caller;
  return p && p !== "ROOT" ? p : null;
}

/** The spawn root ``n`` works under, or MAIN. */
function agentOf(n: GNode, byId: Record<string, GNode>): string {
  let cur: GNode | undefined = n;
  for (let i = 0; cur && i < 10000; i++) {
    if (isSpawnRoot(cur)) return cur.id;
    const p = parentOf(cur);
    cur = p ? byId[p] : undefined;
  }
  return MAIN;
}

/** The tile ``n`` is drawn on: its own, or the nearest drawn ancestor's. */
function seatOf(n: GNode, byId: Record<string, GNode>, drawn: Map<string, NodeG>): NodeG | null {
  let cur: GNode | undefined = n;
  for (let i = 0; cur && i < 10000; i++) {
    const g = drawn.get(cur.id);
    if (g) return g;
    const p = parentOf(cur);
    cur = p ? byId[p] : undefined;
  }
  return null;
}

function agentName(agent: string, byId: Record<string, GNode>, drawn: Map<string, NodeG>): string {
  if (agent === MAIN) return translateText("Main agent", "主 agent");
  const shown = drawn.get(agent)?.getAttribute("data-spawn-name");
  if (shown) return shown;
  const root = byId[agent] as Record<string, unknown> | undefined;
  const label = (root?.spawned_from as { label?: string } | undefined)?.label
    || (root?.branch_name as string | undefined);
  return label?.trim() || translateText("Sub-agent", "子 agent");
}

function seat(g: Element): { x: number; y: number } | null {
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform") || "");
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function token(x: number, y: number, name: string, color: string): SVGElement {
  const t = _svg("g", { class: "dag-agent-token", transform: `translate(${x},${y})` });
  t.appendChild(_svg("circle", { r: 8, fill: color, class: "dag-agent-disc" }));
  const letter = _svg("text", { class: "dag-agent-letter", "text-anchor": "middle", y: 3.5 });
  letter.textContent = Array.from(name.trim())[0]?.toUpperCase() || "A";
  t.appendChild(letter);
  return t;
}

function bubble(x: number, y: number, label: string, color: string): SVGElement {
  let text = label;
  while (_textWidth(text, BUBBLE_FONT) > BUBBLE_MAX && text.length > 2) {
    text = text.slice(0, -2) + "…";
  }
  const w = Math.ceil(_textWidth(text, BUBBLE_FONT)) + 22;
  const b = _svg("g", { class: "dag-agent-bubble", transform: `translate(${x},${y})` });
  b.appendChild(_svg("rect", { x: 0, y: -BUBBLE_H / 2, width: w, height: BUBBLE_H, rx: 6, ry: 6 }));
  // The agent's colour as a dot, so a bubble reads back to its token.
  b.appendChild(_svg("circle", { cx: 9, cy: 0, r: 3, fill: color, class: "dag-agent-bubble-dot" }));
  const t = _svg("text", { x: 16, y: 4 });
  t.textContent = text;
  b.appendChild(t);
  return b;
}

/** Rebuild the token layer above ``nodeG`` from ``graph``'s running nodes. */
export function paintAgents(nodeG: Element, graph: GNode[]): void {
  const world = nodeG.parentNode;
  if (!world) return;
  world.querySelector(`:scope > g.${LAYER}`)?.remove();
  const layer = _svg("g", { class: LAYER, "pointer-events": "none" });

  const byId: Record<string, GNode> = Object.create(null);
  graph.forEach((n) => { byId[n.id] = n; });
  const drawn = new Map<string, NodeG>();
  nodeG.querySelectorAll<NodeG>(".history-node").forEach((g) => {
    const id = g.getAttribute("data-msg-id");
    if (id) drawn.set(id, g);
  });

  // One token per agent, on the step it started last: a running call
  // outranks the running turn that made it.
  const latest = new Map<string, Worker>();
  graph.forEach((n, i) => {
    if ((n as Record<string, unknown>).status !== "running") return;
    const agent = agentOf(n, byId);
    const order = Number(n.created_at) || i;
    const prev = latest.get(agent);
    if (!prev || order >= prev.order) latest.set(agent, { agent, node: n, order });
  });

  // Agents folded onto the same tile stack their bubbles under each other.
  const onSeat = new Map<NodeG, number>();
  for (const w of latest.values()) {
    const g = seatOf(w.node, byId, drawn);
    const at = g ? seat(g) : null;
    if (!g || !at) continue;
    const k = onSeat.get(g) || 0;
    onSeat.set(g, k + 1);
    const name = agentName(w.agent, byId, drawn);
    const color = _branchColor(w.node);
    layer.appendChild(token(at.x - TILE_R - k * 12, at.y - TILE_R, name, color));
    layer.appendChild(bubble(at.x + TILE_R + 10, at.y + k * (BUBBLE_H + 4),
      `${name} · ${tileFor(w.node).doing}`, color));
  }
  if (!latest.size) {
    const head = nodeG.querySelector<NodeG>(".history-node.is-head");
    const at = head ? seat(head) : null;
    if (head?._nodeData && at) {
      layer.appendChild(token(at.x - TILE_R, at.y - TILE_R, translateText("Main agent", "主 agent"),
        _branchColor(head._nodeData)));
      layer.lastElementChild?.classList.add("is-idle");
    }
  }
  world.appendChild(layer);
}
