// Proposal overlay: staged file contents analyzed and diffed
// against the base projects without touching them. Symbols compare
// by name inside the file, members by name plus body hash; only
// pending TypeScript files take part, the rest is noted or ignored.
import { fnv1aHex } from "../model";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { combineResults } from "../structure/structureMerge";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import type {
  StructureInput,
  StructureResult,
  StructureSymbol,
} from "../structure/structureTypes";
import type { CodeProposalFileDto } from "../types";
import type { FlowChange, FlowGraph, FlowProject } from "./flowModel";
import { isTsFile } from "./projectMaps";

export interface SymbolChange {
  change: FlowChange;
  members: Record<string, FlowChange>;
}
export interface ProposalOverlay {
  projects: FlowProject[];
  /** Keyed by `${rootId}:${rel}:${symbol name}`. */
  changes: Map<string, SymbolChange>;
  removed: Array<{ rootId: string; rel: string; name: string }>;
  /** Files not analyzable (non-TS), or partially parsed. */
  notes: string[];
}

function symbolKey(rootId: string, rel: string, name: string): string {
  return `${rootId}:${rel}:${name}`;
}

/** Changed members only: added, removed, or a moved body hash. */
function diffMembers(
  oldSymbol: StructureSymbol | undefined,
  newSymbol: StructureSymbol,
): Record<string, FlowChange> {
  const out: Record<string, FlowChange> = {};
  const oldMembers = new Map((oldSymbol?.members ?? []).map((member) => [member.name, member]));
  for (const member of newSymbol.members) {
    const old = oldMembers.get(member.name);
    if (old === undefined) out[member.name] = "added";
    else if (old.bodyHash !== member.bodyHash) out[member.name] = "modified";
  }
  for (const name of oldMembers.keys()) {
    if (!newSymbol.members.some((member) => member.name === name)) out[name] = "removed";
  }
  return out;
}

function holdsFile(project: FlowProject, file: CodeProposalFileDto): boolean {
  return project.result.files.some(
    (entry) => entry.rootId === file.rootId && entry.rel === file.rel,
  );
}

function sharedFolders(a: string, b: string): number {
  const left = a.split("/").slice(0, -1);
  const right = b.split("/").slice(0, -1);
  let shared = 0;
  while (shared < left.length && left[shared] === right[shared]) shared += 1;
  return shared;
}

/**
 * Project of a proposed file. Nested projects share a root, so the
 * root alone cannot decide: the project holding the file wins, then
 * the one with the closest analyzed folder. -1 when no project has
 * that root.
 */
function projectIndexOf(projects: FlowProject[], file: CodeProposalFileDto): number {
  const holder = projects.findIndex((project) => holdsFile(project, file));
  if (holder !== -1) return holder;
  let best = -1;
  let bestShared = -1;
  projects.forEach((project, index) => {
    for (const entry of project.result.files) {
      if (entry.rootId !== file.rootId) continue;
      const shared = sharedFolders(entry.rel, file.rel);
      if (shared > bestShared) {
        best = index;
        bestShared = shared;
      }
    }
  });
  return best;
}

function analyzeInBatches(
  inputs: StructureInput[],
  analyze: (inputs: StructureInput[]) => StructureResult,
): StructureResult {
  const parts: StructureResult[] = [];
  for (let i = 0; i < inputs.length; i += STRUCTURE_LIMITS.maxFiles) {
    parts.push(analyze(inputs.slice(i, i + STRUCTURE_LIMITS.maxFiles)));
  }
  return combineResults(parts);
}

export function buildProposalOverlay(
  projects: FlowProject[],
  files: CodeProposalFileDto[],
  analyze: (inputs: StructureInput[]) => StructureResult = analyzeTsFiles,
): ProposalOverlay {
  const notes: string[] = [];
  const targets = new Map<number, CodeProposalFileDto[]>();
  for (const file of files) {
    if (file.state !== "pending") continue;
    if (!isTsFile(file.rel)) {
      notes.push(`${file.rel}: not analyzed`);
      continue;
    }
    const index = projectIndexOf(projects, file);
    if (index === -1) {
      notes.push(`${file.rel}: no analyzed project holds this file`);
      continue;
    }
    if (file.operation === "modify" && !holdsFile(projects[index], file)) {
      notes.push(`${file.rel}: not analyzed before, shown as new`);
    }
    const group = targets.get(index) ?? [];
    group.push(file);
    targets.set(index, group);
  }
  const changes = new Map<string, SymbolChange>();
  const removed: Array<{ rootId: string; rel: string; name: string }> = [];
  const results = new Map<number, StructureResult>();
  for (const [index, group] of targets) {
    const base = projects[index].result;
    const rels = new Set(group.map((file) => file.rel));
    const rootIds = new Set(group.map((file) => file.rootId));
    const oldByRel = new Map<string, StructureSymbol[]>();
    for (const file of group) {
      oldByRel.set(
        file.rel,
        base.symbols.filter(
          (symbol) => symbol.rootId === file.rootId && symbol.rel === file.rel,
        ),
      );
    }
    const removedIds = new Set<string>();
    for (const list of oldByRel.values()) {
      for (const symbol of list) removedIds.add(symbol.id);
    }
    const copy: StructureResult = structuredClone(base);
    copy.symbols = copy.symbols.filter(
      (symbol) => !(rootIds.has(symbol.rootId) && rels.has(symbol.rel)),
    );
    copy.files = copy.files.filter(
      (file) => !(rootIds.has(file.rootId) && rels.has(file.rel)),
    );
    copy.relations = copy.relations.filter(
      (relation) =>
        !removedIds.has(relation.from) &&
        (relation.to === null || !removedIds.has(relation.to)),
    );
    const replaced = (rootId: string, rel: string): boolean =>
      rootIds.has(rootId) && rels.has(rel);
    copy.endpoints = copy.endpoints.filter((entry) => !replaced(entry.rootId, entry.rel));
    copy.calls = copy.calls.filter((entry) => !replaced(entry.rootId, entry.rel));
    const fromReplaced = (evidence: string): boolean =>
      [...rels].some((rel) => evidence.startsWith(`${rel}:`));
    if (copy.pipeline !== undefined) {
      copy.pipeline = copy.pipeline.filter((entry) => !fromReplaced(entry.evidence));
    }
    if (copy.routeRecords !== undefined) {
      copy.routeRecords = copy.routeRecords.filter((entry) => !fromReplaced(entry.evidence));
    }
    const fresh = analyzeInBatches(
      group.map((file) => ({
        rootId: file.rootId,
        rel: file.rel,
        content: file.content,
        hash: fnv1aHex(file.content),
      })),
      analyze,
    );
    for (const file of fresh.files) {
      if (file.status === "partial") notes.push(`${file.rel}: partial syntax`);
      else if (file.status !== "ok") notes.push(`${file.rel}: not analyzed`);
    }
    results.set(index, combineResults([copy, fresh]));
    for (const file of group) {
      const oldSymbols = oldByRel.get(file.rel) ?? [];
      const newSymbols = fresh.symbols.filter(
        (symbol) => symbol.rootId === file.rootId && symbol.rel === file.rel,
      );
      const oldByName = new Map(oldSymbols.map((symbol) => [symbol.name, symbol]));
      const newByName = new Map(newSymbols.map((symbol) => [symbol.name, symbol]));
      for (const [name, symbol] of newByName) {
        const old = oldByName.get(name);
        if (old === undefined) {
          const members: Record<string, FlowChange> = {};
          for (const member of symbol.members) members[member.name] = "added";
          changes.set(symbolKey(file.rootId, file.rel, name), { change: "added", members });
        } else {
          const members = diffMembers(old, symbol);
          const textChanged = old.bodyHash !== undefined && old.bodyHash !== symbol.bodyHash;
          if (textChanged || Object.keys(members).length > 0) {
            changes.set(symbolKey(file.rootId, file.rel, name), { change: "modified", members });
          }
        }
      }
      for (const name of oldByName.keys()) {
        if (!newByName.has(name)) removed.push({ rootId: file.rootId, rel: file.rel, name });
      }
    }
  }
  return {
    projects: projects.map((project, index) => {
      const result = results.get(index);
      return result === undefined ? project : { ...project, result };
    }),
    changes,
    removed,
    notes,
  };
}

export function applyChangesToGraph(graph: FlowGraph, overlay: ProposalOverlay): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const found = overlay.changes.get(
        symbolKey(node.symbol.rootId, node.symbol.rel, node.symbol.name),
      );
      if (found === undefined) return node;
      const memberChanges: Record<string, FlowChange> = {};
      for (const member of node.members) {
        const change = found.members[member];
        if (change !== undefined) memberChanges[member] = change;
      }
      return { ...node, change: found.change, memberChanges };
    }),
  };
}
