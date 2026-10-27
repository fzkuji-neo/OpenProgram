/**
 * Renderer: agent tokens (dag/rendering.md §4).
 *
 * Every agent that is working stands on the tile it is working on: a
 * round token with its initial in its branch colour, and beside the tile
 * a bubble saying what it is doing ("Main agent · Ran npm test"). With
 * nothing running, the main agent's token rests on HEAD without a bubble.
 *
 * The layer is rebuilt from the node DOM, so the in-place status patch
 * (render/nodes.ts) repaints it without a full render.
 */

import { translateText } from "@/lib/i18n";
import { type GNode } from "../types";
import { _branchColor, _svg, _textWidth } from "./shapes";
import { TILE_R, tileFor } from "./tiles";

const LAYER = "dag-agents";
const BUBBLE_FONT = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif";
const BUBBLE_MAX = 260;

type NodeG = SVGGElement & { _nodeData?: GNode };

function agentName(g: Element, nodeG: Element): string {
  const own = g.getAttribute("data-spawn-name");
  if (own) return own;
  const owner = g.getAttribute("data-owner");
  if (owner) {
    const ownerG = nodeG.querySelector(`.history-node[data-msg-id="${CSS.escape(owner)}"]`);
    const name = ownerG?.getAttribute("data-spawn-name");
    if (name) return name;
  }
  return translateText("Main agent", "主 agent");
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

function bubble(x: number, y: number, label: string): SVGElement {
  let text = label;
  while (_textWidth(text, BUBBLE_FONT) > BUBBLE_MAX && text.length > 2) {
    text = text.slice(0, -2) + "…";
  }
  const w = Math.ceil(_textWidth(text, BUBBLE_FONT)) + 16;
  const b = _svg("g", { class: "dag-agent-bubble", transform: `translate(${x},${y})` });
  b.appendChild(_svg("rect", { x: 0, y: -10, width: w, height: 20, rx: 6, ry: 6 }));
  const t = _svg("text", { x: 8, y: 4 });
  t.textContent = text;
  b.appendChild(t);
  return b;
}

/** Rebuild the token layer above ``nodeG`` from the nodes' current state. */
export function paintAgents(nodeG: Element): void {
  const world = nodeG.parentNode;
  if (!world) return;
  world.querySelector(`:scope > g.${LAYER}`)?.remove();
  const layer = _svg("g", { class: LAYER, "pointer-events": "none" });
  const running = Array.from(nodeG.querySelectorAll<NodeG>(".history-node.is-running"));
  // One token per agent: an agent shown on two running tiles (a turn and
  // its call) stands on the later one, the step it is actually on.
  const byAgent = new Map<string, NodeG>();
  for (const g of running) byAgent.set(agentName(g, nodeG), g);
  for (const [name, g] of byAgent) {
    const at = seat(g);
    const node = g._nodeData;
    if (!at || !node) continue;
    layer.appendChild(token(at.x - TILE_R, at.y - TILE_R, name, _branchColor(node)));
    layer.appendChild(bubble(at.x + TILE_R + 10, at.y, `${name} · ${tileFor(node).doing}`));
  }
  if (!byAgent.size) {
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
