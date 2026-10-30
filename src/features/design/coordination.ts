// Pure design-view coordination: merging Rust snapshots, deciding
// actions, editing JSON and retaining the last valid render. No React
// or Tauri: tested with vitest without DOM.
import type { ArtifactDto, RequirementDetail } from "../requirements/types";
import type { DesignGenerationDto, DesignKind, DesignProposalDto } from "./types";

/**
 * Inserts or replaces a generation keeping registration order. Late
 * responses are filtered earlier (per module); only merging happens here.
 */
export function upsertDesignGeneration(
  generations: DesignGenerationDto[],
  incoming: DesignGenerationDto,
): DesignGenerationDto[] {
  const index = generations.findIndex((g) => g.id === incoming.id);
  if (index === -1) return [...generations, incoming];
  return generations.map((g, i) => (i === index ? incoming : g));
}

/** Does this proposal accept actions? Only pending, fresh and idle. */
export function isDesignActionable(
  proposal: DesignProposalDto,
  stale: boolean,
  busy: boolean,
): boolean {
  return proposal.state === "pending" && !stale && !busy;
}

/** Design artifacts of the requested kind, candidates for versioning on accept. */
export function designTargets(artifacts: ArtifactDto[], kind: DesignKind): ArtifactDto[] {
  return artifacts.filter((a) => a.kind === kind);
}

/** Does the generation propose updating an existing design (not creating)? */
export function isUpdateGeneration(generation: DesignGenerationDto): boolean {
  return (
    generation.targetArtifactId !== null &&
    generation.targetArtifactId !== undefined &&
    generation.targetArtifactId !== ""
  );
}

/** Saved proposals updating an artifact, in registration order. */
export function updateGenerationsFor(
  generations: DesignGenerationDto[],
  artifactId: string,
): DesignGenerationDto[] {
  return generations.filter((g) => g.targetArtifactId === artifactId);
}

/** The most recent pending and fresh one, if any (to resume). */
export function resumableUpdate(
  generations: DesignGenerationDto[],
  artifactId: string,
): DesignGenerationDto | null {
  const candidates = updateGenerationsFor(generations, artifactId).filter(
    (g) => g.proposal.state === "pending" && !g.stale,
  );
  return candidates.length === 0 ? null : candidates[candidates.length - 1];
}

/** Canonical text for the JSON editor (2 spaces, stable). */
export function prettySpec(spec: unknown): string {
  return JSON.stringify(spec, null, 2);
}

export type ParsedSpec =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Prior local parse: when the JSON does not parse, Rust is not even called. */
export function parseSpecText(text: string): ParsedSpec {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (raw) {
    const detail = raw instanceof Error ? raw.message : "invalid JSON";
    return { ok: false, error: `The text is not valid JSON: ${detail}` };
  }
}

/** Diagram state: keeps the last valid SVG on errors. */
export interface RenderState {
  status: "idle" | "loading" | "ready" | "error";
  /** Last valid SVG (kept when a later render fails). */
  svg: string | null;
  error: string | null;
}

export const EMPTY_RENDER: RenderState = { status: "idle", svg: null, error: null };

export type RenderAction =
  | { type: "start" }
  | { type: "ok"; svg: string }
  | { type: "fail"; error: string }
  | { type: "reset" };

export function renderReducer(state: RenderState, action: RenderAction): RenderState {
  switch (action.type) {
    case "start":
      return { ...state, status: "loading", error: null };
    case "ok":
      return { status: "ready", svg: action.svg, error: null };
    case "fail":
      // The last valid render is kept; only the error is recorded.
      return { ...state, status: "error", error: action.error };
    case "reset":
      return EMPTY_RENDER;
  }
}

/**
 * Design→requirement link derived from registered exact sources (used
 * version vs current version). Never from text matches.
 */
export interface DesignLink {
  artifactId: string;
  kind: string;
  link: "direct" | "transitive";
  /** Uses some version that is no longer the requirement current one. */
  stale: boolean;
  /** Requirement versions pinned by the design. */
  pinnedVersions: string[];
  /** Intermediate designs (transitive only). */
  via: string[];
}

/** Pinned source with its calculated freshness. */
export interface SourcePin {
  versionId: string;
  artifactId: string | null;
  currentVersionId: string | null;
  stale: boolean;
}

export interface LinkIndex {
  /** Designs linked per requirement (direct and transitive). */
  byRequirement: Record<string, DesignLink[]>;
  /** Freshness per design from its pinned sources. */
  freshness: Record<string, { stale: boolean; pins: SourcePin[] }>;
  /** Current version per known artifact. */
  currentByArtifact: Record<string, string>;
}

function currentOf(detail: RequirementDetail) {
  return detail.versions.find((v) => v.id === detail.currentVersionId);
}

/**
 * Builds the link index from authoritative details. Everything comes
 * from exact `sources` and current versions; an unknown version ID
 * (foreign to the loaded set) generates no links or marks.
 */
export function buildLinkIndex(details: RequirementDetail[]): LinkIndex {
  const versionToArtifact = new Map<string, string>();
  const currentByArtifact: Record<string, string> = {};
  const kindByArtifact = new Map<string, string>();
  for (const detail of details) {
    currentByArtifact[detail.artifact.id] = detail.currentVersionId;
    kindByArtifact.set(detail.artifact.id, detail.artifact.kind);
    for (const version of detail.versions) versionToArtifact.set(version.id, detail.artifact.id);
  }
  const designs = details.filter((d) => d.artifact.kind !== "requirement");
  const pinsByDesign = new Map<string, SourcePin[]>();
  // Design→design and design→requirement edges from the current version.
  const designToDesign = new Map<string, string[]>();
  const directReqs = new Map<string, Map<string, string[]>>();
  for (const design of designs) {
    const current = currentOf(design);
    const pins: SourcePin[] = [];
    const designsOut: string[] = [];
    const reqsOut = new Map<string, string[]>();
    for (const source of current?.sources ?? []) {
      const artifactId = versionToArtifact.get(source) ?? null;
      const currentVersionId = artifactId ? (currentByArtifact[artifactId] ?? null) : null;
      const stale = currentVersionId !== null && source !== currentVersionId;
      pins.push({ versionId: source, artifactId, currentVersionId, stale });
      if (artifactId === null) continue;
      if (kindByArtifact.get(artifactId) === "requirement") {
        const list = reqsOut.get(artifactId) ?? [];
        list.push(source);
        reqsOut.set(artifactId, list);
      } else if (artifactId !== design.artifact.id) {
        designsOut.push(artifactId);
      }
    }
    pinsByDesign.set(design.artifact.id, pins);
    designToDesign.set(design.artifact.id, designsOut);
    directReqs.set(design.artifact.id, reqsOut);
  }
  const freshness: LinkIndex["freshness"] = {};
  for (const [id, pins] of pinsByDesign) {
    freshness[id] = { stale: pins.some((p) => p.stale), pins };
  }
  // Transitives: designs reachable via other designs (BFS per requirement).
  const byRequirement: Record<string, DesignLink[]> = {};
  const requirementIds = details
    .filter((d) => d.artifact.kind === "requirement")
    .map((d) => d.artifact.id);
  for (const reqId of requirementIds) {
    const links: DesignLink[] = [];
    const seen = new Set<string>();
    // Directs first, in artifact order.
    for (const design of designs) {
      const pinned = directReqs.get(design.artifact.id)?.get(reqId);
      if (!pinned) continue;
      seen.add(design.artifact.id);
      links.push({
        artifactId: design.artifact.id,
        kind: design.artifact.kind,
        link: "direct",
        stale: pinned.some((v) => v !== currentByArtifact[reqId]),
        pinnedVersions: [...pinned],
        via: [],
      });
    }
    // Transitives via BFS over design→design, no repeats or cycles.
    const queue: Array<{ id: string; path: string[] }> = links.map((l) => ({
      id: l.artifactId,
      path: [l.artifactId],
    }));
    const transitives: DesignLink[] = [];
    while (queue.length > 0) {
      const head = queue.shift() as { id: string; path: string[] };
      for (const [designId, targets] of designToDesign) {
        if (seen.has(designId) || !targets.includes(head.id)) continue;
        seen.add(designId);
        const design = designs.find((d) => d.artifact.id === designId) as (typeof designs)[number];
        transitives.push({
          artifactId: designId,
          kind: design.artifact.kind,
          link: "transitive",
          stale: freshness[designId]?.stale ?? false,
          pinnedVersions: [],
          via: [...head.path],
        });
        queue.push({ id: designId, path: [...head.path, designId] });
      }
    }
    // Stable order: directs by id, then transitives by id.
    transitives.sort((a, b) => (a.artifactId < b.artifactId ? -1 : 1));
    byRequirement[reqId] = [...links, ...transitives];
  }
  return { byRequirement, freshness, currentByArtifact };
}
