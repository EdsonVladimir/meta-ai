// Adaptador Tauri para requisitos. Cada mutación devuelve la instantánea
// autoritativa de Rust; la interfaz actualiza desde ella.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import {
  normalizeCoreError,
  type ArchivePreviewDto,
  type ArtifactDto,
  type CoreApiError,
  type CoreStatus,
  type ModuleDto,
  type ProjectDto,
  type RequirementDetail,
} from "./types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "Las operaciones del núcleo requieren ejecutar Ruth IDE como escritorio (Tauri).",
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

export function coreStatus(): Promise<CoreStatus> {
  return call("core_status");
}

export function listProjects(): Promise<ProjectDto[]> {
  return call("core_list_projects");
}

export function createProject(): Promise<ProjectDto> {
  return call("core_create_project");
}

export function listModules(projectId: string): Promise<ModuleDto[]> {
  return call("core_list_modules", { input: { projectId } });
}

export function createModule(projectId: string): Promise<ModuleDto> {
  return call("core_create_module", { input: { projectId } });
}

export function listRequirements(projectId: string, moduleId: string): Promise<ArtifactDto[]> {
  return call("core_list_requirements", { input: { projectId, moduleId } });
}

export function createRequirement(input: {
  projectId: string;
  moduleId: string;
  content: string;
  author: string;
}): Promise<RequirementDetail> {
  return call("core_create_requirement", { input });
}

export function getRequirement(artifactId: string): Promise<RequirementDetail> {
  return call("core_get_requirement", { input: { artifactId } });
}

export function saveVersion(input: {
  projectId: string;
  artifactId: string;
  expectedVersionId: string;
  content: string;
  author: string;
}): Promise<RequirementDetail> {
  return call("core_save_version", { input });
}

export function approveVersion(input: {
  projectId: string;
  artifactId: string;
  expectedVersionId: string;
  approver: string;
}): Promise<RequirementDetail> {
  return call("core_approve_version", { input });
}

export function archivePreview(input: {
  projectId: string;
  kind: string;
  id: string;
}): Promise<ArchivePreviewDto> {
  return call("core_archive_preview", { input });
}

export function archiveModule(input: {
  projectId: string;
  moduleId: string;
}): Promise<ModuleDto> {
  return call("core_archive_module", { input });
}

export function restoreModule(input: {
  projectId: string;
  moduleId: string;
}): Promise<ModuleDto> {
  return call("core_restore_module", { input });
}

export function deleteModule(input: {
  projectId: string;
  moduleId: string;
}): Promise<string> {
  return call("core_delete_module", { input });
}

export function archiveRequirement(input: {
  projectId: string;
  artifactId: string;
}): Promise<RequirementDetail> {
  return call("core_archive_requirement", { input });
}

export function restoreRequirement(input: {
  projectId: string;
  artifactId: string;
}): Promise<RequirementDetail> {
  return call("core_restore_requirement", { input });
}

export function deleteRequirement(input: {
  projectId: string;
  artifactId: string;
}): Promise<string> {
  return call("core_delete_requirement", { input });
}

export function renameProject(input: {
  projectId: string;
  expectedName: string;
  name: string;
}): Promise<ProjectDto> {
  return call("core_rename_project", { input });
}

export function renameModule(input: {
  projectId: string;
  moduleId: string;
  expectedName: string;
  name: string;
}): Promise<ModuleDto> {
  return call("core_rename_module", { input });
}

export function renameRequirement(input: {
  projectId: string;
  artifactId: string;
  expectedTitle: string | null;
  title: string;
  by: string;
}): Promise<RequirementDetail> {
  return call("core_rename_requirement", { input });
}
