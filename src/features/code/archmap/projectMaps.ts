// Automatic project maps: which roots belong to the selected project and
// how their TypeScript files are collected. Pure except for the injected
// directory reader, so it stays testable without Tauri.
import type { CodeListingDto, CodeRootDto } from "../types";
import { MAX_MAP_FILES } from "./archModel";
import { isConfigFile, isTestFile } from "./mapFilter";

/** Map file cap per root: matches what the lane model can draw. */
export const PROJECT_MAP_MAX_FILES = MAX_MAP_FILES;

/** Guard against pathological trees: max directories walked per root. */
export const PROJECT_MAP_MAX_DIRS = 2000;

export function isTsFile(rel: string): boolean {
  return /\.(ts|tsx|mts|cts)$/i.test(rel);
}

/** Folders that hold tests or test tooling, by naming convention. */
const SECONDARY_DIR_NAMES = new Set(["e2e", "test", "tests", "__tests__", "__mocks__", "cypress"]);

/**
 * Secondary file: a test (`.spec.`/`.test.`), configuration
 * (`*.config.ts`, `environments/`), or anything under a test folder
 * (`e2e/`, `test/`, `tests/`, `__tests__/`, `__mocks__/`, `cypress/`).
 * Collected after the application code so the structure maps first.
 */
export function isSecondaryFile(rel: string): boolean {
  if (isTestFile(rel) || isConfigFile(rel)) return true;
  const dirs = rel.toLowerCase().split("/").slice(0, -1);
  return dirs.some((name) => SECONDARY_DIR_NAMES.has(name));
}

/** Associated, on-disk roots of a project, in workspace order. */
export function rootsOfProject(roots: CodeRootDto[], projectId: string): CodeRootDto[] {
  return roots.filter((root) => root.projectId === projectId && !root.missing);
}

/** Every associated root, including missing ones (for honest overviews). */
export function allRootsOfProject(roots: CodeRootDto[], projectId: string): CodeRootDto[] {
  return roots.filter((root) => root.projectId === projectId);
}

export interface CollectedScope {
  files: Array<{ rootId: string; rel: string }>;
  /** True when a cap stopped the walk: the map is partial. */
  truncated: boolean;
  /** Which cap stopped the walk first (null when complete). */
  truncatedBy: "files" | "dirs" | "listing" | null;
  /** Directories visited (for honest notices). */
  dirsVisited: number;
  /** Nested project subtrees left out of this scope. */
  excludedSubtrees: number;
  /** Build/dependency folders skipped by name. */
  skippedDirs: number;
}

/**
 * Build outputs and dependency folders skipped by default (the
 * backend already drops `.git`, `node_modules`, `target`, `dist`).
 */
export const COLLECT_SKIPPED_DIR_NAMES = [
  "build",
  "coverage",
  "__pycache__",
  ".angular",
  ".next",
  "vendor",
];

export interface CollectOptions {
  /** Folder the walk starts at (`""` is the root). */
  startRel?: string;
  /** Subtrees to leave out (nested independent projects). */
  excludeRels?: string[];
  /** Extra directory names to skip (defaults to build outputs). */
  excludeDirNames?: string[];
}

export type ListDirFn = (rootId: string, rel: string) => Promise<CodeListingDto>;

function isUnder(rel: string, prefix: string): boolean {
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

/**
 * Breadth-first walk in listing order (the backend already sorts
 * directories-first, case-insensitive). Application code comes first
 * and fills maxFiles; secondary files (tests, e2e, config) follow in
 * walk order with whatever room is left, so the first analysis batches
 * map the real structure. Stops at maxFiles with truncated=true. Skips anything that is not a file or dir
 * (symlinks arrive as "other" and are never followed), plus the
 * configured build folders and excluded subtrees.
 */
export async function collectTsScope(
  rootId: string,
  listDir: ListDirFn,
  maxFiles: number = PROJECT_MAP_MAX_FILES,
  maxDirs: number = PROJECT_MAP_MAX_DIRS,
  options: CollectOptions = {},
): Promise<CollectedScope> {
  const files: Array<{ rootId: string; rel: string }> = [];
  /** Tests, e2e and config: appended after the application code. */
  const secondary: Array<{ rootId: string; rel: string }> = [];
  const startRel = options.startRel ?? "";
  const excludeRels = options.excludeRels ?? [];
  const skipNames = new Set(
    (options.excludeDirNames ?? COLLECT_SKIPPED_DIR_NAMES).map((name) => name.toLowerCase()),
  );
  const queue: string[] = [startRel];
  let head = 0;
  let dirsVisited = 0;
  let truncated = false;
  let truncatedBy: CollectedScope["truncatedBy"] = null;
  let excludedSubtrees = 0;
  let skippedDirs = 0;
  const markTruncated = (reason: NonNullable<CollectedScope["truncatedBy"]>) => {
    truncated = true;
    if (truncatedBy === null) truncatedBy = reason;
  };
  while (head < queue.length) {
    if (files.length >= maxFiles) {
      markTruncated("files");
      break;
    }
    if (dirsVisited >= maxDirs) {
      markTruncated("dirs");
      break;
    }
    const dir = queue[head];
    head += 1;
    dirsVisited += 1;
    const listing = await listDir(rootId, dir);
    if (listing.truncated) markTruncated("listing");
    for (const entry of listing.entries) {
      if (entry.kind === "file") {
        if (files.length >= maxFiles) {
          markTruncated("files");
          break;
        }
        if (!isTsFile(entry.rel)) continue;
        if (!isSecondaryFile(entry.rel)) files.push({ rootId, rel: entry.rel });
        else if (secondary.length < maxFiles) secondary.push({ rootId, rel: entry.rel });
        else markTruncated("files");
      } else if (entry.kind === "dir") {
        if (excludeRels.some((prefix) => isUnder(entry.rel, prefix))) {
          excludedSubtrees += 1;
          continue;
        }
        if (skipNames.has(entry.name.toLowerCase())) {
          skippedDirs += 1;
          continue;
        }
        queue.push(entry.rel);
      }
    }
  }
  const room = Math.max(0, maxFiles - files.length);
  if (secondary.length > room) markTruncated("files");
  files.push(...secondary.slice(0, room));
  return { files, truncated, truncatedBy, dirsVisited, excludedSubtrees, skippedDirs };
}
