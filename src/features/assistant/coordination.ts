// Pure assistant coordination: combined history and explicit sending. No
// React, no Tauri. There is no classifier: free text never picks an action;
// it only feeds one when the action allows it.
import type { DesignGenerationDto } from "../design/types";
import type { GenerationDto } from "../proposals/types";
import {
  ASSISTANT_HISTORY_LIMIT,
  type AssistantAction,
  type AssistantHistoryEntry,
} from "./types";

function tokensLabel(input?: number | null, output?: number | null, total?: number | null): string {
  if (total === null || total === undefined) return "tokens n/a";
  return `${input ?? "?"}+${output ?? "?"} = ${total}`;
}

/**
 * Merges requirement and design generations into one history, ordered by
 * descending creation and bounded. Update proposals tell apart by their
 * pinned target.
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
            : `${generation.proposals.length} proposals`,
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
 * What Send does: requires an explicit action and non-empty text. The text
 * only feeds Propose requirements (`feedComposer`); other actions use their
 * marked sources and ignore it (warning, never faking).
 */
export function resolveSend(selected: AssistantAction | null, message: string): SendResolution {
  if (selected === null) return { ok: false, reason: "no_action" };
  if (message.trim() === "") return { ok: false, reason: "empty" };
  return { ok: true, action: selected, feedComposer: selected === "requirements" };
}

export function assistantActionLabel(action: AssistantAction): string {
  return action === "requirements"
    ? "Propose requirements"
    : action === "design"
      ? "Generate flow or ER"
      : "Propose update";
}
