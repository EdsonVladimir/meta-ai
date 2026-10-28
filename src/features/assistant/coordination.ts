// Coordinación pura del asistente: historial combinado y envío explícito.
// Sin React ni Tauri. No hay clasificador: el texto libre jamás elige una
// acción; solo la alimenta cuando la acción lo admite.
import type { DesignGenerationDto } from "../design/types";
import type { GenerationDto } from "../proposals/types";
import {
  ASSISTANT_HISTORY_LIMIT,
  type AssistantAction,
  type AssistantHistoryEntry,
} from "./types";

function tokensLabel(input?: number | null, output?: number | null, total?: number | null): string {
  if (total === null || total === undefined) return "tokens n/d";
  return `${input ?? "?"}+${output ?? "?"} = ${total}`;
}

/**
 * Combina generaciones de requisitos y diseños en un historial único,
 * ordenado por creación descendente y acotado. Las propuestas de
 * actualización se distinguen por su objetivo fijado.
 */
export function mergeAssistantHistory(
  requirements: GenerationDto[],
  designs: DesignGenerationDto[],
): AssistantHistoryEntry[] {
  const entries: AssistantHistoryEntry[] = [
    ...requirements.map(
      (generation): AssistantHistoryEntry => ({
        id: generation.id,
        kind: "requirements",
        title:
          generation.proposals.length === 1
            ? (generation.proposals[0]?.title ?? generation.id)
            : `${generation.proposals.length} propuestas`,
        model: generation.model,
        tokens: tokensLabel(
          generation.usage.inputTokens,
          generation.usage.outputTokens,
          generation.usage.totalTokens,
        ),
        createdAt: generation.createdAt,
        stale: generation.stale,
        openCount: generation.proposals.filter((p) => p.state === "pending").length,
      }),
    ),
    ...designs.map(
      (generation): AssistantHistoryEntry => ({
        id: generation.id,
        kind:
          generation.targetArtifactId !== null && generation.targetArtifactId !== undefined
            ? "update"
            : "design",
        title: generation.proposal.title,
        model: generation.model,
        tokens: tokensLabel(
          generation.usage.inputTokens,
          generation.usage.outputTokens,
          generation.usage.totalTokens,
        ),
        createdAt: generation.createdAt,
        stale: generation.stale,
        openCount: generation.proposal.state === "pending" ? 1 : 0,
      }),
    ),
  ];
  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return entries.slice(0, ASSISTANT_HISTORY_LIMIT);
}

export type SendResolution =
  | { ok: true; action: AssistantAction; feedComposer: boolean }
  | { ok: false; reason: "no_action" | "empty" };

/**
 * Qué hace Enviar: exige acción explícita y texto no vacío. El texto solo
 * alimenta Proponer requisitos (`feedComposer`); las demás acciones usan
 * sus fuentes marcadas y lo ignoran (avisando, sin simular).
 */
export function resolveSend(selected: AssistantAction | null, message: string): SendResolution {
  if (selected === null) return { ok: false, reason: "no_action" };
  if (message.trim() === "") return { ok: false, reason: "empty" };
  return { ok: true, action: selected, feedComposer: selected === "requirements" };
}

export function assistantActionLabel(action: AssistantAction): string {
  return action === "requirements"
    ? "Proponer requisitos"
    : action === "design"
      ? "Generar flujo o ER"
      : "Proponer actualización";
}
