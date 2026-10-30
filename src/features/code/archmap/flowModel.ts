// Flow graph: a breadth-first walk over (node, member) pairs from
// one start symbol, following member calls, HTTP calls and
// repository calls. Names resolve inside the caller's project; only
// HTTP links cross projects, matched by verb and normalized path.
import { classifySymbol } from "./archLayers";
import type { ArchLayer } from "./archLayers";
import { normalizeApi } from "../structure/apiLinks";
import type {
  StructureHttpCall,
  StructureMemberCall,
  StructureRepositoryCall,
  StructureResult,
  StructureRouteFact,
  StructureSymbol,
  SymbolFlowFacts,
} from "../structure/structureTypes";

export const FLOW_MAX_DEPTH = 12;
export const FLOW_MAX_NODES = 60;

export interface FlowProject { key: string; label: string; result: StructureResult }
export interface FlowStart { projectKey: string; symbolId: string; member: string | null }
export type FlowChange = "added" | "modified" | "removed";

export interface FlowNode {
  /** `${projectKey}#${symbolId}`. */
  id: string;
  projectKey: string;
  projectLabel: string;
  symbol: StructureSymbol;
  layer: ArchLayer;
  /** Members on the chain, in first-visit order. */
  members: string[];
  /** Distance from the start; orders columns. */
  depth: number;
  change?: FlowChange;
  memberChanges?: Record<string, FlowChange>;
}
export interface FlowHttpNode {
  id: string;
  verb: string;
  /** `{urlAcme}carga/bulk`, or null when not reconstructed. */
  url: string | null;
  depth: number;
  via: "client" | "proxy";
  interceptors: string[];
  guards: string[];
}
export type FlowEdgeKind = "call" | "http" | "route" | "entity";
export interface FlowEdge {
  id: string;
  kind: FlowEdgeKind;
  fromNode: string;
  fromMember: string | null;
  toNode: string;
  toMember: string | null;
  /** Order inside the calling member. */
  order: number;
  evidence: string;
}
export interface FlowPending {
  kind: "unresolved" | "ambiguous" | "no-destination" | "cycle";
  label: string;
  fromNode: string;
  fromMember: string | null;
  evidence: string;
}
export interface FlowGraph {
  nodes: FlowNode[];
  httpNodes: FlowHttpNode[];
  edges: FlowEdge[];
  pending: FlowPending[];
  truncated: boolean;
}

function nodeIdOf(projectKey: string, symbolId: string): string {
  return `${projectKey}#${symbolId}`;
}

function displayUrlOf(call: StructureHttpCall): string | null {
  if (call.url === null) return null;
  return call.url.base === null ? call.url.path : `{${call.url.base}}${call.url.path}`;
}

/** Same verb and same normalized path; client URL paths are base-relative, routes absolute. */
function routeMatches(verb: string, urlPath: string, route: StructureRouteFact): boolean {
  if (route.verb !== verb) return false;
  const client = normalizeApi(verb, urlPath.startsWith("/") ? urlPath : `/${urlPath}`).path;
  return client === normalizeApi(route.verb, route.path).path;
}

function pipelineNames(result: StructureResult, scope: "http-client" | "global-guard"): string[] {
  return (result.pipeline ?? [])
    .filter((entry) => entry.scope === scope)
    .flatMap((entry) => entry.names);
}

/** The caller's file imports this name from a package: a library type, not a gap. */
function isPackageImport(result: StructureResult, symbol: StructureSymbol, name: string): boolean {
  const file = result.files.find(
    (entry) => entry.rootId === symbol.rootId && entry.rel === symbol.rel,
  );
  return (
    file?.imports?.some((entry) => entry.status === "external" && entry.names?.includes(name)) ??
    false
  );
}

function lineOf(evidence: string): number {
  const found = /:(\d+) \(/.exec(evidence);
  return found === null ? Number.MAX_SAFE_INTEGER : Number(found[1]);
}

/** One numbering per calling member, in source order across calls, HTTP and repositories. */
function sequenceEdges(edges: FlowEdge[]): void {
  const byCaller = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (edge.fromMember === null) continue;
    const key = `${edge.fromNode}\n${edge.fromMember}`;
    byCaller.set(key, [...(byCaller.get(key) ?? []), edge]);
  }
  for (const steps of byCaller.values()) {
    steps
      .sort((a, b) => lineOf(a.evidence) - lineOf(b.evidence))
      .forEach((edge, index) => {
        edge.order = index;
      });
  }
}

/** Members a walk starts from: methods, plus fields that hold chain facts. */
function startMembers(symbol: StructureSymbol): string[] {
  const facts = symbol.flow;
  return [
    ...new Set([
      ...symbol.members.filter((entry) => entry.kind === "method").map((entry) => entry.name),
      ...(facts?.calls ?? []).map((entry) => entry.member),
      ...(facts?.httpCalls ?? []).map((entry) => entry.member),
      ...(facts?.repositoryCalls ?? []).map((entry) => entry.member),
    ]),
  ];
}

interface RouteHit {
  project: FlowProject;
  symbol: StructureSymbol;
  route: StructureRouteFact;
}

interface QueueEntry {
  project: FlowProject;
  node: FlowNode;
  member: string;
}

export function buildFlowGraph(projects: FlowProject[], start: FlowStart): FlowGraph {
  const graph: FlowGraph = { nodes: [], httpNodes: [], edges: [], pending: [], truncated: false };
  const startProject = projects.find((project) => project.key === start.projectKey);
  const startSymbol = startProject?.result.symbols.find(
    (symbol) => symbol.id === start.symbolId,
  );
  if (startProject === undefined || startSymbol === undefined) return graph;

  const byId = new Map<string, FlowNode>();
  /** Call path: each (node, member) to the step that first reached it. */
  const callers = new Map<string, string>();
  const visited = new Set<string>();
  const queue: QueueEntry[] = [];
  let edgeCount = 0;
  let httpCount = 0;

  const stepKey = (nodeId: string, member: string | null): string =>
    `${nodeId}\n${member ?? ""}`;

  const isOnCallPath = (target: string, from: string): boolean => {
    let current: string | undefined = from;
    while (current !== undefined) {
      if (current === target) return true;
      current = callers.get(current);
    }
    return false;
  };

  const ensureNode = (
    project: FlowProject,
    symbol: StructureSymbol,
    depth: number,
  ): FlowNode | null => {
    const id = nodeIdOf(project.key, symbol.id);
    const found = byId.get(id);
    if (found !== undefined) return found;
    if (depth > FLOW_MAX_DEPTH || graph.nodes.length >= FLOW_MAX_NODES) {
      graph.truncated = true;
      return null;
    }
    const node: FlowNode = {
      id,
      projectKey: project.key,
      projectLabel: project.label,
      symbol,
      layer: classifySymbol(symbol.rel, {
        kind: symbol.kind,
        name: symbol.name,
        decorators: symbol.decorators ?? [],
      }).layer,
      members: [],
      depth,
    };
    graph.nodes.push(node);
    byId.set(id, node);
    return node;
  };

  const addEdge = (edge: Omit<FlowEdge, "id">): void => {
    graph.edges.push({ ...edge, id: `flow:${edge.kind}:${edgeCount}` });
    edgeCount += 1;
  };

  /** Arrives at (target, member): expands on first visit, marks cycles, links repeats. */
  const arrive = (
    project: FlowProject,
    target: FlowNode,
    member: string | null,
    edge: Omit<FlowEdge, "id">,
  ): void => {
    const key = stepKey(target.id, member);
    const from = stepKey(edge.fromNode, edge.fromMember);
    if (visited.has(key)) {
      if (isOnCallPath(key, from)) {
        graph.pending.push({
          kind: "cycle",
          label: member === null ? target.symbol.name : `${target.symbol.name}.${member}`,
          fromNode: edge.fromNode,
          fromMember: edge.fromMember,
          evidence: edge.evidence,
        });
        return;
      }
      addEdge(edge);
      return;
    }
    visited.add(key);
    callers.set(key, from);
    if (member !== null) {
      target.members.push(member);
      queue.push({ project, node: target, member });
    }
    addEdge(edge);
  };

  const followCall = (
    flow: SymbolFlowFacts,
    project: FlowProject,
    node: FlowNode,
    member: string,
    call: StructureMemberCall,
  ): void => {
    if (call.receiver === null) {
      arrive(project, node, call.method, {
        kind: "call",
        fromNode: node.id,
        fromMember: member,
        toNode: node.id,
        toMember: call.method,
        order: call.order,
        evidence: call.evidence,
      });
      return;
    }
    const injection = flow.injections.find((entry) => entry.field === call.receiver);
    if (injection === undefined) {
      graph.pending.push({
        kind: "unresolved",
        label: call.receiver,
        fromNode: node.id,
        fromMember: member,
        evidence: call.evidence,
      });
      return;
    }
    const candidates = project.result.symbols.filter(
      (symbol) => symbol.name === injection.typeName,
    );
    if (candidates.length === 1) {
      const target = ensureNode(project, candidates[0], node.depth + 1);
      if (target === null) return;
      arrive(project, target, call.method, {
        kind: "call",
        fromNode: node.id,
        fromMember: member,
        toNode: target.id,
        toMember: call.method,
        order: call.order,
        evidence: call.evidence,
      });
      return;
    }
    if (candidates.length === 0 && isPackageImport(project.result, node.symbol, injection.typeName)) {
      return;
    }
    graph.pending.push({
      kind: candidates.length === 0 ? "unresolved" : "ambiguous",
      label: injection.typeName,
      fromNode: node.id,
      fromMember: member,
      evidence: call.evidence,
    });
  };

  const followHttp = (
    project: FlowProject,
    node: FlowNode,
    member: string,
    call: StructureHttpCall,
    index: number,
  ): void => {
    if (node.depth + 1 > FLOW_MAX_DEPTH) {
      graph.truncated = true;
      return;
    }
    const url = displayUrlOf(call);
    const httpNode: FlowHttpNode = {
      id: `http:${httpCount}`,
      verb: call.verb,
      url,
      depth: node.depth + 1,
      via: "client",
      interceptors: pipelineNames(project.result, "http-client"),
      guards: [],
    };
    httpCount += 1;
    graph.httpNodes.push(httpNode);
    callers.set(stepKey(httpNode.id, null), stepKey(node.id, member));
    addEdge({
      kind: "http",
      fromNode: node.id,
      fromMember: member,
      toNode: httpNode.id,
      toMember: null,
      order: index,
      evidence: call.evidence,
    });
    const hits: RouteHit[] = [];
    if (call.url !== null) {
      for (const target of projects) {
        for (const symbol of target.result.symbols) {
          for (const route of symbol.flow?.routes ?? []) {
            if (routeMatches(call.verb, call.url.path, route)) {
              hits.push({ project: target, symbol, route });
            }
          }
        }
      }
    }
    if (hits.length !== 1) {
      graph.pending.push({
        kind: hits.length === 0 ? "no-destination" : "ambiguous",
        label: `${call.verb} ${url ?? "(unknown url)"}`,
        fromNode: node.id,
        fromMember: member,
        evidence: call.evidence,
      });
      return;
    }
    const hit = hits[0];
    const target = ensureNode(hit.project, hit.symbol, httpNode.depth + 1);
    if (target === null) return;
    httpNode.guards = [...hit.route.guards, ...pipelineNames(hit.project.result, "global-guard")];
    arrive(hit.project, target, hit.route.member, {
      kind: "route",
      fromNode: httpNode.id,
      fromMember: null,
      toNode: target.id,
      toMember: hit.route.member,
      order: 0,
      evidence: hit.route.evidence,
    });
  };

  const followEntity = (
    project: FlowProject,
    node: FlowNode,
    member: string,
    call: StructureRepositoryCall,
    index: number,
  ): void => {
    const candidates = project.result.symbols.filter(
      (symbol) => symbol.name === call.entity,
    );
    if (candidates.length === 1) {
      const target = ensureNode(project, candidates[0], node.depth + 1);
      if (target === null) return;
      arrive(project, target, null, {
        kind: "entity",
        fromNode: node.id,
        fromMember: member,
        toNode: target.id,
        toMember: null,
        order: index,
        evidence: call.evidence,
      });
      return;
    }
    if (candidates.length === 0 && isPackageImport(project.result, node.symbol, call.entity)) return;
    graph.pending.push({
      kind: candidates.length === 0 ? "unresolved" : "ambiguous",
      label: call.entity,
      fromNode: node.id,
      fromMember: member,
      evidence: call.evidence,
    });
  };

  const expand = (project: FlowProject, node: FlowNode, member: string): void => {
    const flow = node.symbol.flow;
    if (flow === undefined) return;
    for (const call of flow.calls) {
      if (call.member !== member) continue;
      followCall(flow, project, node, member, call);
    }
    let httpIndex = 0;
    for (const call of flow.httpCalls) {
      if (call.member !== member) continue;
      followHttp(project, node, member, call, httpIndex);
      httpIndex += 1;
    }
    let repoIndex = 0;
    for (const call of flow.repositoryCalls) {
      if (call.member !== member) continue;
      followEntity(project, node, member, call, repoIndex);
      repoIndex += 1;
    }
  };

  const startNode = ensureNode(startProject, startSymbol, 0);
  if (startNode === null) return graph;
  const first = start.member === null ? startMembers(startSymbol) : [start.member];
  for (const member of first) {
    startNode.members.push(member);
    visited.add(`${startNode.id}\n${member}`);
    queue.push({ project: startProject, node: startNode, member });
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    expand(current.project, current.node, current.member);
  }
  sequenceEdges(graph.edges);
  return graph;
}
