import { describe, expect, it } from "vitest";
import {
  editFromProposal,
  isActionable,
  splitItems,
  upsertGeneration,
} from "./coordination";
import type { GenerationDto, ProposalDto } from "./types";

function proposal(overrides: Partial<ProposalDto> = {}): ProposalDto {
  return {
    tempId: "p1",
    title: "T",
    description: "D",
    acceptance: ["C"],
    assumptions: [],
    state: "pending",
    artifactId: null,
    ...overrides,
  };
}

function generation(id: string, stale = false): GenerationDto {
  return {
    id,
    projectId: "proy-1",
    moduleId: "mod-2",
    model: "muse-spark-1.3",
    description: "Ventas.",
    contextVersionIds: ["req-3-v1"],
    templateVersion: 1,
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    createdAt: "2026-10-27T12:00:00Z",
    stale,
    questions: [],
    proposals: [proposal()],
  };
}

describe("upsertGeneration", () => {
  it("appends the new generation at the end", () => {
    const next = upsertGeneration([generation("gen-1")], generation("gen-2"));
    expect(next.map((g) => g.id)).toEqual(["gen-1", "gen-2"]);
  });

  it("replaces in place on refresh", () => {
    const first = [generation("gen-1"), generation("gen-2")];
    const updated = generation("gen-1", true);
    const next = upsertGeneration(first, updated);
    expect(next.map((g) => g.id)).toEqual(["gen-1", "gen-2"]);
    expect(next[0].stale).toBe(true);
  });

  it("leaves generations from another mixed module alone", () => {
    const other = { ...generation("gen-9"), moduleId: "mod-8" };
    const next = upsertGeneration([other], generation("gen-1"));
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(other);
  });
});

describe("isActionable", () => {
  it("only when pending, fresh and idle", () => {
    expect(isActionable(proposal(), false, false)).toBe(true);
    expect(isActionable(proposal(), true, false)).toBe(false);
    expect(isActionable(proposal(), false, true)).toBe(false);
    expect(isActionable(proposal({ state: "accepted" }), false, false)).toBe(false);
    expect(isActionable(proposal({ state: "discarded" }), false, false)).toBe(false);
    expect(isActionable(proposal(), false, false, true)).toBe(false);
  });
});

describe("editFromProposal y splitItems", () => {
  it("converts criteria to text and back without losing them", () => {
    const edit = editFromProposal(
      proposal({ acceptance: ["Uno", "Dos"], assumptions: ["Tal vez"] }),
    );
    expect(edit.acceptance).toBe("Uno\nDos");
    expect(splitItems(edit.acceptance)).toEqual(["Uno", "Dos"]);
    expect(splitItems("  \nUno\n\n  \nDos\n")).toEqual(["Uno", "Dos"]);
    expect(splitItems("")).toEqual([]);
  });
});
