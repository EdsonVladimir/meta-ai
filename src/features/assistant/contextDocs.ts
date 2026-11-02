// Doc suggestions for the Muse project context: a pure function
// over directory listings, plus the small scan that collects them.
// Order per root: AGENTS.md, CLAUDE.md, README.md, then the docs tree,
// then a README.md in each detected service. Blocked roots and the
// folders the map already skips stay out. No file content is read to
// suggest: sizes come from the listings.
import { discoverRootProjects } from "../code/detectProjects";
import { COLLECT_SKIPPED_DIR_NAMES } from "../code/archmap/projectMaps";
import type { CodeEntryDto, CodeFileDto, CodeListingDto, CodeRootDto } from "../code/types";

/** Suggestions listed per scan, across every root. */
export const CONTEXT_DOC_SUGGESTIONS_MAX = 40;
/** Default-checked suggestions: the first of the ordered list. */
export const CONTEXT_DOC_DEFAULT_SELECTED = 8;

/** Folders the backend already drops from listings (mirrored defensively). */
const BACKEND_SKIPPED_DIR_NAMES = ["node_modules", ".git", "target", "dist"];

const SKIPPED_DIRS = new Set(
  [...COLLECT_SKIPPED_DIR_NAMES, ...BACKEND_SKIPPED_DIR_NAMES].map((name) => name.toLowerCase()),
);

export interface ContextDocSuggestion {
  rootId: string;
  rel: string;
  size: number | null;
}

export interface ContextDocSuggestions {
  /** Ordered suggestions, at most CONTEXT_DOC_SUGGESTIONS_MAX. */
  suggestions: ContextDocSuggestion[];
  /** The default selection: the first CONTEXT_DOC_DEFAULT_SELECTED. */
  defaultSelected: ContextDocSuggestion[];
}

function isFile(entry: CodeEntryDto): boolean {
  return entry.kind === "file";
}

function isMd(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/**
 * Suggests docs from directory listings. Pure: roots in workspace
 * order; per root, AGENTS.md, CLAUDE.md, README.md, then the docs tree
 * in walk order, then a README.md in each detected service. A file
 * appears once, at its first category. Blocked and missing roots stay
 * out, and so do the folders the map already skips.
 */
export function suggestContextDocs(input: {
  roots: Array<{ id: string; blocked: boolean; missing: boolean }>;
  /** Root listing entries by root id. */
  rootEntries: Map<string, CodeEntryDto[]>;
  /** Deeper listings by `rootId::rel`. */
  dirEntries: Map<string, CodeEntryDto[]>;
  /** Detected services, in listing order. */
  services: Array<{ rootId: string; rel: string }>;
}): ContextDocSuggestions {
  const suggestions: ContextDocSuggestion[] = [];
  const seen = new Set<string>();
  const push = (rootId: string, rel: string, size: number | null): void => {
    if (suggestions.length >= CONTEXT_DOC_SUGGESTIONS_MAX) return;
    const key = `${rootId}::${rel}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ rootId, rel, size });
  };
  for (const root of input.roots) {
    if (root.blocked || root.missing) continue;
    const entries = input.rootEntries.get(root.id) ?? [];
    const atRoot = (name: string): CodeEntryDto | undefined =>
      entries.find((entry) => isFile(entry) && entry.name.toLowerCase() === name);
    for (const name of ["agents.md", "claude.md", "readme.md"]) {
      const found = atRoot(name);
      if (found !== undefined) push(root.id, found.rel, found.size);
    }
    // docs/** in walk order (listings arrive sorted from the backend).
    const docsDir = entries.find(
      (entry) => entry.kind === "dir" && entry.name.toLowerCase() === "docs",
    );
    if (docsDir !== undefined) {
      const queue = [docsDir.rel];
      const visited = new Set<string>([`${root.id}::${docsDir.rel}`]);
      for (let head = 0; head < queue.length; head += 1) {
        if (suggestions.length >= CONTEXT_DOC_SUGGESTIONS_MAX) break;
        const dir = queue[head];
        const listed = input.dirEntries.get(`${root.id}::${dir}`) ?? [];
        for (const entry of listed) {
          if (entry.kind === "file") {
            if (isMd(entry.name)) push(root.id, entry.rel, entry.size);
          } else if (entry.kind === "dir") {
            const key = `${root.id}::${entry.rel}`;
            if (visited.has(key) || SKIPPED_DIRS.has(entry.name.toLowerCase())) continue;
            visited.add(key);
            queue.push(entry.rel);
          }
        }
      }
    }
    for (const service of input.services) {
      if (service.rootId !== root.id) continue;
      const parent =
        service.rel === "" ? entries : (input.dirEntries.get(`${root.id}::${service.rel}`) ?? []);
      const found = parent.find(
        (entry) => isFile(entry) && entry.name.toLowerCase() === "readme.md",
      );
      if (found !== undefined) push(root.id, found.rel, found.size);
    }
  }
  return {
    suggestions,
    defaultSelected: suggestions.slice(0, CONTEXT_DOC_DEFAULT_SELECTED),
  };
}

/** Human size for the checklist (`null` = unknown). */
export function formatDocSize(size: number | null): string {
  if (size === null) return "unknown size";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  return kb < 1024 ? `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Collects the listings `suggestContextDocs` needs: one root listing
 * per root, the docs/** tree, one listing per detected service folder,
 * and fresh discovery (cached per session). Unreadable roots, folders
 * and discovery failures are skipped silently: suggestions stay a
 * best effort, and the person reviews the list.
 */
export async function scanContextDocs(
  roots: CodeRootDto[],
  deps: {
    listDir: (rootId: string, rel: string) => Promise<CodeListingDto>;
    readFile: (rootId: string, rel: string) => Promise<CodeFileDto>;
  },
): Promise<ContextDocSuggestions> {
  const rootEntries = new Map<string, CodeEntryDto[]>();
  const dirEntries = new Map<string, CodeEntryDto[]>();
  const services: Array<{ rootId: string; rel: string }> = [];
  const listed = async (rootId: string, rel: string): Promise<CodeEntryDto[] | null> => {
    try {
      return (await deps.listDir(rootId, rel)).entries;
    } catch {
      return null;
    }
  };
  for (const root of roots) {
    if (root.aiBlocked || root.missing) continue;
    const entries = await listed(root.id, "");
    if (entries === null) continue;
    rootEntries.set(root.id, entries);
    const docsDir = entries.find(
      (entry) => entry.kind === "dir" && entry.name.toLowerCase() === "docs",
    );
    if (docsDir !== undefined) {
      const queue = [docsDir.rel];
      const visited = new Set<string>([`${root.id}::${docsDir.rel}`]);
      for (let head = 0; head < queue.length; head += 1) {
        const dir = queue[head];
        const deeper = await listed(root.id, dir);
        if (deeper === null) continue;
        dirEntries.set(`${root.id}::${dir}`, deeper);
        for (const entry of deeper) {
          if (entry.kind !== "dir") continue;
          const key = `${root.id}::${entry.rel}`;
          if (visited.has(key) || SKIPPED_DIRS.has(entry.name.toLowerCase())) continue;
          visited.add(key);
          queue.push(entry.rel);
        }
      }
    }
    let found: Array<{ rel: string }> = [];
    try {
      found = (await discoverRootProjects(root.id, root.name, deps)).projects;
    } catch {
      found = [];
    }
    for (const service of found) {
      services.push({ rootId: root.id, rel: service.rel });
      if (service.rel !== "" && !dirEntries.has(`${root.id}::${service.rel}`)) {
        const serviceEntries = await listed(root.id, service.rel);
        if (serviceEntries !== null) dirEntries.set(`${root.id}::${service.rel}`, serviceEntries);
      }
    }
  }
  return suggestContextDocs({
    roots: roots.map((root) => ({ id: root.id, blocked: root.aiBlocked, missing: root.missing })),
    rootEntries,
    dirEntries,
    services,
  });
}
