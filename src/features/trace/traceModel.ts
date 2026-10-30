// Requirement↔code traceability model. Pure and deterministic: it only
// combines EXPLICIT links (manual and detected with evidence) with
// artifacts and snapshots. Never infers: unlinked items list as such,
// without judging whether they are extra or missing. No React, no Tauri:
// tested with vitest without DOM.
import type { ArtifactDto } from "../requirements/types";
import type { CodeLinkDto } from "../code/types";

/** Symbol harvested from a saved snapshot. */
export interface TraceSnapshotSymbol {
  id: string;
  name: string;
  kind: string;
  rootId: string;
  rel: string;
  snapshotId: string;
  snapshotName: string;
}

/** Per-module-artifact row with its links. */
export interface TraceArtifactRow {
  artifact: ArtifactDto;
  /** Own title or id (no invented labels). */
  label: string;
  /** Links sorted by id (stable). */
  links: CodeLinkDto[];
}

/** Detected symbol with no linked artifact in the project. */
export interface TraceOrphanSymbol {
  id: string;
  name: string;
  kind: string;
  rootId: string;
  rel: string;
  snapshotId: string;
  snapshotName: string;
}

/** Orphan-symbol cap (mirror of the analysis cap). */
export const MAX_TRACE_SYMBOLS = 300;

export interface TraceModelInput {
  /** Module artifacts (requirements + designs + mockups). */
  moduleArtifacts: ArtifactDto[];
  moduleId: string;
  /** Module links of the WHOLE project (filtered here). */
  projectModuleLinks: CodeLinkDto[];
  /** Artifact links of the WHOLE project (global scope). */
  projectArtifactLinks: CodeLinkDto[];
  /** Project snapshot symbols (may repeat). */
  snapshotSymbols: TraceSnapshotSymbol[];
}

export interface TraceModel {
  /** Artifacts with ≥1 link (input order). */
  linked: TraceArtifactRow[];
  /** Module artifacts without links. */
  unlinkedArtifacts: ArtifactDto[];
  /** Manual module links (sorted by id). */
  moduleLinks: CodeLinkDto[];
  /** Symbols with no linked artifact (sorted by id). */
  orphanSymbols: TraceOrphanSymbol[];
  /** The orphan list was cut at the cap. */
  orphansTruncated: boolean;
  counts: {
    artifacts: number;
    linkedArtifacts: number;
    artifactLinks: number;
    moduleLinks: number;
    orphanSymbols: number;
  };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildTraceModel(input: TraceModelInput): TraceModel {
  const moduleIds = new Set(input.moduleArtifacts.map((artifact) => artifact.id));
  const moduleLinks = input.projectModuleLinks
    .filter((link) => link.ownerId === input.moduleId)
    .sort(byId);
  // A symbol counts as linked when SOME project artifact claims it (even
  // from another module): in this module it says “unlinked here”, never
  // “global orphan”.
  const linkedSymbolIds = new Set(
    input.projectArtifactLinks.flatMap((link) => (link.symbol === null ? [] : [link.symbol.id])),
  );
  const linksByArtifact = new Map<string, CodeLinkDto[]>();
  for (const link of input.projectArtifactLinks) {
    if (!moduleIds.has(link.ownerId)) continue;
    const list = linksByArtifact.get(link.ownerId) ?? [];
    list.push(link);
    linksByArtifact.set(link.ownerId, list);
  }
  const linked: TraceArtifactRow[] = [];
  const unlinkedArtifacts: ArtifactDto[] = [];
  for (const artifact of input.moduleArtifacts) {
    const links = (linksByArtifact.get(artifact.id) ?? []).sort(byId);
    if (links.length === 0) unlinkedArtifacts.push(artifact);
    else {
      linked.push({
        artifact,
        label: artifact.title ?? artifact.id,
        links,
      });
    }
  }
  // Orphans: first snapshot bringing each id (no duplicates).
  const seen = new Set<string>();
  const orphans: TraceOrphanSymbol[] = [];
  for (const symbol of input.snapshotSymbols) {
    if (linkedSymbolIds.has(symbol.id) || seen.has(symbol.id)) continue;
    seen.add(symbol.id);
    orphans.push({ ...symbol });
  }
  orphans.sort(byId);
  const orphansTruncated = orphans.length > MAX_TRACE_SYMBOLS;
  const orphanSymbols = orphansTruncated ? orphans.slice(0, MAX_TRACE_SYMBOLS) : orphans;
  return {
    linked,
    unlinkedArtifacts,
    moduleLinks,
    orphanSymbols,
    orphansTruncated,
    counts: {
      artifacts: input.moduleArtifacts.length,
      linkedArtifacts: linked.length,
      artifactLinks: linked.reduce((total, row) => total + row.links.length, 0),
      moduleLinks: moduleLinks.length,
      orphanSymbols: orphans.length,
    },
  };
}
