// Coordinación pura de la vista de diseño: fusionar instantáneas de Rust,
// decidir acciones, editar JSON y retener el último render válido.
// Sin React ni Tauri: se prueba con vitest sin DOM.
import type { ArtifactDto, RequirementDetail } from "../requirements/types";
import type { DesignGenerationDto, DesignKind, DesignProposalDto } from "./types";

/**
 * Inserta o sustituye una generación manteniendo el orden de registro.
 * Las respuestas tardías se filtran antes (por módulo); aquí solo se fusiona.
 */
export function upsertDesignGeneration(
  generations: DesignGenerationDto[],
  incoming: DesignGenerationDto,
): DesignGenerationDto[] {
  const index = generations.findIndex((g) => g.id === incoming.id);
  if (index === -1) return [...generations, incoming];
  return generations.map((g, i) => (i === index ? incoming : g));
}

/** ¿Acepta acciones esta propuesta? Solo pendiente, fresca y sin trabajo. */
export function isDesignActionable(
  proposal: DesignProposalDto,
  stale: boolean,
  busy: boolean,
): boolean {
  return proposal.state === "pending" && !stale && !busy;
}

/** Artefactos de diseño del tipo pedido, candidatos a versionar al aceptar. */
export function designTargets(artifacts: ArtifactDto[], kind: DesignKind): ArtifactDto[] {
  return artifacts.filter((a) => a.kind === kind);
}

/** ¿La generación propone actualizar un diseño existente (no crear)? */
export function isUpdateGeneration(generation: DesignGenerationDto): boolean {
  return (
    generation.targetArtifactId !== null &&
    generation.targetArtifactId !== undefined &&
    generation.targetArtifactId !== ""
  );
}

/** Propuestas guardadas que actualizan un artefacto, en orden de registro. */
export function updateGenerationsFor(
  generations: DesignGenerationDto[],
  artifactId: string,
): DesignGenerationDto[] {
  return generations.filter((g) => g.targetArtifactId === artifactId);
}

/** La más reciente pendiente y fresca, si la hay (para retomar). */
export function resumableUpdate(
  generations: DesignGenerationDto[],
  artifactId: string,
): DesignGenerationDto | null {
  const candidates = updateGenerationsFor(generations, artifactId).filter(
    (g) => g.proposal.state === "pending" && !g.stale,
  );
  return candidates.length === 0 ? null : candidates[candidates.length - 1];
}

/** Texto canónico para el editor JSON (2 espacios, estable). */
export function prettySpec(spec: unknown): string {
  return JSON.stringify(spec, null, 2);
}

export type ParsedSpec =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parseo local previo: si el JSON no parsea, ni se llama a Rust. */
export function parseSpecText(text: string): ParsedSpec {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (raw) {
    const detail = raw instanceof Error ? raw.message : "JSON inválido";
    return { ok: false, error: `El texto no es JSON válido: ${detail}` };
  }
}

/** Estado de un diagrama: conserva el último SVG válido ante errores. */
export interface RenderState {
  status: "idle" | "loading" | "ready" | "error";
  /** Último SVG válido (se mantiene al fallar un render posterior). */
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
      // El último render válido se conserva; solo se anota el error.
      return { ...state, status: "error", error: action.error };
    case "reset":
      return EMPTY_RENDER;
  }
}

/**
 * Vínculo diseño→requisito derivado de fuentes exactas registradas (versión
 * usada frente a versión actual). Nunca por coincidencias de texto.
 */
export interface DesignLink {
  artifactId: string;
  kind: string;
  link: "direct" | "transitive";
  /** Usa alguna versión que ya no es la actual del requisito. */
  stale: boolean;
  /** Versiones del requisito fijadas por el diseño. */
  pinnedVersions: string[];
  /** Diseños intermedios (solo transitivos). */
  via: string[];
}

/** Fuente fijada con su vigencia calculada. */
export interface SourcePin {
  versionId: string;
  artifactId: string | null;
  currentVersionId: string | null;
  stale: boolean;
}

export interface LinkIndex {
  /** Diseños vinculados por requisito (directos y transitivos). */
  byRequirement: Record<string, DesignLink[]>;
  /** Vigencia por diseño según sus fuentes fijadas. */
  freshness: Record<string, { stale: boolean; pins: SourcePin[] }>;
  /** Versión actual por artefacto conocido. */
  currentByArtifact: Record<string, string>;
}

function currentOf(detail: RequirementDetail) {
  return detail.versions.find((v) => v.id === detail.currentVersionId);
}

/**
 * Construye el índice de vínculos desde detalles autoritativos. Todo sale
 * de `sources` exactas y versiones actuales; un ID de versión desconocido
 * (ajeno al conjunto cargado) no genera vínculos ni marcas.
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
  // Aristas diseño→diseño y diseño→requisito desde la versión actual.
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
  // Transitivos: diseños alcanzables vía otros diseños (BFS por requisito).
  const byRequirement: Record<string, DesignLink[]> = {};
  const requirementIds = details
    .filter((d) => d.artifact.kind === "requirement")
    .map((d) => d.artifact.id);
  for (const reqId of requirementIds) {
    const links: DesignLink[] = [];
    const seen = new Set<string>();
    // Directos primero, en orden de artefacto.
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
    // Transitivos por BFS sobre diseño→diseño, sin repetir ni ciclos.
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
    // Orden estable: directos por id, luego transitivos por id.
    transitives.sort((a, b) => (a.artifactId < b.artifactId ? -1 : 1));
    byRequirement[reqId] = [...links, ...transitives];
  }
  return { byRequirement, freshness, currentByArtifact };
}
