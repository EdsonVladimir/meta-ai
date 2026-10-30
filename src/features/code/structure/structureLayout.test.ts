import { describe, expect, it } from "vitest";
import { drawableRelations, layoutStructure } from "./structureLayout";
import type { StructureSymbol } from "./structureTypes";

function symbol(id: string, rootId: string, rel: string): StructureSymbol {
  return {
    id,
    language: "ts",
    kind: "class",
    name: id,
    rootId,
    rel,
    range: { startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    members: [],
    membersTruncated: false,
    heuristic: null,
  };
}

describe("layoutStructure", () => {
  it("groups by file on a deterministic grid", () => {
    const symbols = [
      symbol("a1", "root-1", "a.ts"),
      symbol("a2", "root-1", "a.ts"),
      symbol("b1", "root-1", "b.ts"),
    ];
    const first = layoutStructure(symbols);
    const second = layoutStructure(symbols);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get("a1")).toEqual({ x: 0, y: 0 });
    expect(first.get("a2")).toEqual({ x: 264, y: 0 });
    // Another file: next block, no overlap.
    expect(first.get("b1")).toEqual({ x: 0, y: 156 + 48 });
  });
});

describe("drawableRelations", () => {
  it("only resolved ones between visible", () => {
    const relations = [
      { id: "r1", kind: "extends", from: "a", to: "b", status: "resolved" },
      { id: "r2", kind: "references", from: "a", to: null, status: "unresolved" },
      { id: "r3", kind: "references", from: "a", to: "c", status: "resolved" },
    ];
    expect(drawableRelations(relations, new Set(["a", "b"]))).toEqual([
      { id: "r1", kind: "extends", from: "a", to: "b" },
    ]);
  });
});
