// Proposal checks: what Ruth verified locally about a Muse
// proposal (syntax, scope, chain, freshness). Pure; no IO.
import { describe, expect, it } from "vitest";
import type { CodeGenerationDto, CodeProposalFileDto } from "../types";
import type { FlowGraph, FlowPending } from "./flowModel";
import type { ProposalOverlay } from "./proposalOverlay";
import { checkProposal } from "./proposalChecks";

function proposalFile(overrides: Partial<CodeProposalFileDto> = {}): CodeProposalFileDto {
  return {
    pos: 0,
    rootId: "r",
    rel: "a.ts",
    operation: "modify",
    state: "pending",
    decidedAt: null,
    content: "export class A {\n  run() { return 2; }\n}\n",
    expectedFingerprint: null,
    ...overrides,
  };
}

const GEN: CodeGenerationDto = {
  id: "gen-1",
  projectId: "p1",
  moduleId: "m1",
  requirementArtifactId: "req-1",
  requirementVersionId: "req-1-v1",
  screenArtifactId: "",
  screenId: "",
  screenVersionId: "",
  screenSources: [],
  model: "Meta Muse",
  templateVersion: 1,
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  createdAt: "t",
  explanation: "Adds the discount.",
  assumptions: ["In-memory stock."],
  questions: ["On reserve or on confirm?"],
  scope: [{ rootId: "r", rel: "a.ts", fingerprint: "h:a.ts" }],
  files: [proposalFile()],
  stale: false,
  staleReason: null,
};

const OVERLAY: ProposalOverlay = {
  projects: [],
  changes: new Map(),
  removed: [],
  notes: [],
};

const CHAIN: FlowGraph = {
  nodes: [],
  httpNodes: [],
  edges: [],
  pending: [],
  truncated: false,
};

const PENDING_NO_DESTINATION: FlowPending = {
  kind: "no-destination",
  label: "POST /usuarios",
  fromNode: "n",
  fromMember: null,
  evidence: "a.ts:1",
};

describe("checkProposal", () => {
  it("passes a clean proposal", () => {
    const checks = checkProposal(GEN, OVERLAY, CHAIN);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["syntax", "pass"],
      ["scope", "pass"],
      ["chain", "pass"],
      ["fresh", "pass"],
    ]);
  });

  it("fails syntax when a proposed file is partial", () => {
    const checks = checkProposal(GEN, { ...OVERLAY, notes: ["a.ts: partial syntax"] }, CHAIN);
    expect(checks.find((c) => c.id === "syntax")?.status).toBe("fail");
  });

  it("warns when a modified file was not in the scope sent to Meta", () => {
    const gen = { ...GEN, scope: [] };
    expect(checkProposal(gen, OVERLAY, CHAIN).find((c) => c.id === "scope")?.status).toBe("warn");
  });

  it("warns about a chain with pending links, naming them", () => {
    const graph = { ...CHAIN, pending: [PENDING_NO_DESTINATION] };
    const chain = checkProposal(GEN, OVERLAY, graph).find((c) => c.id === "chain")!;
    expect(chain.status).toBe("warn");
    expect(chain.detail).toContain("POST /usuarios");
  });

  it("fails freshness on a stale generation", () => {
    const gen = { ...GEN, stale: true, staleReason: "the context changed." };
    expect(checkProposal(gen, OVERLAY, CHAIN).find((c) => c.id === "fresh")?.status).toBe("fail");
  });

  it("never claims files it did not analyze", () => {
    const checks = checkProposal(GEN, { ...OVERLAY, notes: ["a.html: not analyzed"] }, CHAIN);
    const syntax = checks.find((c) => c.id === "syntax")!;
    expect(syntax.status).toBe("warn");
    expect(syntax.detail).toContain("a.html");
    expect(syntax.detail).not.toContain("All proposed files");
  });

  it("ignores discarded files in the scope check", () => {
    const gen = {
      ...GEN,
      scope: [],
      files: GEN.files.map((file) => ({ ...file, state: "discarded" })),
    };
    expect(checkProposal(gen, OVERLAY, CHAIN).find((c) => c.id === "scope")?.status).toBe("pass");
  });

  it("warns about changes the drawn chain does not cover", () => {
    const overlay = {
      ...OVERLAY,
      changes: new Map([
        ...OVERLAY.changes,
        ["r:other.ts:Other", { change: "added" as const, members: {} }],
      ]),
    };
    const chain = checkProposal(GEN, overlay, CHAIN).find((c) => c.id === "chain")!;
    expect(chain.status).toBe("warn");
    expect(chain.detail).toContain("Other");
  });
});

