// Single-active-project scoping: which roots and projects each view
// shows. One project is active at a time; every other project is
// reached from Recents on the Welcome screen. Roots bound to another
// project, and roots with no project, are hidden while a project is
// active: they stay stored, are never migrated or rebound here, and
// keep their flags (including Never send to Muse, still enforced in
// the backend for every root). Pure and tested.
import { samePath } from "./openProject";

export interface ScopedRoot {
  id: string;
  projectId: string | null;
}

export interface ScopedProject {
  id: string;
}

/**
 * Roots the workspace shows for the active project: only the roots
 * bound to it, in workspace order, missing ones included (so they
 * can be removed). Nothing is active on Welcome, so nothing shows.
 * The same objects are returned: no flag is touched.
 */
export function activeProjectRoots<T extends ScopedRoot>(
  roots: T[],
  activeProjectId: string | null,
): T[] {
  if (activeProjectId === null) return [];
  return roots.filter((root) => root.projectId === activeProjectId);
}

/**
 * Projects the Projects panel shows: only the active one. Nothing
 * is active on Welcome, so nothing shows.
 */
export function activeProjects<T extends ScopedProject>(
  projects: T[],
  activeProjectId: string | null,
): T[] {
  if (activeProjectId === null) return [];
  return projects.filter((project) => project.id === activeProjectId);
}

/**
 * How a Recents entry reopens against the stored roots. `kept`
 * paths belong to the opened project and show at once; `skipped`
 * paths are stored but loose or bound elsewhere, so they stay
 * out and the entry keeps them; `missing` paths are unknown and
 * get re-added. Without a project every known path is kept.
 */
export interface RecentRestorePlan {
  kept: string[];
  skipped: string[];
  missing: string[];
}

export function planRecentRestore<T extends ScopedRoot & { path: string }>(
  roots: T[],
  entryPaths: string[],
  projectId: string | null,
): RecentRestorePlan {
  const plan: RecentRestorePlan = { kept: [], skipped: [], missing: [] };
  for (const path of entryPaths) {
    const known = roots.find((root) => samePath(root.path, path));
    if (known === undefined) {
      plan.missing.push(path);
    } else if (projectId === null || known.projectId === projectId) {
      plan.kept.push(path);
    } else {
      plan.skipped.push(path);
    }
  }
  return plan;
}

/**
 * Entry paths after reopening: the project's stored folders first,
 * then the skipped ones the entry keeps. Nothing stored is dropped
 * from the entry by opening it.
 */
export function mergeRecentPaths(dbPaths: string[], skipped: string[]): string[] {
  const merged = [...dbPaths];
  for (const path of skipped) {
    if (!merged.some((kept) => samePath(kept, path))) merged.push(path);
  }
  return merged;
}

/**
 * True when removing `removed` left the active project with no
 * folders, so the project closes. `remaining` is the root list
 * without the removed root. A project that never had a folder
 * cannot lose one: removing anything else leaves it open.
 */
export function removedLastFolder<T extends ScopedRoot>(
  remaining: T[],
  removed: T,
  activeProjectId: string | null,
): boolean {
  if (activeProjectId === null) return false;
  if (removed.projectId !== activeProjectId) return false;
  return !remaining.some((root) => root.projectId === activeProjectId);
}
