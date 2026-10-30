// Proposal checks: what Ruth verified locally about a Muse
// proposal (syntax, scope, chain, freshness). Pure; no IO.
import type { CodeGenerationDto } from "../types";
import type { FlowGraph } from "./flowModel";
import type { ProposalOverlay } from "./proposalOverlay";

export interface ProposalCheck {
  id: "syntax" | "scope" | "chain" | "fresh";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export function checkProposal(
  generation: CodeGenerationDto,
  overlay: ProposalOverlay,
  graph: FlowGraph | null,
): ProposalCheck[] {
  return [
    checkSyntax(overlay),
    checkScope(generation),
    checkChain(graph, overlay),
    checkFresh(generation),
  ];
}

function checkSyntax(overlay: ProposalOverlay): ProposalCheck {
  const partial = overlay.notes.filter((note) => note.toLowerCase().includes("partial"));
  if (partial.length > 0) {
    return { id: "syntax", label: "Syntax", status: "fail", detail: partial.join("; ") };
  }
  // Anything else in the notes never went through the parser.
  if (overlay.notes.length > 0) {
    return { id: "syntax", label: "Syntax", status: "warn", detail: overlay.notes.join("; ") };
  }
  return { id: "syntax", label: "Syntax", status: "pass", detail: "All proposed files parsed." };
}

function checkScope(generation: CodeGenerationDto): ProposalCheck {
  const sent = new Set(generation.scope.map((entry) => `${entry.rootId}::${entry.rel}`));
  const outside = generation.files
    .filter(
      (file) =>
        file.operation === "modify" &&
        file.state !== "discarded" &&
        !sent.has(`${file.rootId}::${file.rel}`),
    )
    .map((file) => file.rel);
  if (outside.length > 0) {
    return {
      id: "scope",
      label: "Scope",
      status: "warn",
      detail: `Modified without sending to Meta: ${outside.join(", ")}.`,
    };
  }
  return {
    id: "scope",
    label: "Scope",
    status: "pass",
    detail: "Every modified file was sent to Meta.",
  };
}

function checkChain(graph: FlowGraph | null, overlay: ProposalOverlay): ProposalCheck {
  if (graph === null) {
    return { id: "chain", label: "Chain", status: "warn", detail: "No chain on screen." };
  }
  if (graph.pending.length > 0) {
    const names = graph.pending.map((item) => item.label).join(", ");
    return { id: "chain", label: "Chain", status: "warn", detail: `Pending links: ${names}.` };
  }
  const drawn = new Set(
    graph.nodes.map((node) => `${node.symbol.rootId}:${node.symbol.rel}:${node.symbol.name}`),
  );
  const offChain = [...overlay.changes.keys()]
    .filter((key) => !drawn.has(key))
    .map((key) => key.slice(key.lastIndexOf(":") + 1));
  if (offChain.length > 0) {
    return {
      id: "chain",
      label: "Chain",
      status: "warn",
      detail: `The drawn links resolve, but these changes are off this chain: ${offChain.join(", ")}.`,
    };
  }
  return {
    id: "chain",
    label: "Chain",
    status: "pass",
    detail: "Every link on the chain resolves.",
  };
}

function checkFresh(generation: CodeGenerationDto): ProposalCheck {
  if (generation.stale) {
    return {
      id: "fresh",
      label: "Freshness",
      status: "fail",
      detail: generation.staleReason ?? "the context changed.",
    };
  }
  return {
    id: "fresh",
    label: "Freshness",
    status: "pass",
    detail: "The proposal matches its context.",
  };
}
