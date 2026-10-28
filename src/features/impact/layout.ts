// Trazado determinista del grafo de impacto: capas por profundidad desde
// el origen, nodos sin duplicar y truncado explícito. Puro y probado; el
// componente SVG solo dibuja estas coordenadas.
import { MAX_GRAPH_NODES } from "./coordination";

export type ImpactNodeStatus = "origin" | "pending" | "awaiting" | "updated";

export interface ImpactGraphNode {
  id: string;
  kind: string;
  /** Título vigente, solo presentación (la identidad es el ID). */
  title: string | null;
  status: ImpactNodeStatus;
  depth: number;
  x: number;
  y: number;
}

export interface ImpactGraphEdge {
  from: string;
  to: string;
}

export interface ImpactGraphLayout {
  nodes: ImpactGraphNode[];
  edges: ImpactGraphEdge[];
  shown: number;
  total: number;
  truncated: boolean;
  width: number;
  height: number;
}

export const NODE_W = 176;
export const NODE_H = 54;
export const GAP_X = 64;
export const GAP_Y = 22;

export interface LayoutInput {
  originId: string;
  originKind: string;
  originTitle: string | null;
  /** Afectados con su estado calculado por el núcleo. */
  affected: {
    id: string;
    kind: string;
    requiresReview: boolean;
    awaitingApproval?: boolean;
    title: string | null;
  }[];
  /** Caminos de artefactos desde el origen hasta cada afectado. */
  paths: string[][];
}

export function layoutImpactGraph(input: LayoutInput): ImpactGraphLayout {
  const state = new Map<
    string,
    { kind: string; requiresReview: boolean; awaitingApproval?: boolean; title: string | null }
  >();
  for (const item of input.affected) {
    if (!state.has(item.id)) state.set(item.id, item);
  }

  // Aristas deduplicadas en dirección del impacto (fuente → dependiente).
  const edgeKeys = new Set<string>();
  const edges: ImpactGraphEdge[] = [];
  for (const path of input.paths) {
    for (let i = 0; i + 1 < path.length; i += 1) {
      const key = `${path[i]}\n${path[i + 1]}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: path[i], to: path[i + 1] });
    }
  }
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));

  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    const list = successors.get(edge.from) ?? [];
    list.push(edge.to);
    successors.set(edge.from, list);
  }
  for (const list of successors.values()) list.sort();

  // Profundidad por BFS desde el origen; los inalcanzables (no debería
  // haberlos: todo afectado llega por un camino) van a la última capa.
  const depth = new Map<string, number>([[input.originId, 0]]);
  const queue: string[] = [input.originId];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    const next = (depth.get(node) as number) + 1;
    for (const dep of successors.get(node) ?? []) {
      if (!depth.has(dep)) {
        depth.set(dep, next);
        queue.push(dep);
      }
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const byId = new Map<string, ImpactGraphNode>();
  const allIds = new Set<string>([input.originId]);
  for (const item of input.affected) allIds.add(item.id);
  for (const path of input.paths) for (const id of path) allIds.add(id);
  // Orden BFS estable: origen primero, luego por (profundidad, id).
  const ordered = [...allIds].sort((a, b) => {
    const da = depth.get(a) ?? maxDepth + 1;
    const db = depth.get(b) ?? maxDepth + 1;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const total = ordered.length;
  const shownIds = ordered.slice(0, MAX_GRAPH_NODES);
  const shown = new Set(shownIds);
  const layers = new Map<number, string[]>();
  for (const id of shownIds) {
    const d = depth.get(id) ?? maxDepth + 1;
    const layer = layers.get(d) ?? [];
    layer.push(id);
    layers.set(d, layer);
  }
  const layerIndex = new Map<number, number>();
  [...layers.keys()].sort((a, b) => a - b).forEach((d, i) => layerIndex.set(d, i));
  for (const [d, ids] of layers) {
    const col = layerIndex.get(d) as number;
    ids.forEach((id, row) => {
      const info = state.get(id);
      byId.set(id, {
        id,
        kind: id === input.originId ? input.originKind : (info?.kind ?? "requirement"),
        title: id === input.originId ? input.originTitle : (info?.title ?? null),
        status:
          id === input.originId
            ? "origin"
            : info?.requiresReview === true
              ? "pending"
              : info?.awaitingApproval === true
                ? "awaiting"
                : "updated",
        depth: d,
        x: col * (NODE_W + GAP_X),
        y: row * (NODE_H + GAP_Y),
      });
    });
  }

  const nodes = shownIds.map((id) => byId.get(id) as ImpactGraphNode);
  const visibleEdges = edges.filter((e) => shown.has(e.from) && shown.has(e.to));
  const cols = layerIndex.size;
  const rows = Math.max(1, ...[...layers.values()].map((ids) => ids.length));
  return {
    nodes,
    edges: visibleEdges,
    shown: nodes.length,
    total,
    truncated: total > nodes.length,
    width: cols * NODE_W + Math.max(0, cols - 1) * GAP_X,
    height: rows * NODE_H + Math.max(0, rows - 1) * GAP_Y,
  };
}
