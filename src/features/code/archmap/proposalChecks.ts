// Proposal checks: what Ruth verified locally about a Muse
// proposal (syntax, scope, chain, freshness). Pure; no IO.
import type { CodeGenerationDto } from "../types";
import { classifySymbol } from "./archLayers";
import type { FlowGraph, FlowProject } from "./flowModel";
import type { ProposalOverlay } from "./proposalOverlay";

export interface ProposalCheck {
  id: "syntax" | "scope" | "chain" | "fresh" | "layers";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export function checkProposal(
  generation: CodeGenerationDto,
  overlay: ProposalOverlay,
  graph: FlowGraph | null,
  usesStore = false,
): ProposalCheck[] {
  const checks = [
    checkSyntax(overlay),
    checkScope(generation),
    checkChain(graph, overlay),
    checkFresh(generation),
  ];
  // The layers check only joins when it warns: a clean proposal
  // keeps its four checks.
  const layers = checkLayers(graph, usesStore);
  if (layers !== null) checks.push(layers);
  return checks;
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

/**
 * The analyzed code already routes UI through a store: a UI symbol
 * injects a State symbol that injects a service. The chain on screen
 * cannot prove this: a new component calling a service shows no store.
 */
export function projectUsesStore(projects: FlowProject[]): boolean {
  return projects.some(({ result }) => {
    const layerOf = new Map(
      result.symbols.map((symbol) => [
        symbol.name,
        classifySymbol(symbol.rel, {
          kind: symbol.kind,
          name: symbol.name,
          decorators: symbol.decorators ?? [],
        }).layer,
      ]),
    );
    const injects = (name: string, layer: string): string[] =>
      result.symbols
        .filter((symbol) => symbol.name === name)
        .flatMap((symbol) => symbol.flow?.injections ?? [])
        .map((entry) => entry.typeName)
        .filter((type) => layerOf.get(type) === layer);
    return result.symbols.some(
      (symbol) =>
        layerOf.get(symbol.name) === "ui" &&
        injects(symbol.name, "state").some((store) => injects(store, "services").length > 0),
    );
  });
}

/**
 * A proposed UI node calling a service directly while the project
 * already routes UI calls through a State node, proven by the analysis
 * (`usesStore`) or by the chain. Anything unproven stays silent.
 */
function checkLayers(graph: FlowGraph | null, usesStore: boolean): ProposalCheck | null {
  if (graph === null) return null;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const direct = graph.edges.some((edge) => {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    return (
      from !== undefined &&
      to !== undefined &&
      from.layer === "ui" &&
      (from.change === "added" || from.change === "modified") &&
      to.layer === "services"
    );
  });
  if (!direct) return null;
  // Pre-existing chain only: every node without a change marker.
  const settled = (id: string): boolean => byId.get(id)?.change === undefined;
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!settled(edge.fromNode) || !settled(edge.toNode)) continue;
    const list = outgoing.get(edge.fromNode) ?? [];
    list.push(edge.toNode);
    outgoing.set(edge.fromNode, list);
  }
  function reachesServiceThroughStore(from: string): boolean {
    const seen = new Set<string>();
    const queue: Array<{ id: string; viaStore: boolean }> = [{ id: from, viaStore: false }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || seen.has(current.id)) continue;
      seen.add(current.id);
      const node = byId.get(current.id);
      if (node === undefined) continue;
      const viaStore = current.viaStore || node.layer === "state";
      if (viaStore && node.layer === "services") return true;
      for (const next of outgoing.get(current.id) ?? []) {
        if (!seen.has(next)) queue.push({ id: next, viaStore });
      }
    }
    return false;
  }
  const storeOnChain = graph.nodes.some(
    (start) =>
      start.layer === "ui" && start.change === undefined && reachesServiceThroughStore(start.id),
  );
  if (!storeOnChain && !usesStore) return null;
  return {
    id: "layers",
    label: "Layers",
    status: "warn",
    detail: "This component calls the service directly; the project uses a store.",
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
