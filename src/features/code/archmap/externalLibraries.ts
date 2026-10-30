// External libraries: code we use but do not change. A package import
// or a folder the user marked as external becomes one compact reference
// with who uses it and what they import, never its members. Marked
// folders stay analyzed, so unmarking needs no new pass.
import type { ArchMap } from "./archModel";

/** A project folder the user treats as a library (root-relative). */
export interface ExternalFolder {
  rootId: string;
  rel: string;
}

export interface ExternalLibrary {
  key: string;
  name: string;
  /** Set when the library is a marked folder, not a package. */
  folder: ExternalFolder | null;
  /** Files using it, sorted. */
  usedBy: Array<{ rootId: string; rel: string }>;
  /** Names imported from it, sorted. */
  names: string[];
}

const ASSET = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|json|html)$/i;
const SOURCE_SUFFIXES = [".ts", ".tsx", ".mts", ".cts", "/index.ts", "/index.tsx"];

/** npm package of a specifier, or null for assets and `@/`, `~/` aliases. */
export function packageName(raw: string): string | null {
  if (raw === "" || raw.startsWith(".") || raw.startsWith("/") || ASSET.test(raw)) return null;
  if (raw.startsWith("@/") || raw.startsWith("~/")) return null;
  if (raw.startsWith("node:")) return "node";
  const parts = raw.split("/");
  return raw.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function isInExternalFolder(
  rootId: string,
  rel: string,
  folders: readonly ExternalFolder[],
): boolean {
  return folders.some(
    (folder) =>
      folder.rootId === rootId && (rel === folder.rel || rel.startsWith(`${folder.rel}/`)),
  );
}

/** Folders above a file, deepest first: the choices for marking it. */
export function ancestorFolders(rel: string): string[] {
  const parts = rel.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"));
}

/**
 * Path aliases (`@app/core/x`, `src/app/x`) look like packages. A
 * specifier is our own code when its path, with or without the first
 * segment, ends exactly one analyzed file. No match or two matches:
 * null, so it stays a package.
 */
export function aliasTarget(raw: string, rels: readonly string[]): string | null {
  const parts = raw.split("/");
  const paths = [raw];
  if (parts.length > 1) paths.push(parts.slice(1).join("/"));
  for (const path of paths) {
    const endings = SOURCE_SUFFIXES.map((suffix) => `${path}${suffix}`);
    const found = rels.filter((rel) =>
      endings.some((ending) => rel === ending || rel.endsWith(`/${ending}`)),
    );
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}

/** `@acme/paginator` for a marked `libs/acme` folder. */
function folderOfPackage(
  name: string,
  rootId: string,
  folders: readonly ExternalFolder[],
): ExternalFolder | null {
  const segments = name.replace(/^@/, "").split("/");
  return (
    folders.find(
      (folder) =>
        folder.rootId === rootId && segments.includes(folder.rel.split("/").pop() ?? ""),
    ) ?? null
  );
}

interface Draft {
  library: ExternalLibrary;
  users: Map<string, { rootId: string; rel: string }>;
  names: Set<string>;
}

/**
 * Libraries of a map, most used first. Marked folders always list, even
 * unused, so they can be unmarked. `onlyRels` limits the users (module
 * filter).
 */
export function collectLibraries(
  map: ArchMap | null,
  folders: readonly ExternalFolder[],
  onlyRels: Set<string> | null = null,
): ExternalLibrary[] {
  if (map === null) return [];
  const drafts = new Map<string, Draft>();
  const draftFor = (key: string, name: string, folder: ExternalFolder | null): Draft => {
    const existing = drafts.get(key);
    if (existing !== undefined) return existing;
    const created: Draft = {
      library: { key, name, folder, usedBy: [], names: [] },
      users: new Map(),
      names: new Set(),
    };
    drafts.set(key, created);
    return created;
  };
  const draftForFolder = (folder: ExternalFolder): Draft =>
    draftFor(
      `folder:${folder.rootId}:${folder.rel}`,
      folder.rel.split("/").pop() ?? folder.rel,
      folder,
    );
  const roots = new Set(map.files.map((file) => file.rootId));
  const shown = folders.filter((folder) => roots.has(folder.rootId));
  for (const folder of shown) draftForFolder(folder);

  for (const file of map.files) {
    if (isInExternalFolder(file.rootId, file.rel, shown)) continue;
    if (onlyRels !== null && !onlyRels.has(file.rel)) continue;
    const rels = map.files.filter((entry) => entry.rootId === file.rootId).map((f) => f.rel);
    for (const entry of file.imports ?? []) {
      if (entry.status === "missing") continue;
      const target =
        entry.status === "resolved" ? entry.resolvedRel : aliasTarget(entry.raw, rels);
      let draft: Draft | null = null;
      if (target !== null) {
        const owner = shown.find((folder) =>
          isInExternalFolder(file.rootId, target, [folder]),
        );
        if (owner === undefined) continue;
        draft = draftForFolder(owner);
      } else {
        const name = packageName(entry.raw);
        if (name === null) continue;
        const owner = folderOfPackage(name, file.rootId, shown);
        draft = owner !== null ? draftForFolder(owner) : draftFor(`package:${name}`, name, null);
      }
      draft.users.set(`${file.rootId}:${file.rel}`, { rootId: file.rootId, rel: file.rel });
      for (const name of entry.names ?? []) draft.names.add(name);
    }
  }
  return [...drafts.values()]
    .map((draft) => ({
      ...draft.library,
      usedBy: [...draft.users.values()].sort((a, b) => a.rel.localeCompare(b.rel)),
      names: [...draft.names].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name));
}
