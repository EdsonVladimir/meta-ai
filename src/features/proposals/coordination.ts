// Coordinación pura del panel de generación: fusionar instantáneas de Rust
// sin perder ediciones locales, y decidir qué acciones ofrece cada propuesta.
// Sin React ni Tauri: se prueba con vitest sin DOM.
import type { GenerationDto, ProposalDto } from "./types";

/**
 * Inserta o sustituye una generación manteniendo el orden de registro.
 * Las respuestas tardías se filtran antes (por módulo); aquí solo se fusiona.
 */
export function upsertGeneration(
  generations: GenerationDto[],
  incoming: GenerationDto,
): GenerationDto[] {
  const index = generations.findIndex((g) => g.id === incoming.id);
  if (index === -1) return [...generations, incoming];
  return generations.map((g, i) => (i === index ? incoming : g));
}

/** ¿Acepta acciones esta propuesta? Solo pendiente, fresca y sin trabajo. */
export function isActionable(
  proposal: ProposalDto,
  stale: boolean,
  busy: boolean,
): boolean {
  return proposal.state === "pending" && !stale && !busy;
}

/** Borrador editable de una tarjeta: los criterios van uno por línea. */
export interface ProposalEdit {
  title: string;
  description: string;
  acceptance: string;
  assumptions: string;
}

export function editFromProposal(proposal: ProposalDto): ProposalEdit {
  return {
    title: proposal.title,
    description: proposal.description,
    acceptance: proposal.acceptance.join("\n"),
    assumptions: proposal.assumptions.join("\n"),
  };
}

/** Parte un área multilínea en elementos no vacíos para enviar a Rust. */
export function splitItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
