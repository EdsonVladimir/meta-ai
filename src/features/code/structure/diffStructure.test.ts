import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";
import { diffIsEmpty, diffStructure } from "./diffStructure";
import { STRUCTURE_LIMITS } from "./structureTypes";
import type { StructureInput, StructureResult } from "./structureTypes";

function input(rootId: string, rel: string, content: string): StructureInput {
  return { rootId, rel, content, hash: `${content.length}:x` };
}

const LIMITS = STRUCTURE_LIMITS;

function empty(): StructureResult {
  return {
    files: [],
    symbols: [],
    relations: [],
    endpoints: [],
    calls: [],
    symbolsTruncated: false,
    relationsTruncated: false,
    endpointsTruncated: false,
    callsTruncated: false,
    limits: LIMITS,
  };
}

describe("diffStructure", () => {
  it("empty against empty shows nothing", () => {
    const diff = diffStructure(empty(), empty());
    expect(diffIsEmpty(diff)).toBe(true);
    expect(diff.unionsBefore).toBe(0);
    expect(diff.unionsAfter).toBe(0);
    expect(diff.samples).toEqual([]);
  });

  it("detects new symbols, endpoints and unions by content", () => {
    const before = analyzeTsFiles([input("root-1", "s.ts", "export class A {}\n")]);
    const after = analyzeTsFiles([
      input(
        "root-1",
        "s.ts",
        `export class A {}\nexport class B {}\napp.get("/users", h);\nfetch("/users");\n`,
      ),
    ]);
    const diff = diffStructure(before, after);
    expect(diff.symbolsAdded).toBe(1);
    expect(diff.symbolsRemoved).toBe(0);
    expect(diff.endpointsAdded).toBe(1);
    expect(diff.callsAdded).toBe(1);
    expect(diff.unionsBefore).toBe(0);
    expect(diff.unionsAfter).toBe(1);
    expect(diffIsEmpty(diff)).toBe(false);
    expect(diff.samples.join("\n")).toContain("GET /users");
  });

  it("reordering the file shows no changes (content keys)", () => {
    const a = `export class A {}\nexport class B {}\n`;
    const b = `export class B {}\nexport class A {}\n`;
    const diff = diffStructure(
      analyzeTsFiles([input("root-1", "s.ts", a)]),
      analyzeTsFiles([input("root-1", "s.ts", b)]),
    );
    expect(diffIsEmpty(diff)).toBe(true);
  });

  it("null does not break and counts removals", () => {
    expect(diffIsEmpty(diffStructure(null, empty()))).toBe(true);
    const before = analyzeTsFiles([input("root-1", "s.ts", "export class A {}\n")]);
    const diff = diffStructure(before, empty());
    expect(diff.symbolsRemoved).toBe(1);
    expect(diff.samples).toHaveLength(1);
  });
});
