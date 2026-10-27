// Coordinación pura de la vista de diseño: fusionar instantáneas de Rust,
// decidir acciones, editar JSON y retener el último render válido.
// Sin React ni Tauri: se prueba con vitest sin DOM.
import type { ArtifactDto } from "../requirements/types";
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
