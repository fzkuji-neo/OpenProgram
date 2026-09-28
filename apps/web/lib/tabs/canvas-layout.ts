/** Serializable layout geometry. Content remains owned by the tab store. */
export type LayoutNode =
  | { kind: "pane"; id: string; content: string | null }
  | { kind: "split"; id: string; dir: "row" | "col"; children: LayoutNode[]; sizes: number[] };
export type CanvasLayout = { root: LayoutNode; focusedPaneId: string; zoomedPaneId?: string };
export type CanvasSide = "left" | "right" | "top" | "bottom" | "center";
export type CanvasPreset = "1x1" | "1x2" | "2x1" | "main+2" | "2x2" | "3x3" | "4x4";
export type Rect = { left: number; top: number; width: number; height: number };

const CANVAS_GAP = 6;

export function canvasViewport(width: number, height: number): Rect {
  const padding = CANVAS_GAP;
  return { left: padding, top: padding, width: Math.max(0, width - padding * 2), height: Math.max(0, height - padding * 2) };
}
const id = () => `canvas:${crypto.randomUUID()}`;
export const pane = (content: string | null = null): LayoutNode => ({ kind: "pane", id: id(), content });
export const leaves = (node: LayoutNode): Extract<LayoutNode, { kind: "pane" }>[] => node.kind === "pane" ? [node] : node.children.flatMap(leaves);
/** A single member keeps its layout only while other (empty) panes remain. */
export const holdsLayout = (canvas: CanvasLayout | undefined) => !!canvas && leaves(canvas.root).length > 1;
export function mapNode(node: LayoutNode, target: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  return node.id === target ? fn(node) : node.kind === "pane" ? node : { ...node, children: node.children.map(c => mapNode(c, target, fn)) };
}
export function normalizeNode(node: LayoutNode): LayoutNode {
  if (node.kind === "pane") return node;
  const children: LayoutNode[] = [], sizes: number[] = [];
  const weights = node.children.map((_, i) => Number.isFinite(node.sizes[i]) && node.sizes[i] > 0 ? node.sizes[i] : 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  node.children.forEach((child, i) => {
    const n = normalizeNode(child), weight = weights[i] / total;
    if (n.kind === "split" && n.dir === node.dir) {
      children.push(...n.children); sizes.push(...n.sizes.map(s => weight * s));
    } else { children.push(n); sizes.push(weight); }
  });
  if (!children.length) return pane();
  if (children.length === 1) return children[0];
  return { ...node, children, sizes };
}
export function rowLayout(contents: string[], ratio = 0.5): CanvasLayout {
  const children = contents.map(pane);
  const root = normalizeNode({ kind: "split", id: id(), dir: "row", children,
    sizes: children.length === 2 ? [ratio, 1 - ratio] : children.map(() => 1) });
  return { root, focusedPaneId: leaves(root)[0].id };
}
export function sanitizeLayout(layout: CanvasLayout, alive: Set<string>): CanvasLayout {
  const seen = new Set<string>();
  function visit(n: LayoutNode): LayoutNode {
    if (n.kind === "split") return { ...n, children: n.children.map(visit) };
    const content = n.content && alive.has(n.content) && !seen.has(n.content) ? n.content : null;
    if (content) seen.add(content);
    return { ...n, content };
  }
  const root = normalizeNode(visit(layout.root)), ids = leaves(root).map(p => p.id);
  return { root, focusedPaneId: ids.includes(layout.focusedPaneId) ? layout.focusedPaneId : ids[0],
    zoomedPaneId: ids.includes(layout.zoomedPaneId ?? "") ? layout.zoomedPaneId : undefined };
}
export function removePane(root: LayoutNode, paneId: string): LayoutNode {
  function remove(n: LayoutNode): LayoutNode | null {
    if (n.id === paneId) return null;
    if (n.kind === "pane") return n;
    const remaining = n.children.map(remove), weights = [...n.sizes];
    remaining.forEach((child, i) => {
      if (child) return;
      let neighbor = remaining.findIndex((c, j) => !!c && j > i);
      if (neighbor < 0) neighbor = remaining.findLastIndex(c => !!c);
      if (neighbor >= 0) weights[neighbor] += weights[i];
    });
    const children = remaining.filter((c): c is LayoutNode => c !== null);
    const sizes = weights.filter((_,i) => remaining[i] !== null);
    return children.length ? normalizeNode({ ...n, children, sizes }) : null;
  }
  return remove(root) ?? pane();
}
export function insertPane(root: LayoutNode, targetId: string, side: CanvasSide, content: string | null): { root: LayoutNode; paneId: string } {
  const added = pane(content);
  if (side === "center") return { root: mapNode(root, targetId, n => n.kind === "pane" ? { ...n, content } : n), paneId: targetId };
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  const next = mapNode(root, targetId === "root" ? root.id : targetId, n => ({ kind: "split", id: id(), dir,
    children: before ? [added, n] : [n, added], sizes: [0.5, 0.5] }));
  return { root: normalizeNode(next), paneId: added.id };
}
export function presetLayout(preset: CanvasPreset, contents: string[]): CanvasLayout {
  const split = (dir: "row" | "col", children: LayoutNode[], sizes = children.map(() => 1)): LayoutNode => ({ kind: "split", id: id(), dir, children, sizes });
  let root: LayoutNode;
  if (preset === "main+2") root = split("row", [pane(), split("col", [pane(), pane()])], [0.58, 0.42]);
  else { const [rows, cols] = preset.split("x").map(Number); root = split("col", Array.from({ length: rows }, () => split("row", Array.from({ length: cols }, () => pane())))); }
  root = normalizeNode(root);
  leaves(root).forEach((p, i) => { p.content = contents[i] ?? null; });
  return { root, focusedPaneId: leaves(root)[0].id };
}
export function equalize(root: LayoutNode): LayoutNode {
  return root.kind === "pane" ? root : { ...root, children: root.children.map(equalize), sizes: root.children.map(() => 1 / root.children.length) };
}
export function resizeSplit(root: LayoutNode, splitId: string, index: number, delta: number): LayoutNode {
  return mapNode(root, splitId, n => {
    if (n.kind !== "split" || index < 0 || index >= n.sizes.length - 1) return n;
    const sizes = [...n.sizes], sum = sizes[index] + sizes[index + 1];
    const minimum = Math.min(0.02, sum / 4);
    sizes[index] = Math.min(sum - minimum, Math.max(minimum, sizes[index] + delta)); sizes[index + 1] = sum - sizes[index];
    return { ...n, sizes };
  });
}
export function canvasGeometry(root: LayoutNode, rect: Rect) {
  const panes = new Map<string, Rect>();
  const dividers: Array<Rect & { splitId: string; index: number; dir: "row" | "col"; span: number; sizes: number[] }> = [];
  function visit(n: LayoutNode, r: Rect) {
    if (n.kind === "pane") { panes.set(n.id, r); return; }
    const horizontal = n.dir === "row", span = Math.max(0, (horizontal ? r.width : r.height) - CANVAS_GAP * (n.children.length - 1));
    let offset = 0;
    n.children.forEach((child, i) => {
      const length = span * n.sizes[i];
      visit(child, horizontal ? { ...r, left: r.left + offset, width: length } : { ...r, top: r.top + offset, height: length });
      offset += length;
      if (i < n.children.length - 1) dividers.push({ ...(horizontal ? { ...r, left: r.left + offset, width: CANVAS_GAP } : { ...r, top: r.top + offset, height: CANVAS_GAP }), splitId: n.id, index: i, dir: n.dir, span, sizes: n.sizes });
      offset += CANVAS_GAP;
    });
  }
  visit(root, rect); return { panes, dividers };
}
