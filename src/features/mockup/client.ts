// Tauri adapter for mockups. Validation and persistence live only in
// Rust; only commands are invoked here. The layout is read and saved
// with the generic design commands (per artifact and version).
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import { normalizeCoreError, type CoreApiError } from "../requirements/types";
import type { DesignGenerationDto, DesignKind, UpdateSourceDto } from "../design/types";
import type { RequirementDetail } from "../requirements/types";
import type { MockupContextPreview, MockupGeneration } from "./types";

function ensureTauri(): void {
  if (!isTauriEnvironment()) {
    throw {
      kind: "not_tauri",
      message: "Mockups require running Ruth IDE as a desktop app (Tauri).",
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

export function createMockup(input: {
  projectId: string;
  moduleId: string;
  author: string;
  spec: unknown;
  sourceVersionIds: string[];
  layout?: unknown;
}): Promise<RequirementDetail> {
  return call("core_create_mockup", { input });
}

export function saveMockupVersion(input: {
  projectId: string;
  artifactId: string;
  expectedVersionId: string;
  author: string;
  spec: unknown;
  sourceVersionIds: string[];
  layout?: unknown;
}): Promise<RequirementDetail> {
  return call("core_save_mockup_version", { input });
}

export function mockupContext(
  projectId: string,
  moduleId: string,
): Promise<MockupContextPreview> {
  return call("core_mockup_context", { input: { projectId, moduleId } });
}

export interface ValidatedMockupDto {
  canonical: string;
  title: string;
  screens: number;
  components: number;
}

export function validateMockup(spec: unknown): Promise<ValidatedMockupDto> {
  return call("core_validate_mockup", { input: { spec } });
}

export function mockupSources(
  projectId: string,
  artifactId: string,
): Promise<UpdateSourceDto[]> {
  return call("core_mockup_sources", { input: { projectId, artifactId } });
}

export function generateDesignFromMockups(input: {
  projectId: string;
  moduleId: string;
  kind: DesignKind;
  requirementIds: string[];
  mockupIds: string[];
}): Promise<DesignGenerationDto> {
  return call("core_generate_design_from_mockups", { input });
}

export function proposeMockups(input: {
  projectId: string;
  moduleId: string;
  requirementIds: string[];
}): Promise<MockupGeneration> {
  return call("core_propose_mockups", { input });
}

export function listMockupGenerations(
  projectId: string,
  moduleId: string,
): Promise<MockupGeneration[]> {
  return call("core_list_mockup_generations", { input: { projectId, moduleId } });
}

export function acceptMockupScreen(input: {
  generationId: string;
  tempId: string;
}): Promise<RequirementDetail> {
  return call("core_accept_mockup_screen", { input });
}

export function discardMockupScreen(input: {
  generationId: string;
  tempId: string;
}): Promise<void> {
  return call("core_discard_mockup_screen", { input });
}
