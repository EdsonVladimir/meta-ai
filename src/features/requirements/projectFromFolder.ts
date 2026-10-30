// Create a Ruth project from an existing code folder.
//
// Orchestration with injected dependencies (testable without Tauri):
// dialog → project → name → root → association. Each failing step
// leaves the previous ones intact and says so: nothing is ever deleted
// to fake atomicity (no project or root deletion allows that without
// breaking other state).
export interface ProjectFromFolderDeps {
  /** Native dialog; null when the user cancels. */
  pickFolder: () => Promise<string | null>;
  createProject: () => Promise<{ id: string; name: string }>;
  renameProject: (projectId: string, expectedName: string, name: string) => Promise<unknown>;
  addCodeRoot: (path: string) => Promise<{ id: string }>;
  setRootProject: (rootId: string, projectId: string | null) => Promise<unknown>;
}

export type ProjectFromFolderResult =
  | { cancelled: true }
  | { cancelled: false; projectId: string; rootId: string | null; warnings: string[] };

/** Last segment of a local path (without touching disk). */
export function folderBaseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const cut = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  const base = cut < 0 ? cleaned : cleaned.slice(cut + 1);
  return base === "" ? path : base;
}

function reason(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "message" in raw) {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return String(raw);
}

export async function createProjectFromFolder(
  deps: ProjectFromFolderDeps,
): Promise<ProjectFromFolderResult> {
  const picked = await deps.pickFolder();
  if (picked === null) return { cancelled: true };
  const created = await deps.createProject();
  const warnings: string[] = [];
  try {
    await deps.renameProject(created.id, created.name, folderBaseName(picked));
  } catch (raw) {
    warnings.push(`Could not name the project: ${reason(raw)} (you can rename it later).`);
  }
  let rootId: string | null = null;
  try {
    rootId = (await deps.addCodeRoot(picked)).id;
  } catch (raw) {
    warnings.push(
      `Project created, but the folder was not added to the workspace: ${reason(raw)} (add it with "Add folder" and link it).`,
    );
    return { cancelled: false, projectId: created.id, rootId, warnings };
  }
  try {
    await deps.setRootProject(rootId, created.id);
  } catch (raw) {
    warnings.push(
      `Folder added loose (unlinked): ${reason(raw)} (link it from the folder menu).`,
    );
  }
  return { cancelled: false, projectId: created.id, rootId, warnings };
}
