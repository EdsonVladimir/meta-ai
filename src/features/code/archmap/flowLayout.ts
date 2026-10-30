// Flow board layout: columns ordered by first appearance along the
// chain (project plus layer, one HTTP column per hop, pending last),
// cards stacked with content-derived heights reusing the board row
// constants, and one vertical anchor per chain member row.
import { ARCH_LAYER_BY_ID } from "./archLayers";
import {
  ARCH_CARD_BORDER,
  ARCH_CARD_GAP,
  ARCH_CARD_PAD_Y,
  ARCH_CARD_W,
  ARCH_COL_BOTTOM_PAD,
  ARCH_COL_GAP,
  ARCH_COL_HEAD_H,
  ARCH_COL_PAD_X,
  ARCH_COL_W,
  ARCH_HEAD_ROW_H,
  ARCH_MEM_ROW_H,
  ARCH_META_ROW_H,
  ARCH_MORE_ROW_H,
  ARCH_SUB_ROW_H,
  columnX,
  type CardPos,
} from "./boardLayout";
import { memberRole } from "./memberRoles";
import type { FlowGraph, FlowNode } from "./flowModel";

export interface FlowLayout {
  width: number;
  height: number;
  columns: Array<{ key: string; label: string; x: number; w: number }>;
  cards: Map<string, CardPos>;
  /** `${nodeId}::${member}` to the row's vertical center. */
  rowY: Map<string, number>;
}

/** Gap above the 28px row inside its `ARCH_MEM_ROW_H` slot. */
const MEM_ROW_GAP = 6;

/** Layout key of the i-th pending box. */
export function pendingBoxKey(index: number): string {
  return `pending:${index}`;
}

/** Signal accesses of one chain member, as display lines ("writes reservas"). */
export function memberSignalLines(node: FlowNode, member: string): string[] {
  return (node.symbol.flow?.signals ?? [])
    .filter((access) => access.member === member)
    .map((access) => `${access.access === "write" ? "writes" : "reads"} ${access.signal}`);
}

/** Role-method members of the symbol that are not on the chain. */
export function hiddenMethodCount(node: FlowNode): number {
  return node.symbol.members.filter(
    (member) => memberRole(member, node.symbol) === "method" && !node.members.includes(member.name),
  ).length;
}

function nodeCardHeight(node: FlowNode): number {
  const signals = node.members.reduce(
    (sum, member) => sum + memberSignalLines(node, member).length,
    0,
  );
  return (
    ARCH_CARD_PAD_Y * 2 +
    ARCH_CARD_BORDER +
    ARCH_HEAD_ROW_H +
    ARCH_SUB_ROW_H +
    ARCH_META_ROW_H +
    node.members.length * ARCH_MEM_ROW_H +
    signals * ARCH_META_ROW_H +
    (hiddenMethodCount(node) > 0 ? ARCH_MORE_ROW_H : 0)
  );
}

/** Head, sub and meta rows, no members: verb and URL, via, interceptors and guards. */
const HTTP_CARD_H =
  ARCH_CARD_PAD_Y * 2 + ARCH_CARD_BORDER + ARCH_HEAD_ROW_H + ARCH_SUB_ROW_H + ARCH_META_ROW_H;

/** Head and meta rows: the pending title and its label. */
const PENDING_BOX_H =
  ARCH_CARD_PAD_Y * 2 + ARCH_CARD_BORDER + ARCH_HEAD_ROW_H + ARCH_META_ROW_H;

interface ColumnCard {
  key: string;
  height: number;
  depth: number;
  order: number;
}

interface ColumnBuild {
  key: string;
  label: string;
  minDepth: number;
  order: number;
  cards: ColumnCard[];
}

export function layoutFlowBoard(graph: FlowGraph): FlowLayout {
  const columns: ColumnBuild[] = [];
  const byKey = new Map<string, ColumnBuild>();
  const columnFor = (key: string, label: string): ColumnBuild => {
    const found = byKey.get(key);
    if (found !== undefined) return found;
    const column: ColumnBuild = { key, label, minDepth: Infinity, order: columns.length, cards: [] };
    columns.push(column);
    byKey.set(key, column);
    return column;
  };
  graph.nodes.forEach((node, index) => {
    const column = columnFor(
      `${node.projectKey}::${node.layer}`,
      `${node.projectLabel} · ${ARCH_LAYER_BY_ID[node.layer].label}`,
    );
    column.minDepth = Math.min(column.minDepth, node.depth);
    column.cards.push({ key: node.id, height: nodeCardHeight(node), depth: node.depth, order: index });
  });
  graph.httpNodes.forEach((http, hop) => {
    const column = columnFor(`http:${http.id}`, "HTTP");
    column.minDepth = Math.min(column.minDepth, http.depth);
    column.cards.push({ key: http.id, height: HTTP_CARD_H, depth: http.depth, order: hop });
  });
  if (graph.pending.length > 0) {
    const column = columnFor("pending", "Pending");
    graph.pending.forEach((_, index) => {
      column.cards.push({ key: pendingBoxKey(index), height: PENDING_BOX_H, depth: 0, order: index });
    });
  }
  const ordered = [...columns].sort((a, b) => a.minDepth - b.minDepth || a.order - b.order);
  const cards = new Map<string, CardPos>();
  const rowY = new Map<string, number>();
  let tallest = ARCH_COL_HEAD_H + ARCH_CARD_GAP;
  ordered.forEach((column, columnIndex) => {
    let y = ARCH_COL_HEAD_H + ARCH_CARD_GAP;
    const items = [...column.cards].sort((a, b) => a.depth - b.depth || a.order - b.order);
    items.forEach((item, itemIndex) => {
      if (itemIndex > 0) y += ARCH_CARD_GAP;
      cards.set(item.key, {
        x: columnX(columnIndex) + ARCH_COL_PAD_X,
        y,
        w: ARCH_CARD_W,
        h: item.height,
      });
      y += item.height;
    });
    tallest = Math.max(tallest, y);
  });
  const topInset = ARCH_CARD_BORDER / 2 + ARCH_CARD_PAD_Y;
  for (const node of graph.nodes) {
    const card = cards.get(node.id);
    if (card === undefined) continue;
    let y = card.y + topInset + ARCH_HEAD_ROW_H + ARCH_SUB_ROW_H + ARCH_META_ROW_H;
    for (const member of node.members) {
      rowY.set(`${node.id}::${member}`, y + MEM_ROW_GAP + (ARCH_MEM_ROW_H - MEM_ROW_GAP) / 2);
      y += ARCH_MEM_ROW_H + memberSignalLines(node, member).length * ARCH_META_ROW_H;
    }
  }
  return {
    width:
      ordered.length === 0
        ? 0
        : ordered.length * ARCH_COL_W + (ordered.length - 1) * ARCH_COL_GAP,
    height: tallest + ARCH_COL_BOTTOM_PAD,
    columns: ordered.map((column, index) => ({
      key: column.key,
      label: column.label,
      x: columnX(index),
      w: ARCH_COL_W,
    })),
    cards,
    rowY,
  };
}
