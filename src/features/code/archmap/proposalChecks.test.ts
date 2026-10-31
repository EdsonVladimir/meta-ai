// Proposal checks: what Ruth verified locally about a Muse
// proposal (syntax, scope, chain, freshness). Pure; no IO.
import { describe, expect, it } from "vitest";
import type { CodeGenerationDto, CodeProposalFileDto } from "../types";
import type { ArchLayer } from "./archLayers";
import type { FlowChange, FlowEdge, FlowGraph, FlowNode, FlowPending } from "./flowModel";
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

  function node(id: string, layer: ArchLayer, change?: FlowChange): FlowNode {
    return {
      id,
      projectKey: "p",
      projectLabel: "P",
      symbol: {
        id,
        language: "ts",
        kind: "class",
        name: id,
        rootId: "r",
        rel: "a.ts",
        range: { startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
        members: [],
        membersTruncated: false,
        heuristic: null,
      },
      layer,
      members: [],
      depth: 0,
      change,
    };
  }

  function edge(fromNode: string, toNode: string): FlowEdge {
    return {
      id: `${fromNode}>${toNode}`,
      kind: "call",
      fromNode,
      fromMember: null,
      toNode,
      toMember: null,
      order: 0,
      evidence: "test",
    };
  }

  function graph(nodes: FlowNode[], edges: FlowEdge[]): FlowGraph {
    return { nodes, httpNodes: [], edges, pending: [], truncated: false };
  }

  it("warns when a proposed component skips the project's store", () => {
    const g = graph(
      [
        node("new-ui", "ui", "added"),
        node("svc", "services"),
        node("old-ui", "ui"),
        node("store", "state"),
        node("svc2", "services"),
      ],
      [edge("new-ui", "svc"), edge("old-ui", "store"), edge("store", "svc2")],
    );
    const checks = checkProposal(GEN, OVERLAY, g);
    expect(checks.find((c) => c.id === "layers")).toEqual({
      id: "layers",
      label: "Layers",
      status: "warn",
      detail: "This component calls the service directly; the project uses a store.",
    });
  });

  it("stays silent unless the graph proves both facts", () => {
    // Direct call but no store chain in the project.
    const noStore = graph([node("new-ui", "ui", "added"), node("svc", "services")], [
      edge("new-ui", "svc"),
    ]);
    expect(checkProposal(GEN, OVERLAY, noStore).find((c) => c.id === "layers")).toBeUndefined();
    // The analysis proves what the chain on screen cannot show.
    expect(checkProposal(GEN, OVERLAY, noStore, true).find((c) => c.id === "layers")?.status).toBe(
      "warn",
    );
    // Store chain but the direct call is pre-existing, not proposed.
    const settled = graph(
      [node("old-ui", "ui"), node("svc", "services"), node("store", "state"), node("svc2", "services")],
      [edge("old-ui", "svc"), edge("old-ui", "store"), edge("store", "svc2")],
    );
    expect(checkProposal(GEN, OVERLAY, settled).find((c) => c.id === "layers")).toBeUndefined();
    // A store chain through a proposed node proves nothing about the project.
    const proposedStore = graph(
      [node("new-ui", "ui", "added"), node("svc", "services"), node("store", "state", "added")],
      [edge("new-ui", "svc"), edge("new-ui", "store")],
    );
    expect(
      checkProposal(GEN, OVERLAY, proposedStore).find((c) => c.id === "layers"),
    ).toBeUndefined();
    // No graph, no proof.
    expect(checkProposal(GEN, OVERLAY, null).find((c) => c.id === "layers")).toBeUndefined();
    expect(checkProposal(GEN, OVERLAY, null)).toHaveLength(4);
  });
});

