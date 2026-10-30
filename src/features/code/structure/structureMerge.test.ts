import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";
import { combineResults, emptyResult } from "./structureMerge";

describe("combineResults", () => {
  it("concatena y propaga truncados", () => {
    const a = analyzeTsFiles([
      { rootId: "root-1", rel: "a.ts", content: "export class A {}", hash: "h1" },
    ]);
    const empty = emptyResult();
    const merged = combineResults([a, empty]);
    expect(merged.files).toHaveLength(1);
    expect(merged.symbols.map((s) => s.name)).toEqual(["A"]);
    expect(merged.symbolsTruncated).toBe(false);
    expect(merged.limits).toEqual(a.limits);
  });
});
