// Tauri adapter for assisted generation. Network and key live in Rust
// only; here commands are invoked and errors normalized.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError, type CoreApiError } from "../requirements/types";
import type {
  AcceptProposalFields,
  GenerationContextPreview,
  GenerationDto,
} from "./types";
import type { RequirementDetail } from "../requirements/types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "Assisted generation requires running Ruth IDE as a desktop app (Tauri).",
    } satisfies CoreApiError;
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  ensureTauri();
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeCoreError(raw);
  }
}

export function generationContext(
  projectId: string,
  moduleId: string,
): Promise<GenerationContextPreview[]> {
  return call("core_generation_context", { input: { projectId, moduleId } });
}

export function proposeRequirements(input: {
  projectId: string;
  moduleId: string;
  description: string;
}): Promise<GenerationDto> {
  return call("core_propose_requirements", { input });
}

export function listGenerations(
  projectId: string,
  moduleId: string,
): Promise<GenerationDto[]> {
  return call("core_list_generations", { input: { projectId, moduleId } });
}

export function acceptProposal(
  input: { generationId: string; tempId: string } & AcceptProposalFields,
): Promise<RequirementDetail> {
  return call("core_accept_proposal", { input });
}

export function discardProposal(input: {
  generationId: string;
  tempId: string;
}): Promise<void> {
  return call("core_discard_proposal", { input });
}
