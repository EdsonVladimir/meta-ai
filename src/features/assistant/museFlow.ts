// Folder-first Muse: what a dialog sends and which project it lands in.
// Pure orchestration with injected IO. The domain still needs a project
// and a module to trace a requirement; Ruth creates them from the folder
// instead of asking for them. Each step that fails says so and deletes
// nothing, as `projectFromFolder` does.
import { COLLECT_SKIPPED_DIR_NAMES } from "../code/archmap/projectMaps";
import type { MuseTarget } from "../requirements/uiStore";

/** Same bound as the Rust side (`MAX_CODE_SCOPE_FILES`). */
export const MUSE_MAX_FILES = 12;
/** A plan is bound by size, and by this count on the Rust side. */
export const MUSE_MAX_PLANNED_FILES = 40;
/** Files listed to choose from; a folder may hold many more. */
export const MUSE_MAX_CANDIDATES = 60;
/**
 * Files `@`, Change files and requested files can find. Only paths the
 * person picks leave the machine; names still go for the first
 * MUSE_MAX_CANDIDATES only.
 */
export const MUSE_MAX_SEARCH = 2000;
const MAX_DIRS_WALKED = 200;
const SOURCE = /\.(ts|tsx|js|jsx|mts|rs|java|kt|py|go|cs|php|rb|html|css|scss|sql)$/i;
const NOT_SOURCE = /(\.spec\.|\.test\.|\.d\.ts$|\.min\.)/i;
/** Same bound as the Rust reader: a larger file would fail the whole message. */
const MAX_READABLE_BYTES = 262_144;
/** Generated output, never what explains a project. */
const SKIPPED_DIRS = new Set([
  ...COLLECT_SKIPPED_DIR_NAMES.map((name) => name.toLowerCase()),
  "playwright-report",
  "test-results",
]);

export interface MuseFile {
  rootId: string;
  rel: string;
}

/** The composer text with a question quoted, ready for its answer. */
export function answerPrefix(text: string, question: string): string {
  const quoted = `Q: ${question}\nA: `;
  return text.trim() === "" ? quoted : `${text.trimEnd()}\n\n${quoted}`;
}

interface Entry {
  name: string;
  rel: string;
  kind: string;
  size?: number | null;
}

/** Source files under a target, shallow first: the closest files explain it. */
export async function collectMuseFiles(
  target: MuseTarget,
  listDir: (rootId: string, rel: string) => Promise<{ entries: Entry[] }>,
  limit = MUSE_MAX_CANDIDATES,
): Promise<{ files: MuseFile[]; truncated: boolean }> {
  if (target.kind === "file") {
    return { files: [{ rootId: target.rootId, rel: target.rel }], truncated: false };
  }
  const files: MuseFile[] = [];
  const queue = [target.rel];
  let walked = 0;
  const maxDirs = Math.max(MAX_DIRS_WALKED, limit);
  while (queue.length > 0 && walked < maxDirs && files.length < limit) {
    const dir = queue.shift() as string;
    walked += 1;
    const { entries } = await listDir(target.rootId, dir);
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.name.startsWith(".")) continue;
      if (entry.kind === "dir") {
        if (!SKIPPED_DIRS.has(entry.name.toLowerCase())) queue.push(entry.rel);
      } else if (
        entry.kind === "file" &&
        SOURCE.test(entry.name) &&
        !NOT_SOURCE.test(entry.name) &&
        (entry.size ?? 0) <= MAX_READABLE_BYTES
      ) {
        files.push({ rootId: target.rootId, rel: entry.rel });
      }
    }
  }
  const truncated = queue.length > 0 || files.length > limit;
  return { files: files.slice(0, limit), truncated };
}

/** Roles in reading order: what explains a feature comes first. */
const FILE_ROLES = [
  /\.routes?\.|routing/i,
  /\.(component|page)\.|\.tsx$/i,
  /\.(store|state)\.|\.signals?\./i,
  /\.service\./i,
  /\.(model|entity|dto|types?)\./i,
  /\.(controller|resolver)\./i,
  /\.module\./i,
];

const STYLE = /\.(css|scss|sass|less)$/i;
const PAGE = /(page|view|screen)/i;

function baseNameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
}

/**
 * The files Muse reads when the person chose none: a spread of roles,
 * so a feature arrives whole, with files naming the message's words first.
 */
export function pickMuseFiles(candidates: MuseFile[], message: string): MuseFile[] {
  const words = wordsOf(message);
  const hits = (file: MuseFile): number =>
    words.filter((word) => file.rel.toLowerCase().includes(word)).length;
  // Styles explain little and come last; pages open a feature, and code
  // comes before its template. The message's language must not matter.
  const groups: MuseFile[][] = [...FILE_ROLES.map(() => []), [], []];
  for (const file of candidates) {
    const role = STYLE.test(file.rel)
      ? FILE_ROLES.length + 1
      : FILE_ROLES.findIndex((pattern) => pattern.test(file.rel));
    groups[role === -1 ? FILE_ROLES.length : role].push(file);
  }
  const isPage = (file: MuseFile): number => (PAGE.test(baseNameOf(file.rel)) ? 1 : 0);
  const isMarkup = (file: MuseFile): number => (/\.html?$/i.test(file.rel) ? 1 : 0);
  for (const group of groups) {
    group.sort(
      (a, b) =>
        hits(b) - hits(a) || isPage(b) - isPage(a) || isMarkup(a) - isMarkup(b),
    );
  }
  const styles = groups.pop() as MuseFile[];
  const picked: MuseFile[] = [];
  for (let turn = 0; picked.length < MUSE_MAX_FILES; turn += 1) {
    const round = groups.flatMap((group) => group.slice(turn, turn + 1));
    if (round.length === 0) break;
    picked.push(...round);
  }
  // Styles only fill the room the rest left.
  return [...picked, ...styles].slice(0, MUSE_MAX_FILES);
}

/**
 * What an adjustment reads: the files the person chose first, then
 * files already accepted, because they are on disk now and Muse must
 * see them to change them. Then the files a pending version modifies,
 * newest first: without what is on disk Muse cannot keep them, so it
 * drops them. Last, the scope of the proposal adjusted.
 */
export function adjustmentScope(
  proposals: Array<{
    scope: MuseFile[];
    files: Array<MuseFile & { state: string; operation?: string }>;
  }>,
  chosen: MuseFile[] = [],
): MuseFile[] {
  const accepted = proposals.flatMap((proposal) =>
    proposal.files.filter((file) => file.state === "accepted"),
  );
  const modified = [...proposals]
    .reverse()
    .flatMap((proposal) =>
      proposal.files.filter((file) => file.state === "pending" && file.operation === "modify"),
    );
  const newest = proposals[proposals.length - 1]?.scope ?? [];
  const seen = new Set<string>();
  const out: MuseFile[] = [];
  for (const { rootId, rel } of [...chosen, ...accepted, ...modified, ...newest]) {
    const key = `${rootId}\n${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rootId, rel });
  }
  return out.slice(0, MUSE_MAX_PLANNED_FILES);
}

/**
 * Files an earlier version of the same request still had pending and
 * the newest one left out. A version replaces the last one, and the
 * older ones can no longer be accepted, so accepting it loses them.
 */
export function filesLeftOut(
  proposals: Array<{
    requirementArtifactId: string;
    files: Array<MuseFile & { state: string }>;
  }>,
): string[] {
  const newest = proposals[proposals.length - 1];
  if (newest === undefined) return [];
  const written = new Set(
    proposals.flatMap((proposal) =>
      proposal.files.filter((file) => file.state === "accepted").map((file) => file.rel),
    ),
  );
  const kept = new Set(newest.files.map((file) => file.rel));
  const out = new Set<string>();
  for (const proposal of proposals.slice(0, -1)) {
    if (proposal.requirementArtifactId !== newest.requirementArtifactId) continue;
    for (const file of proposal.files) {
      if (file.state === "pending" && !kept.has(file.rel) && !written.has(file.rel)) {
        out.add(file.rel);
      }
    }
  }
  return [...out];
}

export interface MuseLinkDeps {
  listModules: (projectId: string) => Promise<Array<{ id: string; name: string; archived: boolean }>>;
  createProject: () => Promise<{ id: string; name: string }>;
  renameProject: (projectId: string, expectedName: string, name: string) => Promise<unknown>;
  setRootProject: (rootId: string, projectId: string) => Promise<unknown>;
  createModule: (projectId: string) => Promise<{ id: string; name: string }>;
  renameModule: (
    projectId: string,
    moduleId: string,
    expectedName: string,
    name: string,
  ) => Promise<unknown>;
}

/** The folder a target belongs to: itself, or the parent of a file. */
export function moduleNameOf(target: MuseTarget, rootName: string): string {
  const parts = target.rel.split("/").filter((part) => part !== "");
  const folder = target.kind === "file" ? parts.slice(0, -1) : parts;
  return folder[folder.length - 1] ?? rootName;
}

/** Project and module of a folder, created on first use. */
export async function linkMuseTarget(
  target: MuseTarget,
  root: { id: string; name: string; projectId: string | null },
  deps: MuseLinkDeps,
): Promise<{ projectId: string; moduleId: string }> {
  let projectId = root.projectId;
  if (projectId === null) {
    const created = await deps.createProject();
    await deps.renameProject(created.id, created.name, root.name);
    await deps.setRootProject(root.id, created.id);
    projectId = created.id;
  }
  const name = moduleNameOf(target, root.name);
  const modules = await deps.listModules(projectId);
  const known = modules.find((entry) => entry.name === name && !entry.archived);
  if (known !== undefined) return { projectId, moduleId: known.id };
  const created = await deps.createModule(projectId);
  await deps.renameModule(projectId, created.id, created.name, name);
  return { projectId, moduleId: created.id };
}
