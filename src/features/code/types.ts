// Code workspace types: roots, listings and tabs. The frontend only
// handles root IDs + relative paths; Rust resolves. No file content is
// persisted in SQLite: tabs are session memory.
export interface CodeRootDto {
  id: string;
  path: string;
  name: string;
  missing: boolean;
  /** Associated project (`null` = loose folder, no project). */
  projectId: string | null;
}

export type CodeEntryKind = "file" | "dir" | "other";

export interface CodeEntryDto {
  name: string;
  rel: string;
  kind: CodeEntryKind;
  size: number | null;
}

export interface CodeListingDto {
  entries: CodeEntryDto[];
  truncated: boolean;
}

export interface CodeFileDto {
  text: string;
  fingerprint: string;
  size: number;
}

export interface CodeError {
  kind: string;
  message: string;
}

/** Open tab: identified by root + path, no duplicates. */
export interface CodeTab {
  rootId: string;
  rootName: string;
  rel: string;
  name: string;
  content: CodeFileDto | null;
  error: CodeError | null;
  loading: boolean;
  /** On-disk text (draft reference; Monaco holds the live one). */
  savedText: string | null;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  /** Chosen Monaco language (highlighting, not semantic analysis). */
  language: string;
}

export interface CodeWriteDto {
  fingerprint: string;
  size: number;
}

/** Save conflict: the disk changed since the read. */
export interface CodeConflict {
  key: string;
  /** Current disk content for comparison. */
  diskText: string;
  diskFingerprint: string;
}

export type CodeLinkScope = "module" | "artifact";
export type CodeLinkKind = "manual" | "detected" | "inferred";

export interface CodeSymbolRefDto {
  id: string;
  name: string;
  kind: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  hash: string;
}

/** Code↔knowledge link: owner + path + optional symbol. */
export interface CodeLinkDto {
  id: string;
  scope: CodeLinkScope;
  ownerId: string;
  rootId: string;
  rootName: string | null;
  rootMissing: boolean;
  rel: string;
  symbol: CodeSymbolRefDto | null;
  kind: CodeLinkKind;
  createdAt: string;
}

export interface ProjectCodeLinksDto {
  moduleLinks: CodeLinkDto[];
  artifactLinks: CodeLinkDto[];
}

export interface SnapshotFileDto {
  rootId: string;
  rootName: string | null;
  rel: string;
  hash: string;
  bytes: number;
}

/** Saved snapshot: metadata + files with origin hash. */
export interface SnapshotMetaDto {
  id: string;
  projectId: string | null;
  name: string;
  createdAt: string;
  files: SnapshotFileDto[];
  symbolCount: number;
  relationCount: number;
}

export interface SnapshotVerifyFileDto {
  rootId: string;
  rel: string;
  status: "fresh" | "stale" | "missing" | "error";
  message: string | null;
}

export interface SnapshotVerifyDto {
  files: SnapshotVerifyFileDto[];
  stale: boolean;
}

/** Proposed file: FULL content + individual state. */
export interface CodeProposalFileDto {
  pos: number;
  rootId: string;
  rel: string;
  /** `create` or `modify`. */
  operation: string;
  /** `pending`, `accepted` or `discarded`. */
  state: string;
  decidedAt: string | null;
  content: string;
  expectedFingerprint: string | null;
}

export interface CodeGenScopeDto {
  rootId: string;
  rel: string;
  fingerprint: string;
}

export interface CodeUsageDto {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface CodeScreenSourceRefDto {
  artifactId: string;
  versionId: string;
}

/** Code generation with its context and computed freshness. */
export interface CodeGenerationDto {
  id: string;
  projectId: string;
  moduleId: string;
  requirementArtifactId: string;
  requirementVersionId: string;
  /** Origin screen (empty with a requirement origin) and its sources. */
  screenArtifactId: string;
  screenId: string;
  screenVersionId: string;
  screenSources: CodeScreenSourceRefDto[];
  model: string;
  templateVersion: number;
  usage: CodeUsageDto;
  createdAt: string;
  explanation: string;
  assumptions: string[];
  questions: string[];
  scope: CodeGenScopeDto[];
  files: CodeProposalFileDto[];
  stale: boolean;
  staleReason: string | null;
}

export interface CodeScopeReadDto {
  rootId: string;
  rel: string;
  fingerprint: string;
  bytes: number;
  chars: number;
}

export interface CodeScreenSourceDto {
  artifactId: string;
  versionId: string;
  chars: number;
}

/** Context preview (without contents) before generating. */
export interface CodeGenContextDto {
  projectId: string;
  moduleId: string;
  /** Origin: requirement or mockup, with its exact version. */
  artifactId: string;
  versionId: string;
  requirementChars: number;
  /** Origin screen (empty/zero with a requirement origin). */
  screenId: string;
  screenTitle: string;
  screenChars: number;
  screenSources: CodeScreenSourceDto[];
  files: CodeScopeReadDto[];
  totalChars: number;
}

export interface CodeMockupScreenDto {
  id: string;
  title: string;
}

/** Proposable mockup with its screens (current saved version). */
export interface CodeMockupScreensDto {
  artifactId: string;
  title: string;
  versionId: string;
  screens: CodeMockupScreenDto[];
}

export interface ReplicateEntryDto {
  name: string;
  rel: string;
  linkedModule: string | null;
}

export interface ReplicatePreviewDto {
  rootId: string;
  base: string;
  suggested: boolean;
  reason: string;
  entries: ReplicateEntryDto[];
  excluded: string[];
  truncated: boolean;
  overCap: boolean;
}

export type ReplicateTargetInput =
  | { kind: "new"; name: string }
  | { kind: "existing"; projectId: string };

export interface ReplicateExecuteInput {
  rootId: string;
  base: string;
  rels: string[];
  target: ReplicateTargetInput;
}

export interface ReplicatedModuleDto {
  moduleId: string;
  name: string;
  rel: string;
}

export interface ReplicateResultDto {
  projectId: string;
  projectName: string;
  projectCreated: boolean;
  modules: ReplicatedModuleDto[];
  alreadyLinked: string[];
  root: CodeRootDto;
}

export interface CodeAcceptDto {
  generation: CodeGenerationDto;
  alreadyAccepted: boolean;
  fingerprint: string | null;
  size: number | null;
}
