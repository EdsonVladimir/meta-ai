// Page hierarchy of an Angular project, from its route records and
// templates. Pure. A page is a component a route targets, never by name
// or folder; children come from template tags. A component with many
// parents goes to Shared instead of repeating under each one. One with
// no route and no parent reads "No usage detected", because dynamic
// creation cannot be ruled out.
import { resolveAssetRel } from "../structure/tsAngularFacts";
import type { RouteRecordFact, StructureResult, StructureSymbol } from "../structure/structureTypes";
import { isInExternalFolder, type ExternalFolder } from "./externalLibraries";
import { resolveElement } from "./flowModel";

export const SHARED_PARENTS = 5;
const MAX_LEVELS = 12;

export type CompositionKind = "app" | "page" | "child" | "shared" | "unused";

export interface CompositionNode {
  symbol: StructureSymbol;
  kind: CompositionKind;
  /** Full paths of the routes that open it. */
  routes: string[];
  guards: string[];
  parents: string[];
  children: string[];
}

export interface CompositionColumn {
  key: string;
  title: string;
  hint: string;
  nodes: CompositionNode[];
}

export interface CompositionEdge {
  from: string;
  to: string;
}

export interface Composition {
  columns: CompositionColumn[];
  edges: CompositionEdge[];
  /** Routes whose target is not a known component. */
  unresolvedRoutes: Array<{ path: string; target: string; evidence: string }>;
  ambiguousTags: string[];
  cycles: number;
}

function isComponent(symbol: StructureSymbol): boolean {
  return symbol.component?.kind === "component";
}

function sourceFileOf(rel: string, target: string): string {
  return `${resolveAssetRel(rel, target)}.ts`;
}

/** Route paths with the prefix of the `loadChildren` that reaches them. */
function prefixedRoutes(routes: RouteRecordFact[]): RouteRecordFact[] {
  const prefix = new Map<string, string>();
  for (const route of routes) {
    if (route.loadsChildren && route.lazyImport !== null) {
      prefix.set(sourceFileOf(route.rel, route.lazyImport), route.path ?? "");
    }
  }
  return routes
    .filter((route) => !route.loadsChildren)
    .map((route) => {
      const base = prefix.get(route.rel) ?? "";
      const path =
        route.path === null ? null : [base, route.path].filter((part) => part !== "").join("/");
      return { ...route, path };
    });
}

function targetOf(route: RouteRecordFact, components: StructureSymbol[]): StructureSymbol | null {
  const inFile =
    route.lazyImport === null
      ? null
      : components.filter((symbol) => symbol.rel === sourceFileOf(route.rel, route.lazyImport as string));
  const pool = inFile ?? components;
  const named =
    route.component === null ? pool : pool.filter((symbol) => symbol.name === route.component);
  if (named.length === 1) return named[0];
  // A default export: one component in the lazy file settles it.
  return inFile !== null && inFile.length === 1 ? inFile[0] : null;
}

export function buildComposition(
  result: StructureResult | null,
  externalFolders: readonly ExternalFolder[] = [],
): Composition | null {
  if (result === null) return null;
  const components = result.symbols.filter(
    (symbol) => isComponent(symbol) && !isInExternalFolder(symbol.rootId, symbol.rel, externalFolders),
  );
  if (components.length === 0) return null;
  const known = new Set(components.map((symbol) => symbol.id));
  const nodes = new Map<string, CompositionNode>(
    components.map((symbol) => [
      symbol.id,
      { symbol, kind: "unused", routes: [], guards: [], parents: [], children: [] },
    ]),
  );
  const ambiguousTags = new Set<string>();
  for (const symbol of components) {
    for (const use of symbol.component?.template?.uses ?? []) {
      if (use.kind !== "element") continue;
      const found = resolveElement(result.symbols, symbol, use.name);
      if (found === "ambiguous") ambiguousTags.add(use.name);
      if (found === "none" || found === "ambiguous" || !known.has(found.id)) continue;
      const parent = nodes.get(symbol.id) as CompositionNode;
      const child = nodes.get(found.id) as CompositionNode;
      if (!parent.children.includes(found.id)) parent.children.push(found.id);
      if (!child.parents.includes(symbol.id)) child.parents.push(symbol.id);
    }
  }

  const unresolvedRoutes: Composition["unresolvedRoutes"] = [];
  for (const route of prefixedRoutes(result.routes ?? [])) {
    const target = targetOf(route, components);
    if (target === null) {
      unresolvedRoutes.push({
        path: route.path ?? "(computed path)",
        target: route.component ?? route.lazyImport ?? "?",
        evidence: route.evidence,
      });
      continue;
    }
    const node = nodes.get(target.id) as CompositionNode;
    node.routes.push(route.path ?? "(computed path)");
    node.guards = [...new Set([...node.guards, ...route.canActivate])];
    node.kind = "page";
  }
  for (const name of result.bootstrap ?? []) {
    const roots = components.filter((symbol) => symbol.name === name);
    if (roots.length === 1) (nodes.get(roots[0].id) as CompositionNode).kind = "app";
  }

  // Deepest level from any page or app root; a cycle is cut and counted.
  const levels = new Map<string, number>();
  let cycles = 0;
  const walk = (id: string, level: number, path: Set<string>): void => {
    const node = nodes.get(id) as CompositionNode;
    for (const childId of node.children) {
      if (path.has(childId)) {
        cycles += 1;
        continue;
      }
      const child = nodes.get(childId) as CompositionNode;
      if (child.kind === "page" || child.kind === "app") continue;
      if ((levels.get(childId) ?? 0) >= level + 1 || level + 1 > MAX_LEVELS) continue;
      levels.set(childId, level + 1);
      child.kind = child.parents.length >= SHARED_PARENTS ? "shared" : "child";
      walk(childId, level + 1, new Set(path).add(childId));
    }
  };
  for (const node of nodes.values()) {
    if (node.kind === "page" || node.kind === "app") walk(node.symbol.id, 0, new Set([node.symbol.id]));
  }

  const all = [...nodes.values()];
  const order = (list: CompositionNode[]): CompositionNode[] =>
    [...list].sort(
      (a, b) =>
        (a.routes[0] ?? "").localeCompare(b.routes[0] ?? "") ||
        a.symbol.name.localeCompare(b.symbol.name),
    );
  const deepest = Math.max(0, ...levels.values());
  const columns: CompositionColumn[] = [
    {
      key: "app",
      title: "App",
      hint: "Where the application starts.",
      nodes: order(all.filter((node) => node.kind === "app")),
    },
    {
      key: "pages",
      title: "Pages",
      hint: "Components a route opens.",
      nodes: order(all.filter((node) => node.kind === "page")),
    },
    ...Array.from({ length: deepest }, (_, index) => ({
      key: `level-${index + 1}`,
      title: `Level ${index + 1}`,
      hint: index === 0 ? "Used directly by a page." : `Used inside level ${index}.`,
      nodes: order(
        all.filter((node) => node.kind === "child" && levels.get(node.symbol.id) === index + 1),
      ),
    })),
    {
      key: "shared",
      title: "Shared",
      hint: `Used by ${SHARED_PARENTS} or more components.`,
      nodes: order(all.filter((node) => node.kind === "shared")),
    },
    {
      key: "unused",
      title: "No usage detected",
      hint: "No route or parent found. Dynamic creation cannot be ruled out.",
      nodes: order(all.filter((node) => node.kind === "unused")),
    },
  ].filter((column) => column.nodes.length > 0);
  const edges = all.flatMap((node) =>
    node.children.map((child) => ({ from: node.symbol.id, to: child })),
  );
  return { columns, edges, unresolvedRoutes, ambiguousTags: [...ambiguousTags], cycles };
}

/** A node with everything above and below it. */
export function branchOf(composition: Composition, id: string): Set<string> {
  const next = (direction: "from" | "to"): Set<string> => {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const edge of composition.edges) {
        const [here, there] = direction === "from" ? [edge.from, edge.to] : [edge.to, edge.from];
        if (here === current && !seen.has(there)) {
          seen.add(there);
          queue.push(there);
        }
      }
    }
    return seen;
  };
  return new Set([...next("from"), ...next("to")]);
}
