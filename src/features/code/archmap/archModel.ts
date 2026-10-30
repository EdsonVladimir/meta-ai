// Architecture map model: groups an analyzed result into layered file boxes
// with aggregated file-level edges. Pure and total: every input produces a
// map, with explicit truncation flags instead of silent drops (per-file
// lists are small enough to keep whole, except unresolved refs).
import type {
  StructureMember,
  StructureRange,
  StructureRelation,
  StructureRelationKind,
  StructureResult,
  StructureSymbol,
} from "../structure/structureTypes";
import {
  ARCH_LAYER_BY_ID,
  classifyFile,
  classifySymbol,
  refineByDecorators,
  type ArchLayer,
} from "./archLayers";
import { detectLifecycleHooks, type LifecycleHook } from "./memberRoles";

export const MAX_MAP_FILES = 200;
export const MAX_MAP_EDGES = 300;
export const MAX_MAP_EXTERNALS = 50;
export const MAX_UNRESOLVED_PER_FILE = 8;
/** Symbol cards drawn per map before `nodesTruncated` says the board is partial. */
export const MAX_MAP_SYMBOLS = 1000;
/** Symbol edges drawn per map before `symbolEdgesTruncated` says so. */
export const MAX_MAP_SYMBOL_EDGES = 300;

export type ArchEdgeKind = StructureRelationKind | "imports";

export interface ArchMapSymbol {
  id: string;
  kind: StructureSymbol["kind"];
  name: string;
  rootId: string;
  rel: string;
  members: StructureMember[];
  membersTruncated: boolean;
  decorators: string[];
  unresolved: ArchUnresolvedRef[];
  unresolvedTruncated: boolean;
  range: StructureRange;
  /**
   * Members recognized as framework lifecycle hooks, with evidence
   * (`memberRoles.ts`). Absent or empty: none detected.
   */
  lifecycle?: LifecycleHook[];
}

export interface ArchUnresolvedRef {
  toName: string;
  kind: StructureRelationKind;
  status: "unresolved" | "ambiguous";
}

export interface ArchMapFile {
  rootId: string;
  rel: string;
  layer: ArchLayer;
  layerReason: string;
  symbols: ArchMapSymbol[];
  /** Raw specifiers that point outside the analyzed code. */
  externals: string[];
  /** Relative specifiers that resolve to no analyzed file. */
  missing: string[];
  unresolved: ArchUnresolvedRef[];
  unresolvedTruncated: boolean;
}

export interface ArchMapEdge {
  id: string;
  /** Edges never cross roots; both ends share it. */
  rootId: string;
  fromRel: string;
  toRel: string;
  /** Kinds merged into this edge with their counts, stable order. */
  kinds: Array<{ kind: ArchEdgeKind; count: number }>;
  evidence: string;
}

export interface ArchSkipped {
  rel: string;
  reason: string;
}

/**
 * One symbol card: a class, interface, enum, component or free
 * function with its own layer. The symbol is a shared reference
 * into `files` (never duplicated); `id` is the stable
 * project+file+symbol identity.
 */
export interface ArchMapNode {
  id: string;
  rootId: string;
  rel: string;
  symbol: ArchMapSymbol;
  layer: ArchLayer;
  layerReason: string;
}

/**
 * Edge between two symbols from resolved relations only. File
 * imports never appear here: they stay file-level edges, so an
 * import is never mistaken for a method call.
 */
export interface ArchMapSymbolEdge {
  id: string;
  from: string;
  to: string;
  /** Relation kinds merged into this edge with counts, stable order. */
  kinds: Array<{ kind: StructureRelationKind; count: number }>;
  evidence: string;
}

/**
 * A framework module declaration: a class with `@Module`/`@NgModule`
 * metadata found in the analyzed result. Membership resolves with
 * the same strict rule as relations (one unique name wins; zero
 * names stay unresolved, repeated names ambiguous), per batch.
 */
export interface ArchMapModule {
  /** `mod:<module-class symbol id>`, unique within the map. */
  id: string;
  rootId: string;
  rel: string;
  symbolId: string;
  name: string;
  /** The decorator that declared it. */
  via: "Module" | "NgModule";
  /** Resolved member symbol ids, module class first. */
  memberIds: string[];
  /** Metadata names with no analyzed symbol. */
  unresolved: Array<{ name: string; role: string }>;
  /** Metadata names matching several analyzed symbols. */
  ambiguous: Array<{ name: string; role: string }>;
  /** Metadata entries skipped (dynamic expressions). */
  opaque: number;
}

export interface ArchMap {
  files: ArchMapFile[];
  filesTruncated: boolean;
  edges: ArchMapEdge[];
  edgesTruncated: boolean;
  nodes: ArchMapNode[];
  nodesTruncated: boolean;
  symbolEdges: ArchMapSymbolEdge[];
  symbolEdgesTruncated: boolean;
  /** Framework modules declared in the analyzed result. */
  modules: ArchMapModule[];
  /** Most imported external specifiers with user counts. */
  externals: Array<{ raw: string; usedBy: number }>;
  externalsTruncated: boolean;
  skipped: ArchSkipped[];
}

const EDGE_KIND_ORDER: ArchEdgeKind[] = [
  "imports",
  "extends",
  "implements",
  "instantiates",
  "references",
];

const SYMBOL_EDGE_KIND_ORDER: StructureRelationKind[] = [
  "extends",
  "implements",
  "instantiates",
  "references",
];

export function buildArchMap(result: StructureResult): ArchMap {
  const symbolsById = new Map<string, StructureSymbol>();
  for (const symbol of result.symbols) symbolsById.set(symbol.id, symbol);
  const fileByRel = new Map<string, (typeof result.files)[number]>();
  for (const file of result.files) fileByRel.set(`${file.rootId}::${file.rel}`, file);

  const files: ArchMapFile[] = [];
  const skipped: ArchSkipped[] = [];
  const externalUsers = new Map<string, Set<string>>();
  for (const file of result.files) {
    if (file.status === "error" || file.language === null) {
      skipped.push({ rel: file.rel, reason: file.message ?? "could not read file" });
      continue;
    }
    const symbols = result.symbols.filter(
      (s) => s.rootId === file.rootId && s.rel === file.rel,
    );
    const decorators = symbols.flatMap((s) => s.decorators ?? []);
    const classified = refineByDecorators(classifyFile(file.rel), decorators);
    const externals: string[] = [];
    const missing: string[] = [];
    for (const imp of file.imports ?? []) {
      if (imp.status === "external") {
        externals.push(imp.raw);
        const users = externalUsers.get(imp.raw) ?? new Set<string>();
        users.add(file.rel);
        externalUsers.set(imp.raw, users);
      } else if (imp.status === "missing") {
        missing.push(imp.raw);
      }
    }
    const unresolved: ArchUnresolvedRef[] = [];
    for (const rel of result.relations) {
      const from = symbolsById.get(rel.from);
      if (
        from === undefined ||
        from.rootId !== file.rootId ||
        from.rel !== file.rel ||
        rel.status === "resolved"
      ) {
        continue;
      }
      if (unresolved.length < MAX_UNRESOLVED_PER_FILE) {
        unresolved.push({ toName: rel.toName, kind: rel.kind, status: rel.status });
      }
    }
    const unresolvedTotal = result.relations.filter((rel) => {
      const from = symbolsById.get(rel.from);
      return (
        from !== undefined &&
        from.rootId === file.rootId &&
        from.rel === file.rel &&
        rel.status !== "resolved"
      );
    }).length;
    files.push({
      rootId: file.rootId,
      rel: file.rel,
      layer: classified.layer,
      layerReason: classified.reason,
      symbols: symbols.map((s) => {
        const mine = result.relations.filter((rel) => rel.from === s.id);
        const own = mine.filter(
          (rel): rel is StructureRelation & { status: "unresolved" | "ambiguous" } =>
            rel.status !== "resolved",
        );
        return {
          id: s.id,
          kind: s.kind,
          name: s.name,
          rootId: s.rootId,
          rel: s.rel,
          members: s.members,
          membersTruncated: s.membersTruncated,
          decorators: s.decorators ?? [],
          unresolved: own
            .slice(0, MAX_UNRESOLVED_PER_FILE)
            .map((rel) => ({ toName: rel.toName, kind: rel.kind, status: rel.status })),
          unresolvedTruncated: own.length > MAX_UNRESOLVED_PER_FILE,
          range: s.range,
          lifecycle: detectLifecycleHooks(s, mine, [...new Set(externals)]),
        };
      }),
      externals: [...new Set(externals)],
      missing: [...new Set(missing)],
      unresolved,
      unresolvedTruncated: unresolvedTotal > unresolved.length,
    });
  }
  files.sort(
    (a, b) =>
      ARCH_LAYER_BY_ID[a.layer].order - ARCH_LAYER_BY_ID[b.layer].order ||
      a.rel.localeCompare(b.rel),
  );
  const filesTruncated = files.length > MAX_MAP_FILES;
  const kept = new Set(files.slice(0, MAX_MAP_FILES).map((f) => `${f.rootId}::${f.rel}`));

  // Edges aggregate imports and resolved symbol relations between files.
  // Self-edges carry no architectural information and are dropped.
  interface EdgeAcc {
    kinds: Map<ArchEdgeKind, number>;
    evidence: string;
  }
  const acc = new Map<string, EdgeAcc>();
  function addEdge(
    rootId: string,
    from: string,
    to: string,
    kind: ArchEdgeKind,
    evidence: string,
  ): void {
    if (from === to) return;
    const key = `${rootId}::${from}::${to}`;
    const found = acc.get(key);
    if (found === undefined) {
      acc.set(key, { kinds: new Map([[kind, 1]]), evidence });
    } else {
      found.kinds.set(kind, (found.kinds.get(kind) ?? 0) + 1);
    }
  }
  for (const file of result.files) {
    const fromKey = `${file.rootId}::${file.rel}`;
    if (!kept.has(fromKey)) continue;
    for (const imp of file.imports ?? []) {
      if (imp.resolvedRel === null) continue;
      const toKey = `${file.rootId}::${imp.resolvedRel}`;
      if (!kept.has(toKey)) continue;
      addEdge(
        file.rootId,
        file.rel,
        imp.resolvedRel,
        "imports",
        `${file.rel}:${imp.line} imports '${imp.raw}'`,
      );
    }
  }
  for (const rel of result.relations) {
    if (rel.status !== "resolved" || rel.to === null) continue;
    const from = symbolsById.get(rel.from);
    const to = symbolsById.get(rel.to);
    if (from === undefined || to === undefined) continue;
    if (from.rootId !== to.rootId) continue;
    const fromKey = `${from.rootId}::${from.rel}`;
    const toKey = `${to.rootId}::${to.rel}`;
    if (!kept.has(fromKey) || !kept.has(toKey)) continue;
    addEdge(from.rootId, from.rel, to.rel, rel.kind, rel.evidence);
  }
  const edges: ArchMapEdge[] = [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const [rootId, fromRel, toRel] = key.split("::");
      const kinds = [...value.kinds.entries()]
        .sort(([a], [b]) => EDGE_KIND_ORDER.indexOf(a) - EDGE_KIND_ORDER.indexOf(b))
        .map(([kind, count]) => ({ kind, count }));
      return { id: `edge:${key}`, rootId, fromRel, toRel, kinds, evidence: value.evidence };
    });
  const edgesTruncated = edges.length > MAX_MAP_EDGES;

  const keptFiles = files.slice(0, MAX_MAP_FILES);
  const nodes: ArchMapNode[] = [];
  for (const file of keptFiles) {
    for (const symbol of file.symbols) {
      const verdict = classifySymbol(file.rel, symbol);
      nodes.push({
        id: symbol.id,
        rootId: file.rootId,
        rel: file.rel,
        symbol,
        layer: verdict.layer,
        layerReason: verdict.reason,
      });
    }
  }
  const nodesTruncated = nodes.length > MAX_MAP_SYMBOLS;
  const keptNodes = new Set(
    nodes.slice(0, MAX_MAP_SYMBOLS).map((node) => node.id),
  );

  // Symbol edges link resolved relations between kept symbols; file
  // imports stay out by construction (they are not relations).
  const symAcc = new Map<string, { kinds: Map<StructureRelationKind, number>; evidence: string }>();
  for (const rel of result.relations) {
    if (rel.status !== "resolved" || rel.to === null) continue;
    if (rel.from === rel.to) continue;
    if (!keptNodes.has(rel.from) || !keptNodes.has(rel.to)) continue;
    const found = symAcc.get(`${rel.from}::${rel.to}`);
    if (found === undefined) {
      symAcc.set(`${rel.from}::${rel.to}`, {
        kinds: new Map([[rel.kind, 1]]),
        evidence: rel.evidence,
      });
    } else {
      found.kinds.set(rel.kind, (found.kinds.get(rel.kind) ?? 0) + 1);
    }
  }
  const symbolEdges: ArchMapSymbolEdge[] = [...symAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const [from, to] = key.split("::");
      const kinds = [...value.kinds.entries()]
        .sort(([a], [b]) => SYMBOL_EDGE_KIND_ORDER.indexOf(a) - SYMBOL_EDGE_KIND_ORDER.indexOf(b))
        .map(([kind, count]) => ({ kind, count }));
      return { id: `symedge:${key}`, from, to, kinds, evidence: value.evidence };
    });
  const symbolEdgesTruncated = symbolEdges.length > MAX_MAP_SYMBOL_EDGES;

  const externals = [...externalUsers.entries()]
    .map(([raw, users]) => ({ raw, usedBy: users.size }))
    .sort((a, b) => b.usedBy - a.usedBy || a.raw.localeCompare(b.raw));
  const externalsTruncated = externals.length > MAX_MAP_EXTERNALS;

  const modules = resolveModules(result.symbols);

  return {
    files: keptFiles,
    filesTruncated,
    edges: edges.slice(0, MAX_MAP_EDGES),
    edgesTruncated,
    nodes: nodes.slice(0, MAX_MAP_SYMBOLS),
    nodesTruncated,
    symbolEdges: symbolEdges.slice(0, MAX_MAP_SYMBOL_EDGES),
    symbolEdgesTruncated,
    modules,
    externals: externals.slice(0, MAX_MAP_EXTERNALS),
    externalsTruncated,
    skipped,
  };
}

/**
 * Framework module membership: every `@Module`/`@NgModule` class
 * becomes a module with itself plus its uniquely resolving
 * metadata names as members. Same strict rule as relations, so
 * cross-batch names stay unresolved (documented, not completed).
 */
function resolveModules(symbols: StructureSymbol[]): ArchMapModule[] {
  const byName = new Map<string, StructureSymbol[]>();
  for (const symbol of symbols) {
    const found = byName.get(symbol.name);
    if (found === undefined) byName.set(symbol.name, [symbol]);
    else found.push(symbol);
  }
  const modules: ArchMapModule[] = [];
  for (const symbol of symbols) {
    const refs = symbol.moduleRefs ?? [];
    const opaque = symbol.moduleOpaque ?? 0;
    const via = (symbol.decorators ?? []).find(
      (entry): entry is "Module" | "NgModule" => entry === "Module" || entry === "NgModule",
    );
    if (via === undefined && refs.length === 0 && opaque === 0) continue;
    const memberIds = [symbol.id];
    const unresolved: Array<{ name: string; role: string }> = [];
    const ambiguous: Array<{ name: string; role: string }> = [];
    for (const ref of refs) {
      const candidates = byName.get(ref.name) ?? [];
      if (candidates.length === 1) {
        if (!memberIds.includes(candidates[0].id)) memberIds.push(candidates[0].id);
      } else if (candidates.length === 0) {
        if (!unresolved.some((entry) => entry.name === ref.name && entry.role === ref.role)) {
          unresolved.push({ name: ref.name, role: ref.role });
        }
      } else if (!ambiguous.some((entry) => entry.name === ref.name && entry.role === ref.role)) {
        ambiguous.push({ name: ref.name, role: ref.role });
      }
    }
    modules.push({
      id: `mod:${symbol.id}`,
      rootId: symbol.rootId,
      rel: symbol.rel,
      symbolId: symbol.id,
      name: symbol.name,
      via: via ?? "Module",
      memberIds,
      unresolved,
      ambiguous,
      opaque,
    });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return modules;
}
