// Add-folder plan: what picking a folder means for the active
// project. One active project: a new folder joins it, a loose one
// is bound, the project's own is a no-op, and one that belongs to
// another project needs an explicit confirmation naming that
// project. Pure and tested; the session runs the plan.
import { samePath } from "../workspace/openProject";

export interface PlannedRoot {
  id: string;
  path: string;
  projectId: string | null;
}

export type AddFolderPlan<T> =
  | { kind: "add" }
  | { kind: "bind"; root: T }
  | { kind: "noop"; root: T }
  | { kind: "confirm"; root: T; fromProjectId: string };

export function planAddFolder<T extends PlannedRoot>(
  roots: T[],
  picked: string,
  activeProjectId: string,
): AddFolderPlan<T> {
  const existing = roots.find((root) => samePath(root.path, picked));
  if (existing === undefined) return { kind: "add" };
  if (existing.projectId === activeProjectId) return { kind: "noop", root: existing };
  if (existing.projectId === null) return { kind: "bind", root: existing };
  return { kind: "confirm", root: existing, fromProjectId: existing.projectId };
}
