// Diff between two analyses for re-analysis after accepting code.
// Keys by CONTENT (file+name+kind, method+URL), never by id: ordinals
// (`#3`) shift when adding elements and an id-based diff would show
// everything as changed. Pure and tested without React.
import { linkApis } from "./apiLinks";
import type {
  StructureRelation,
  StructureResult,
  StructureSymbol,
} from "./structureTypes";

export interface StructureDiff {
  symbolsAdded: number;
  symbolsRemoved: number;
  relationsAdded: number;
  relationsRemoved: number;
  endpointsAdded: number;
  endpointsRemoved: number;
  callsAdded: number;
  callsRemoved: number;
  unionsBefore: number;
  unionsAfter: number;
  /** Readable, bounded sample (`+ GET /users (server.ts)`). */
  samples: string[];
  truncatedSamples: boolean;
}

const MAX_SAMPLES = 8;

function symbolKey(symbol: StructureSymbol): string {
  return `${symbol.language}:${symbol.rootId}:${symbol.rel}:${symbol.kind}:${symbol.name}`;
}

function relationKey(
  relation: StructureRelation,
  byId: Map<string, StructureSymbol>,
): string {
  const from = byId.get(relation.from);
  const toName =
    relation.status === "resolved" && relation.to !== null
      ? (byId.get(relation.to)?.name ?? relation.to)
      : relation.toName;
  return `${relation.kind}:${from?.name ?? relation.from}→${toName}`;
}

function pointKey(rootId: string, rel: string, method: string, url: string): string {
  return `${rootId}:${rel}:${method.toUpperCase()} ${url}`;
}

function diffKeys(before: Set<string>, after: Set<string>): { added: string[]; removed: string[] } {
  const added = [...after].filter((key) => !before.has(key)).sort();
  const removed = [...before].filter((key) => !after.has(key)).sort();
  return { added, removed };
}

export function diffStructure(
  before: StructureResult | null,
  after: StructureResult | null,
): StructureDiff {
  const empty: StructureDiff = {
    symbolsAdded: 0,
    symbolsRemoved: 0,
    relationsAdded: 0,
    relationsRemoved: 0,
    endpointsAdded: 0,
    endpointsRemoved: 0,
    callsAdded: 0,
    callsRemoved: 0,
    unionsBefore: 0,
    unionsAfter: 0,
    samples: [],
    truncatedSamples: false,
  };
  if (before === null || after === null) return empty;
  const beforeSymbols = new Map(before.symbols.map((s) => [s.id, s] as const));
  const afterSymbols = new Map(after.symbols.map((s) => [s.id, s] as const));
  const symbols = diffKeys(
    new Set(before.symbols.map(symbolKey)),
    new Set(after.symbols.map(symbolKey)),
  );
  const relations = diffKeys(
    new Set(before.relations.map((r) => relationKey(r, beforeSymbols))),
    new Set(after.relations.map((r) => relationKey(r, afterSymbols))),
  );
  const endpoints = diffKeys(
    new Set(before.endpoints.map((p) => pointKey(p.rootId, p.rel, p.method, p.url))),
    new Set(after.endpoints.map((p) => pointKey(p.rootId, p.rel, p.method, p.url))),
  );
  const calls = diffKeys(
    new Set(before.calls.map((p) => pointKey(p.rootId, p.rel, p.method, p.url))),
    new Set(after.calls.map((p) => pointKey(p.rootId, p.rel, p.method, p.url))),
  );
  const unionsBefore = linkApis(before.endpoints, before.calls).unions.length;
  const unionsAfter = linkApis(after.endpoints, after.calls).unions.length;

  const samples: string[] = [];
  for (const key of endpoints.added) samples.push(`+ endpoint ${prettyPoint(key)}`);
  for (const key of endpoints.removed) samples.push(`− endpoint ${prettyPoint(key)}`);
  for (const key of calls.added) samples.push(`+ call ${prettyPoint(key)}`);
  for (const key of calls.removed) samples.push(`− call ${prettyPoint(key)}`);
  for (const key of symbols.added) samples.push(`+ symbol ${prettySymbol(key)}`);
  for (const key of symbols.removed) samples.push(`− symbol ${prettySymbol(key)}`);
  for (const key of relations.added) samples.push(`+ relation ${key}`);
  for (const key of relations.removed) samples.push(`− relation ${key}`);
  const truncatedSamples = samples.length > MAX_SAMPLES;
  return {
    symbolsAdded: symbols.added.length,
    symbolsRemoved: symbols.removed.length,
    relationsAdded: relations.added.length,
    relationsRemoved: relations.removed.length,
    endpointsAdded: endpoints.added.length,
    endpointsRemoved: endpoints.removed.length,
    callsAdded: calls.added.length,
    callsRemoved: calls.removed.length,
    unionsBefore,
    unionsAfter,
    samples: samples.slice(0, MAX_SAMPLES),
    truncatedSamples,
  };
}

function prettyPoint(key: string): string {
  // `root:rel:METHOD url` → `METHOD url (rel)`.
  const first = key.indexOf(":");
  const second = key.indexOf(":", first + 1);
  const rel = key.slice(first + 1, second);
  const rest = key.slice(second + 1);
  return `${rest} (${rel})`;
}

function prettySymbol(key: string): string {
  // `lang:root:rel:kind:name` → `name (kind, rel)`.
  const parts = key.split(":");
  const name = parts[parts.length - 1];
  const kind = parts[parts.length - 2];
  const rel = parts.slice(2, parts.length - 2).join(":");
  return `${name} (${kind}, ${rel})`;
}

export function diffIsEmpty(diff: StructureDiff): boolean {
  return (
    diff.symbolsAdded === 0 &&
    diff.symbolsRemoved === 0 &&
    diff.relationsAdded === 0 &&
    diff.relationsRemoved === 0 &&
    diff.endpointsAdded === 0 &&
    diff.endpointsRemoved === 0 &&
    diff.callsAdded === 0 &&
    diff.callsRemoved === 0
  );
}
