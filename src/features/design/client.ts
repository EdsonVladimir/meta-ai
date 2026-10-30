// Tauri adapter for requirement-linked design. Network, key and
// validation live only in Rust; only commands are invoked here.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError, type CoreApiError } from "../requirements/types";
import type {
  DesignDiffDto,
  DesignGenerationDto,
  DesignKind,
  UpdateContextPreview,
  ValidatedDesignDto,
} from "./types";
import type { ArtifactDto, RequirementDetail } from "../requirements/types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "Design requires running Ruth IDE as a desktop app (Tauri).",
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

export function updateContext(input: {
  projectId: string;
  artifactId: string;
  originArtifactId?: string | null;
  originFromVersionId?: string | null;
}): Promise<UpdateContextPreview> {
  return call("core_update_context", { input });
}

export function proposeDesignUpdate(input: {
  projectId: string;
  artifactId: string;
  originArtifactId?: string | null;
  originFromVersionId?: string | null;
}): Promise<DesignGenerationDto> {
  return call("core_propose_design_update", { input });
}

export function designDiff(input: {
  kind: DesignKind;
  oldSpec: unknown;
  newSpec: unknown;
}): Promise<DesignDiffDto> {
  return call("core_design_diff", { input });
}

export function saveDesignVersion(input: {
  projectId: string;
  artifactId: string;
  expectedVersionId: string;
  author: string;
  spec: unknown;
  sourceVersionIds: string[];
  layout?: unknown;
}): Promise<RequirementDetail> {
  return call("core_save_design_version", { input });
}

export function designLayout(
  artifactId: string,
  versionId: string,
): Promise<{ layout: unknown }> {
  return call("core_design_layout", { input: { artifactId, versionId } });
}

export function saveDesignLayout(input: {
  artifactId: string;
  versionId: string;
  layout: unknown;
}): Promise<void> {
  return call("core_save_design_layout", { input });
}

export function renameDesign(input: {
  projectId: string;
  artifactId: string;
  expectedTitle: string | null;
  title: string;
  by: string;
}): Promise<RequirementDetail> {
  return call("core_rename_design", { input });
}
