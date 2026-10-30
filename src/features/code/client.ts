// Code workspace client: `code_*` Tauri commands. Without Tauri
// (browser), an honest error: no disk is simulated.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import type {
  CodeAcceptDto,
  CodeEntryDto,
  CodeError,
  CodeFileDto,
  CodeGenContextDto,
  CodeGenerationDto,
  CodeLinkDto,
  CodeListingDto,
  CodeMockupScreensDto,
  CodeRootDto,
  CodeWriteDto,
  ProjectCodeLinksDto,
  ReplicateExecuteInput,
  ReplicatePreviewDto,
  ReplicateResultDto,
  SnapshotMetaDto,
  SnapshotVerifyDto,
} from "./types";

export { isTauriEnvironment };
export type {
  CodeAcceptDto,
  CodeEntryDto,
  CodeFileDto,
  CodeGenContextDto,
  CodeGenerationDto,
  CodeLinkDto,
  CodeListingDto,
  CodeMockupScreensDto,
  CodeRootDto,
  CodeWriteDto,
  ProjectCodeLinksDto,
  ReplicateExecuteInput,
  ReplicatePreviewDto,
  ReplicateResultDto,
  SnapshotMetaDto,
  SnapshotVerifyDto,
};

function notDesktop(): CodeError {
  return {
    kind: "not_tauri",
    message: "The code workspace requires desktop Ruth IDE.",
  };
}

export function normalizeCodeError(raw: unknown): CodeError {
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "unknown";
    const message =
      typeof record.message === "string" ? record.message : "Unknown code error.";
    return { kind, message };
  }
  if (typeof raw === "string") return { kind: "unknown", message: raw };
  return { kind: "unknown", message: "Unknown code error." };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) throw notDesktop();
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeCodeError(raw);
  }
}

export function listCodeRoots(): Promise<CodeRootDto[]> {
  return call("code_list_roots");
}

export function addCodeRoot(path: string, name?: string): Promise<CodeRootDto> {
  return call("code_add_root", { input: { path, name: name ?? null } });
}

export function removeCodeRoot(rootId: string): Promise<CodeRootDto> {
  return call("code_remove_root", { input: { rootId } });
}

export function listCodeDir(rootId: string, rel: string): Promise<CodeListingDto> {
  return call("code_list_dir", { input: { rootId, rel } });
}

export function readCodeFile(rootId: string, rel: string): Promise<CodeFileDto> {
  return call("code_read_file", { input: { rootId, rel } });
}

export function writeCodeFile(
  rootId: string,
  rel: string,
  expectedFingerprint: string,
  content: string,
  force: boolean,
): Promise<CodeWriteDto> {
  return call("code_write_file", {
    input: { rootId, rel, expectedFingerprint, content, force },
  });
}

export function analyzeRust(
  files: Array<{ rootId: string; rel: string }>,
): Promise<import("./structure/structureTypes").StructureResult> {
  return call("code_analyze_rust", {
    input: { files: files.map((file) => ({ rootId: file.rootId, rel: file.rel })) },
  });
}

export function setRootProject(rootId: string, projectId: string | null): Promise<CodeRootDto> {
  return call("code_set_root_project", { input: { rootId, projectId } });
}

export function addModuleLink(
  moduleId: string,
  rootId: string,
  rel: string,
): Promise<CodeLinkDto> {
  return call("code_add_module_link", { input: { moduleId, rootId, rel } });
}

export function addSymbolLink(
  artifactId: string,
  rootId: string,
  rel: string,
  symbol: {
    id: string;
    name: string;
    kind: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    hash: string;
  },
): Promise<CodeLinkDto> {
  return call("code_add_symbol_link", { input: { artifactId, rootId, rel, symbol } });
}

export function removeCodeLink(id: string): Promise<string> {
  return call("code_remove_link", { input: { id } });
}

export function listCodeLinks(
  scope: "module" | "artifact",
  ownerId: string,
): Promise<CodeLinkDto[]> {
  return call("code_list_links", { input: { scope, ownerId } });
}

export function listProjectLinks(projectId: string): Promise<ProjectCodeLinksDto> {
  return call("code_project_links", { input: { projectId } });
}

export function replicatePreview(
  rootId: string,
  base?: string,
): Promise<ReplicatePreviewDto> {
  return call("code_replicate_preview", { input: { rootId, base: base ?? null } });
}

export function replicateExecute(input: ReplicateExecuteInput): Promise<ReplicateResultDto> {
  return call("code_replicate_execute", { input });
}

export function saveSnapshot(
  projectId: string | null,
  name: string,
  result: import("./structure/structureTypes").StructureResult,
): Promise<SnapshotMetaDto> {
  return call("code_save_snapshot", { input: { projectId, name, result } });
}

export function listSnapshots(projectId: string | null): Promise<SnapshotMetaDto[]> {
  return call("code_list_snapshots", { input: { projectId } });
}

export function getSnapshot(
  id: string,
): Promise<{
  meta: SnapshotMetaDto;
  result: import("./structure/structureTypes").StructureResult;
}> {
  return call("code_get_snapshot", { input: { id } });
}

export function deleteSnapshot(id: string): Promise<string> {
  return call("code_delete_snapshot", { input: { id } });
}

export function verifySnapshot(id: string): Promise<SnapshotVerifyDto> {
  return call("code_verify_snapshot", { input: { id } });
}

export interface CodeScopeInput {
  rootId: string;
  rel: string;
}

export type CodeGenSourceInput =
  | { kind: "requirement"; artifactId: string }
  | { kind: "screen"; mockupId: string; screenId: string };

export interface CodeGenRequest {
  projectId: string;
  moduleId: string;
  source: CodeGenSourceInput;
  scope: CodeScopeInput[];
}

export function genCodeContext(input: CodeGenRequest): Promise<CodeGenContextDto> {
  return call("code_gen_context", { input });
}

export function listMockupScreens(
  projectId: string,
  moduleId: string,
): Promise<CodeMockupScreensDto[]> {
  return call("code_mockup_screens", { input: { projectId, moduleId } });
}

export function generateCode(input: CodeGenRequest): Promise<CodeGenerationDto> {
  return call("code_generate", { input });
}

export function listCodeGenerations(moduleId: string): Promise<CodeGenerationDto[]> {
  return call("code_list_generations", { input: { moduleId } });
}

export function acceptCodeFile(generationId: string, pos: number): Promise<CodeAcceptDto> {
  return call("code_accept_file", { input: { generationId, pos } });
}

export function discardCodeFile(generationId: string, pos: number): Promise<CodeGenerationDto> {
  return call("code_discard_file", { input: { generationId, pos } });
}
