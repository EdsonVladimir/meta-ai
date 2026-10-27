// Adaptador Tauri para diseño vinculado a requisitos. La red, la clave y
// la validación viven solo en Rust; aquí solo se invocan comandos.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError, type CoreApiError } from "../requirements/types";
import type {
  DesignContextPreview,
  DesignGenerationDto,
  DesignKind,
  ValidatedDesignDto,
} from "./types";
import type { ArtifactDto, RequirementDetail } from "../requirements/types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "El diseño requiere ejecutar Ruth IDE como escritorio (Tauri).",
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

export function designContext(
  projectId: string,
  moduleId: string,
): Promise<DesignContextPreview[]> {
  return call("core_design_context", { input: { projectId, moduleId } });
}

export function listArtifacts(projectId: string, moduleId: string): Promise<ArtifactDto[]> {
  return call("core_list_artifacts", { input: { projectId, moduleId } });
}

export function listDesigns(projectId: string, moduleId: string): Promise<DesignGenerationDto[]> {
  return call("core_list_designs", { input: { projectId, moduleId } });
}

export function generateDesign(input: {
  projectId: string;
  moduleId: string;
  kind: DesignKind;
  requirementIds: string[];
}): Promise<DesignGenerationDto> {
  return call("core_generate_design", { input });
}

export function validateDesign(input: {
  kind: DesignKind;
  spec: unknown;
  generationId?: string | null;
}): Promise<ValidatedDesignDto> {
  return call("core_validate_design", { input });
}

export function acceptDesign(input: {
  generationId: string;
  spec: unknown;
  targetArtifactId?: string | null;
  expectedVersionId?: string | null;
}): Promise<RequirementDetail> {
  return call("core_accept_design", { input });
}

export function discardDesign(generationId: string): Promise<void> {
  return call("core_discard_design", { input: { generationId } });
}

export function approveDesign(input: {
  projectId: string;
  artifactId: string;
  expectedVersionId: string;
  approver: string;
}): Promise<RequirementDetail> {
  return call("core_approve_design", { input });
}
