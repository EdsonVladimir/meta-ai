// Open-project orchestration: native folder → reuse or register.
// Pure except for the injected clients (testable without Tauri).
// Reuses an existing root/project association when the folder is
// already known; otherwise registers the folder without touching it
// (no .ruth/, no modules, no requirements forced).
import {
  createProjectFromFolder,
  folderBaseName,
} from "../requirements/projectFromFolder";

export interface OpenProjectDeps {
  pickFolder: () => Promise<string | null>;
  listRoots: () => Promise<Array<{ id: string; path: string; projectId: string | null }>>;
  listProjects: () => Promise<Array<{ id: string; name: string }>>;
  createProject: () => Promise<{ id: string; name: string }>;
  renameProject: (projectId: string, expectedName: string, name: string) => Promise<unknown>;
  addCodeRoot: (path: string) => Promise<{ id: string }>;
  setRootProject: (rootId: string, projectId: string | null) => Promise<unknown>;
}

export type OpenProjectResult =
  | { cancelled: true }
  | { cancelled: false; projectId: string; created: boolean; warnings: string[] };

export function samePath(a: string, b: string): boolean {
  const clean = (value: string) => value.replace(/[\\/]+$/, "");
  return clean(a) === clean(b);
}

function reason(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "message" in raw) {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return String(raw);
}

function warnDuplicateName(projects: Array<{ name: string }>, name: string, warnings: string[]): void {
  if (projects.some((project) => project.name === name)) {
    warnings.push(
      `Another project is also called “${name}”: rename one to tell them apart (nothing was merged).`,
    );
  }
}

export async function openProjectFromFolder(
  deps: OpenProjectDeps,
): Promise<OpenProjectResult> {
  const picked = await deps.pickFolder();
  if (picked === null) return { cancelled: true };
  const [roots, projects] = await Promise.all([deps.listRoots(), deps.listProjects()]);
  const existing = roots.find((root) => samePath(root.path, picked));
  const name = folderBaseName(picked);
  if (
    existing !== undefined &&
    existing.projectId !== null &&
    projects.some((project) => project.id === existing.projectId)
  ) {
    return { cancelled: false, projectId: existing.projectId, created: false, warnings: [] };
  }
  const warnings: string[] = [];
  if (existing !== undefined) {
    // Known folder without a live project: register the project and
    // link it; the folder itself is never modified.
    const created = await deps.createProject();
    try {
      await deps.renameProject(created.id, created.name, name);
    } catch (raw) {
      warnings.push(`Could not name the project: ${reason(raw)} (rename it later).`);
    }
    try {
      await deps.setRootProject(existing.id, created.id);
    } catch (raw) {
      warnings.push(`Folder left unassociated: ${reason(raw)} (associate it from the tree menu).`);
    }
    warnDuplicateName(projects, name, warnings);
    return { cancelled: false, projectId: created.id, created: true, warnings };
  }
  const created = await createProjectFromFolder({ ...deps, pickFolder: async () => picked });
  if (created.cancelled) return { cancelled: true };
  warnDuplicateName(projects, name, created.warnings);
  return {
    cancelled: false,
    projectId: created.projectId,
    created: true,
    warnings: created.warnings,
  };
}
