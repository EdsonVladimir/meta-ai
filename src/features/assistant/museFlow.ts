// Folder-first Muse: what a dialog sends and which project it lands in.
// Pure orchestration with injected IO. The domain still needs a project
// and a module to trace a requirement; Ruth creates them from the folder
// instead of asking for them. Each step that fails says so and deletes
// nothing, as `projectFromFolder` does.
import type { MuseTarget } from "../requirements/uiStore";

/** Same bound as the Rust side (`MAX_CODE_SCOPE_FILES`). */
export const MUSE_MAX_FILES = 8;
/** Files listed to choose from; a folder may hold many more. */
export const MUSE_MAX_CANDIDATES = 60;
const MAX_DIRS_WALKED = 200;
const SOURCE = /\.(ts|tsx|js|jsx|mts|rs|java|kt|py|go|cs|php|rb|html|css|scss|sql)$/i;
const NOT_SOURCE = /(\.spec\.|\.test\.|\.d\.ts$|\.min\.)/i;

export interface MuseFile {
  rootId: string;
  rel: string;
}

/** Answers sent from a proposal card: "Q: ..\nA: .." for the answered ones only. */
export function composeAnswers(questions: string[], answers: Record<number, string>): string {
  const blocks: string[] = [];
  questions.forEach((question, index) => {
    const answer = (answers[index] ?? "").trim();
    if (answer !== "") blocks.push(`Q: ${question}\nA: ${answer}`);
  });
  return blocks.join("\n\n");
}

interface Entry {
  name: string;
  rel: string;
  kind: string;
}

/** Source files under a target, shallow first: the closest files explain it. */
export async function collectMuseFiles(
  target: MuseTarget,
  listDir: (rootId: string, rel: string) => Promise<{ entries: Entry[] }>,
): Promise<{ files: MuseFile[]; truncated: boolean }> {
  if (target.kind === "file") {
    return { files: [{ rootId: target.rootId, rel: target.rel }], truncated: false };
  }
  const files: MuseFile[] = [];
  const queue = [target.rel];
  let walked = 0;
  while (queue.length > 0 && walked < MAX_DIRS_WALKED && files.length < MUSE_MAX_CANDIDATES) {
    const dir = queue.shift() as string;
    walked += 1;
    const { entries } = await listDir(target.rootId, dir);
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.name.startsWith(".")) continue;
      if (entry.kind === "dir") queue.push(entry.rel);
      else if (entry.kind === "file" && SOURCE.test(entry.name) && !NOT_SOURCE.test(entry.name)) {
        files.push({ rootId: target.rootId, rel: entry.rel });
      }
    }
  }
  const truncated = queue.length > 0 || files.length > MUSE_MAX_CANDIDATES;
  return { files: files.slice(0, MUSE_MAX_CANDIDATES), truncated };
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
  const groups: MuseFile[][] = [...FILE_ROLES.map(() => []), []];
  for (const file of candidates) {
    const role = FILE_ROLES.findIndex((pattern) => pattern.test(file.rel));
    groups[role === -1 ? FILE_ROLES.length : role].push(file);
  }
  for (const group of groups) group.sort((a, b) => hits(b) - hits(a));
  const picked: MuseFile[] = [];
  for (let turn = 0; picked.length < MUSE_MAX_FILES; turn += 1) {
    const round = groups.flatMap((group) => group.slice(turn, turn + 1));
    if (round.length === 0) break;
    picked.push(...round);
  }
  return picked.slice(0, MUSE_MAX_FILES);
}

/**
 * What an adjustment reads: files already accepted first, because they
 * are on disk now and Muse must see them to change them, then the
 * scope of the proposal being adjusted.
 */
export function adjustmentScope(
  proposals: Array<{
    scope: MuseFile[];
    files: Array<MuseFile & { state: string }>;
  }>,
): MuseFile[] {
  const accepted = proposals.flatMap((proposal) =>
    proposal.files.filter((file) => file.state === "accepted"),
  );
  const newest = proposals[proposals.length - 1]?.scope ?? [];
  const seen = new Set<string>();
  const out: MuseFile[] = [];
  for (const { rootId, rel } of [...accepted, ...newest]) {
    const key = `${rootId}\n${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rootId, rel });
  }
  return out.slice(0, MUSE_MAX_FILES);
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
