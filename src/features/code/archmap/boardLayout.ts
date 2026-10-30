// Column-board layout math: layers become left-to-right columns and
// cards stack vertically with content-derived heights, in file and
// symbol projections alike. Pure and total: one pass positions cards
// and edge endpoints, so boxes and the SVG overlay share a single
// coordinate system with no DOM measuring. Card heights mirror the
// board CSS row constants exactly: keep both in sync (a mismatch
// clips card content instead of skewing edges).
import type { ArchLayer } from "./archLayers";
import type { ArchMapEdge, ArchMapFile, ArchMapNode, ArchMapSymbolEdge } from "./archModel";
import { BOARD_ZOOM_STEPS } from "./boardZoom";

/** Wide enough for long symbol and member names at 100% zoom. */
export const ARCH_CARD_W = 320;
export const ARCH_COL_GAP = 16;
export const ARCH_CARD_GAP = 12;
export const ARCH_COL_PAD_X = 10;
/** Column panel header: role tile, layer title and counters. */
export const ARCH_COL_HEAD_H = 48;
export const ARCH_COL_BOTTOM_PAD = 12;
/** Card rows (mirror the `.archboard-*` CSS heights). */
export const ARCH_CARD_PAD_Y = 8;
export const ARCH_CARD_BORDER = 2;
export const ARCH_HEAD_ROW_H = 24;
/** Symbol cards only: project chip, decorators and file under the head. */
export const ARCH_SUB_ROW_H = 20;
export const ARCH_META_ROW_H = 18;
export const ARCH_SYM_ROW_H = 22;
/**
 * One member slot: a 28px bordered row plus the 6px gap above it.
 * Rows are separate rectangles, never lines of text in a box.
 */
export const ARCH_MEM_ROW_H = 34;
/** Members toggle: 6px gap plus a 20px button. */
export const ARCH_MORE_ROW_H = 26;
export const ARCH_SYMBOLS_SHOWN = 3;

export const ARCH_COL_W = ARCH_CARD_W + ARCH_COL_PAD_X * 2;

export function fileKey(rootId: string, rel: string): string {
  return `${rootId}::${rel}`;
}

export interface BoardColumn {
  layer: ArchLayer;
  files: ArchMapFile[];
}

export interface SymbolColumn {
  layer: ArchLayer;
  nodes: ArchMapNode[];
}

/**
 * Per-board expansion. Keys are globally unique (`rootId::rel` for
 * files, `ts:root:rel#n` for symbols), so one expansion state can be
 * shared by every board of the view.
 */
export interface BoardExpansion {
  /** Files showing their whole symbol list. */
  allSymbols: Set<string>;
  /** Symbols showing their member rows. */
  openMembers: Set<string>;
}

export function emptyExpansion(): BoardExpansion {
  return { allSymbols: new Set(), openMembers: new Set() };
}

export interface ShownSymbols {
  shown: ArchMapFile["symbols"];
  /** Symbols left out (0 when the list is fully shown). */
  more: number;
}

export function shownSymbols(file: ArchMapFile, expansion: BoardExpansion): ShownSymbols {
  if (expansion.allSymbols.has(fileKey(file.rootId, file.rel))) {
    return { shown: file.symbols, more: 0 };
  }
  return {
    shown: file.symbols.slice(0, ARCH_SYMBOLS_SHOWN),
    more: Math.max(0, file.symbols.length - ARCH_SYMBOLS_SHOWN),
  };
}

export function openMemberCount(file: ArchMapFile, expansion: BoardExpansion): number {
  let count = 0;
  for (const symbol of file.symbols) {
    if (expansion.openMembers.has(symbol.id)) count += symbol.members.length;
  }
  return count;
}

/**
 * Deterministic symbol-card height: members open by default, one row
 * each, all of them (the extractor caps lists at 50). Wheel input
 * zooms the board, so cards grow instead of scrolling inside. Reference
 * cards (external module dependencies shown on request) render head,
 * sub line and meta only: no members, no toggle.
 */
export function symbolCardHeight(
  memberCount: number,
  collapsed: boolean,
  reference = false,
): number {
  const base =
    ARCH_CARD_PAD_Y * 2 + ARCH_CARD_BORDER + ARCH_HEAD_ROW_H + ARCH_SUB_ROW_H + ARCH_META_ROW_H;
  if (reference) return base;
  const area = memberCount === 0 || collapsed ? 0 : memberCount * ARCH_MEM_ROW_H;
  const toggle = memberCount === 0 ? 0 : ARCH_MORE_ROW_H;
  return base + area + toggle;
}

/** Deterministic card height from the rows actually rendered. */
export function cardHeight(file: ArchMapFile, expansion: BoardExpansion): number {
  const { shown } = shownSymbols(file, expansion);
  // The toggle row stays while the list is long ("Show all N" /
  // "Show less"), so it counts in both states.
  const toggleRow = file.symbols.length > ARCH_SYMBOLS_SHOWN ? ARCH_MORE_ROW_H : 0;
  return (
    ARCH_CARD_PAD_Y * 2 +
    ARCH_CARD_BORDER +
    ARCH_HEAD_ROW_H +
    ARCH_META_ROW_H +
    shown.length * ARCH_SYM_ROW_H +
    openMemberCount(file, expansion) * ARCH_MEM_ROW_H +
    toggleRow
  );
}

export interface CardPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ColumnPos {
  x: number;
  w: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  columns: ColumnPos[];
  cards: Map<string, CardPos>;
}

export function columnX(index: number): number {
  return index * (ARCH_COL_W + ARCH_COL_GAP);
}

export function layoutBoard(columns: BoardColumn[], expansion: BoardExpansion): BoardLayout {
  return stackCards(
    columns.map((column) => column.files),
    (file) => fileKey(file.rootId, file.rel),
    (file) => cardHeight(file, expansion),
  );
}

export function layoutSymbolBoard(
  columns: SymbolColumn[],
  collapsed: Set<string>,
  referenceIds: Set<string> = new Set(),
): BoardLayout {
  return stackCards(
    columns.map((column) => column.nodes),
    (node) => node.id,
    (node) =>
      symbolCardHeight(
        node.symbol.members.length,
        collapsed.has(node.id),
        referenceIds.has(node.id),
      ),
  );
}

function stackCards<T>(
  columns: T[][],
  keyOf: (item: T) => string,
  heightOf: (item: T) => number,
): BoardLayout {
  const cards = new Map<string, CardPos>();
  const positions: ColumnPos[] = columns.map((_, index) => ({
    x: columnX(index),
    w: ARCH_COL_W,
  }));
  // Cards stack below the header; the tallest stack sets the canvas.
  let tallest = ARCH_COL_HEAD_H + ARCH_CARD_GAP;
  columns.forEach((items, columnIndex) => {
    let y = ARCH_COL_HEAD_H + ARCH_CARD_GAP;
    items.forEach((item, itemIndex) => {
      if (itemIndex > 0) y += ARCH_CARD_GAP;
      const h = heightOf(item);
      cards.set(keyOf(item), {
        x: columnX(columnIndex) + ARCH_COL_PAD_X,
        y,
        w: ARCH_CARD_W,
        h,
      });
      y += h;
    });
    tallest = Math.max(tallest, y);
  });
  return {
    width:
      columns.length === 0
        ? 0
        : columns.length * ARCH_COL_W + (columns.length - 1) * ARCH_COL_GAP,
    height: tallest + ARCH_COL_BOTTOM_PAD,
    columns: positions,
    cards,
  };
}

/**
 * Edge path anchored to card borders. Cards in one column connect
 * vertically (bottom edge to top edge); cards in different columns
 * connect horizontally (facing side edges at mid height).
 */
export function edgePath(from: CardPos, to: CardPos): string {
  if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) {
    return `M ${from.x},${from.y}`;
  }
  if (from.x === to.x) {
    const upper = from.y < to.y ? from : to;
    const lower = from.y < to.y ? to : from;
    const x1 = upper.x + upper.w / 2;
    const y1 = upper.y + upper.h;
    const x2 = lower.x + lower.w / 2;
    const y2 = lower.y;
    const midY = (y1 + y2) / 2;
    return `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
  }
  const fromLeft = from.x < to.x;
  const x1 = fromLeft ? from.x + from.w : from.x;
  const y1 = from.y + from.h / 2;
  const x2 = fromLeft ? to.x : to.x + to.w;
  const y2 = to.y + to.h / 2;
  const bow = Math.max(24, Math.abs(x2 - x1) / 2);
  const c1x = fromLeft ? x1 + bow : x1 - bow;
  const c2x = fromLeft ? x2 - bow : x2 + bow;
  return `M ${x1},${y1} C ${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
}

/**
 * Where an edge's label sits. Between neighboring columns (or cards
 * of one column) it is the midpoint between the anchored ends of
 * `edgePath`. An edge spanning several columns runs behind the cards
 * in between, so its label moves to the gap beside the target column
 * instead of landing on an unrelated card.
 */
export function edgeMidpoint(from: CardPos, to: CardPos): { x: number; y: number } {
  if (from.x === to.x) {
    const upper = from.y < to.y ? from : to;
    const lower = from.y < to.y ? to : from;
    return { x: upper.x + upper.w / 2, y: (upper.y + upper.h + lower.y) / 2 };
  }
  const fromLeft = from.x < to.x;
  const x1 = fromLeft ? from.x + from.w : from.x;
  const x2 = fromLeft ? to.x : to.x + to.w;
  const neighbors = Math.abs(x2 - x1) <= ARCH_COL_GAP + ARCH_COL_PAD_X * 2;
  if (!neighbors) {
    const beside = ARCH_COL_GAP / 2 + ARCH_COL_PAD_X;
    return { x: fromLeft ? x2 - beside : x2 + beside, y: to.y + to.h / 2 };
  }
  return { x: (x1 + x2) / 2, y: (from.y + from.h / 2 + to.y + to.h / 2) / 2 };
}

export interface BoardEdgeOpts {
  incoming: boolean;
  outgoing: boolean;
  /** 1: direct neighborhood; 2: plus one context hop. */
  depth: 1 | 2;
}

export const DEFAULT_EDGE_OPTS: BoardEdgeOpts = { incoming: true, outgoing: true, depth: 1 };

/**
 * Edges drawn for a selection. Without a selection nothing is drawn
 * (cards alone, no spaghetti). Depth 1 keeps the direct neighborhood
 * filtered by direction; depth 2 adds the context edges around it.
 */
export function visibleBoardEdges(
  edges: ArchMapEdge[],
  visibleKeys: Set<string>,
  selectedKey: string | null,
  opts: BoardEdgeOpts,
): ArchMapEdge[] {
  return neighborhood(
    edges,
    (edge) => ({
      id: edge.id,
      from: fileKey(edge.rootId, edge.fromRel),
      to: fileKey(edge.rootId, edge.toRel),
    }),
    visibleKeys,
    selectedKey,
    opts,
  );
}

/** Same neighborhood over symbol edges (endpoints are symbol ids). */
export function visibleSymbolEdges(
  edges: ArchMapSymbolEdge[],
  visibleIds: Set<string>,
  selectedId: string | null,
  opts: BoardEdgeOpts,
): ArchMapSymbolEdge[] {
  return neighborhood(
    edges,
    (edge) => ({ id: edge.id, from: edge.from, to: edge.to }),
    visibleIds,
    selectedId,
    opts,
  );
}

function neighborhood<T>(
  edges: T[],
  endsOf: (edge: T) => { id: string; from: string; to: string },
  visible: Set<string>,
  selected: string | null,
  opts: BoardEdgeOpts,
): T[] {
  if (selected === null) return [];
  const inScope = edges.filter((edge) => {
    const ends = endsOf(edge);
    return visible.has(ends.from) && visible.has(ends.to);
  });
  const direct = inScope.filter((edge) => {
    const ends = endsOf(edge);
    if (ends.from === selected && ends.to === selected) return opts.incoming || opts.outgoing;
    if (ends.from === selected) return opts.outgoing;
    if (ends.to === selected) return opts.incoming;
    return false;
  });
  if (opts.depth === 1) return direct;
  const near = new Set<string>([selected]);
  for (const edge of direct) {
    const ends = endsOf(edge);
    near.add(ends.from);
    near.add(ends.to);
  }
  const seen = new Set(direct.map((edge) => endsOf(edge).id));
  const context = inScope.filter((edge) => {
    const ends = endsOf(edge);
    if (seen.has(ends.id)) return false;
    return near.has(ends.from) || near.has(ends.to);
  });
  return [...direct, ...context];
}

/**
 * Largest zoom step fitting the canvas in the viewport. Falls back to
 * the smallest step when even that overflows (scroll remains) and to
 * 100% when sizes are unknown.
 */
export function fitZoomStep(
  canvasW: number,
  canvasH: number,
  viewW: number,
  viewH: number,
): number {
  if (!(canvasW > 0 && canvasH > 0 && viewW > 0 && viewH > 0)) return 1;
  const ratio = Math.min(viewW / canvasW, viewH / canvasH);
  let best: number = BOARD_ZOOM_STEPS[0];
  for (const step of BOARD_ZOOM_STEPS) {
    if (step <= ratio) best = step;
  }
  return best;
}

/**
 * Scroll offset keeping the content point under the cursor stable
 * across a zoom change (one axis; apply to both).
 */
export function anchoredScroll(
  prevZoom: number,
  nextZoom: number,
  scroll: number,
  cursor: number,
): number {
  if (!(prevZoom > 0 && nextZoom > 0)) return scroll;
  return Math.max(0, (scroll + cursor) * (nextZoom / prevZoom) - cursor);
}
