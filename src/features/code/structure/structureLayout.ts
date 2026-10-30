// Deterministic structure-graph layout: files in blocks (rows) and
// symbols in a grid inside their block. Pure and tested: the same
// input yields the same positions.
import type { StructureSymbol } from "./structureTypes";

export const STRUCT_COL_W = 264;
export const STRUCT_ROW_H = 156;
export const STRUCT_COLS = 4;
export const STRUCT_FILE_GAP = 48;

export function layoutStructure(symbols: StructureSymbol[]): Map<string, { x: number; y: number }> {
  const files: string[] = [];
  const byFile = new Map<string, StructureSymbol[]>();
  for (const symbol of symbols) {
    const key = `${symbol.rootId}::${symbol.rel}`;
    const list = byFile.get(key);
    if (list === undefined) {
      files.push(key);
      byFile.set(key, [symbol]);
    } else {
      list.push(symbol);
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const key of files) {
    const list = byFile.get(key) ?? [];
    list.forEach((symbol, index) => {
      const col = index % STRUCT_COLS;
      const row = Math.floor(index / STRUCT_COLS);
      positions.set(symbol.id, { x: col * STRUCT_COL_W, y: y + row * STRUCT_ROW_H });
    });
    const rows = Math.max(1, Math.ceil(list.length / STRUCT_COLS));
    y += rows * STRUCT_ROW_H + STRUCT_FILE_GAP;
  }
  return positions;
}

/** Drawable edges: only resolved relations between visible ones. */
export function drawableRelations(
  relations: Array<{ id: string; kind: string; from: string; to: string | null; status: string }>,
  visible: Set<string>,
): Array<{ id: string; kind: string; from: string; to: string }> {
  return relations
    .filter(
      (rel): rel is { id: string; kind: string; from: string; to: string; status: string } =>
        rel.status === "resolved" && rel.to !== null && visible.has(rel.from) && visible.has(rel.to),
    )
    .map((rel) => ({ id: rel.id, kind: rel.kind, from: rel.from, to: rel.to }));
}
