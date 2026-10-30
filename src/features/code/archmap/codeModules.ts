// Code modules for the Architecture board filter: functional
// groupings within the analyzed scope, each labeled with the
// evidence behind it. Three honest sources, never mixed up:
// framework declarations (`@Module`/`@NgModule` metadata),
// manual Ruth-module associations (existing code links), and
// directory groups (folder proximity, never presented as
// declared modules). Pure and tested.
import type { ArchMap } from "./archModel";
import type { CodeLinkDto } from "../types";
import type { ModuleDto } from "../../requirements/types";

/** One analyzed board feeding the module filter. */
export interface ModuleSource {
  rootId: string;
  rootName: string;
  /** Scope base: nested scopes relativize folders to it. */
  scopeRel: string;
  map: ArchMap;
}

/** A Ruth business module with its linked code locations. */
export interface ManualModule {
  id: string;
  name: string;
  paths: Array<{
    rootId: string;
    rel: string;
    /** Symbol links narrow to one name+kind; null links the path. */
    symbol: { name: string; kind: string } | null;
  }>;
}

export type CodeModuleKind = "declared" | "manual" | "directory";

export interface CodeModuleOption {
  /** Opaque within the view (`declared:`/`manual:`/`dir:`). */
  key: string;
  kind: CodeModuleKind;
  /** Short label for the select (disambiguated when repeated). */
  label: string;
  /** One-line criterion, shown when the option is selected. */
  criterion: string;
  /** Drawn member symbol count. */
  symbols: number;
}

export interface ModuleIndex {
  options: CodeModuleOption[];
  /** Option key → drawn member symbol ids. */
  members: Map<string, Set<string>>;
  /** Symbol id → "Label (kind)" entries (multiple memberships). */
  memberships: Map<string, string[]>;
}

/**
 * Existing manual associations as filter data: non-archived Ruth
 * modules with live module-scope links. Archived modules, unknown
 * owners and missing roots contribute nothing.
 */
export function resolveManualModules(
  modules: ModuleDto[],
  links: CodeLinkDto[],
): ManualModule[] {
  const names = new Map(
    modules.filter((mod) => !mod.archived).map((mod) => [mod.id, mod.name]),
  );
  const byOwner = new Map<string, ManualModule["paths"]>();
  for (const link of links) {
    if (link.scope !== "module") continue;
    if (!names.has(link.ownerId)) continue;
    if (link.rootMissing) continue;
    const found = byOwner.get(link.ownerId) ?? [];
    found.push({
      rootId: link.rootId,
      rel: link.rel,
      symbol:
        link.symbol === null
          ? null
          : { name: link.symbol.name, kind: link.symbol.kind },
    });
    byOwner.set(link.ownerId, found);
  }
  return [...byOwner.entries()]
    .map(([id, paths]) => ({ id, name: names.get(id) ?? id, paths }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Leading folders skipped when grouping: `src/sales/x.ts` groups
 * as `sales`, not `src`. A documented grouping rule, not a guess
 * about what the folder means.
 */
const SOURCE_PREFIXES = ["src", "lib", "source", "app"];

function groupDirOf(
  scopeRel: string,
  rel: string,
): { dir: string; label: string; scopeDir: string } {
  const base =
    scopeRel === "" || !rel.startsWith(`${scopeRel}/`) ? rel : rel.slice(scopeRel.length + 1);
  const segs = base.split("/").slice(0, -1);
  let dropped = 0;
  while (dropped < segs.length && SOURCE_PREFIXES.includes(segs[dropped])) dropped += 1;
  if (dropped >= segs.length) {
    return { dir: scopeRel, label: "(Top level)", scopeDir: "" };
  }
  const scopeDir = segs.slice(0, dropped + 1).join("/");
  const dir = scopeRel === "" ? scopeDir : `${scopeRel}/${scopeDir}`;
  return { dir, label: segs[dropped], scopeDir };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

const KIND_LABEL: Record<CodeModuleKind, string> = {
  declared: "declared module",
  manual: "linked module",
  directory: "directory group",
};

/**
 * Module options with drawn membership over the given boards.
 * Declared modules come from `@Module` metadata, manual ones from
 * existing Ruth-module links, directory groups from analyzed file
 * paths. Only groupings with at least one drawn symbol are
 * offered; repeated labels gain their root name.
 */
export function buildModuleIndex(
  sources: ModuleSource[],
  manual: ManualModule[],
): ModuleIndex {
  const drawn = new Set<string>();
  for (const source of sources) {
    for (const node of source.map.nodes) drawn.add(node.id);
  }
  const options: CodeModuleOption[] = [];
  const members = new Map<string, Set<string>>();

  for (const source of sources) {
    for (const mod of source.map.modules) {
      const ids = new Set(mod.memberIds.filter((id) => drawn.has(id)));
      if (ids.size === 0) continue;
      const outside = mod.memberIds.length - ids.size;
      const notes = [
        ...mod.unresolved.map((entry) => `'${entry.name}' unresolved`),
        ...mod.ambiguous.map((entry) => `'${entry.name}' ambiguous`),
        ...(mod.opaque > 0 ? [`${plural(mod.opaque, "entry", "entries")} skipped`] : []),
        ...(outside > 0 ? [`${outside} outside the drawn files`] : []),
      ];
      options.push({
        key: `declared:${mod.id}`,
        kind: "declared",
        label: mod.name,
        criterion:
          `Declared by @${mod.via} in ${mod.rel.split("/").pop()}: ` +
          `${plural(ids.size, "symbol", "symbols")}` +
          (notes.length > 0 ? ` (${notes.join("; ")})` : ""),
        symbols: ids.size,
      });
      members.set(`declared:${mod.id}`, ids);
    }
  }

  for (const mod of manual) {
    const ids = new Set<string>();
    let stale = 0;
    for (const path of mod.paths) {
      let matched = false;
      for (const source of sources) {
        if (source.rootId !== path.rootId) continue;
        for (const node of source.map.nodes) {
          if (node.rel !== path.rel && !node.rel.startsWith(`${path.rel}/`)) continue;
          if (path.symbol !== null) {
            if (
              node.symbol.name !== path.symbol.name ||
              node.symbol.kind !== path.symbol.kind
            ) {
              continue;
            }
          }
          ids.add(node.id);
          matched = true;
        }
      }
      if (!matched) stale += 1;
    }
    if (ids.size === 0) continue;
    options.push({
      key: `manual:${mod.id}`,
      kind: "manual",
      label: mod.name,
      criterion:
        `Ruth module "${mod.name}" linked to ${plural(mod.paths.length, "path", "paths")}: ` +
        `${plural(ids.size, "symbol", "symbols")}` +
        (stale > 0 ? ` (${plural(stale, "link", "links")} outside this scope or unmatched)` : ""),
      symbols: ids.size,
    });
    members.set(`manual:${mod.id}`, ids);
  }

  interface DirGroup {
    dir: string;
    label: string;
    scopeDir: string;
    rootId: string;
    rootName: string;
    scopeRel: string;
    ids: Set<string>;
  }
  const dirs = new Map<string, DirGroup>();
  for (const source of sources) {
    for (const node of source.map.nodes) {
      const group = groupDirOf(source.scopeRel, node.rel);
      const key = `dir:${source.rootId}::${source.scopeRel}::${group.dir}`;
      const found = dirs.get(key);
      if (found === undefined) {
        dirs.set(key, {
          dir: group.dir,
          label: group.label,
          scopeDir: group.scopeDir,
          rootId: source.rootId,
          rootName: source.rootName,
          scopeRel: source.scopeRel,
          ids: new Set([node.id]),
        });
      } else {
        found.ids.add(node.id);
      }
    }
  }
  const dirOptions = [...dirs.entries()]
    .filter(([, group]) => group.ids.size > 0)
    .sort(
      ([, a], [, b]) =>
        a.label.localeCompare(b.label) || a.rootName.localeCompare(b.rootName),
    );
  for (const [key, group] of dirOptions) {
    const where =
      group.label === "(Top level)"
        ? "Top-level files"
        : `Folder grouping under ${group.scopeDir}/`;
    options.push({
      key,
      kind: "directory",
      label: group.label,
      criterion: `${where}: ${plural(group.ids.size, "symbol", "symbols")} (not a declared module)`,
      symbols: group.ids.size,
    });
    members.set(key, group.ids);
  }

  // Repeated labels gain their root name so options stay distinct.
  const seen = new Map<string, CodeModuleOption[]>();
  for (const option of options) {
    const found = seen.get(option.label) ?? [];
    found.push(option);
    seen.set(option.label, found);
  }
  for (const [, group] of seen) {
    if (group.length < 2) continue;
    for (const option of group) {
      const rootName = rootNameOf(option.key, sources, manual);
      option.label = rootName === null ? option.label : `${option.label} (${rootName})`;
    }
  }

  const byKind: Record<CodeModuleKind, number> = { declared: 0, manual: 1, directory: 2 };
  options.sort(
    (a, b) => byKind[a.kind] - byKind[b.kind] || a.label.localeCompare(b.label),
  );

  const memberships = new Map<string, string[]>();
  for (const option of options) {
    const entry = `${option.label} (${KIND_LABEL[option.kind]})`;
    for (const id of members.get(option.key) ?? []) {
      const found = memberships.get(id) ?? [];
      found.push(entry);
      memberships.set(id, found);
    }
  }
  return { options, members, memberships };
}

function rootNameOf(
  key: string,
  sources: ModuleSource[],
  manual: ManualModule[],
): string | null {
  if (key.startsWith("manual:")) {
    const found = manual.find((mod) => `manual:${mod.id}` === key) ?? null;
    if (found === null) return null;
    const roots = [...new Set(found.paths.map((path) => path.rootId))];
    if (roots.length !== 1) return null;
    return sources.find((source) => source.rootId === roots[0])?.rootName ?? null;
  }
  if (key.startsWith("declared:")) {
    const id = key.slice("declared:".length);
    for (const source of sources) {
      if (source.map.modules.some((mod) => mod.id === id)) return source.rootName;
    }
    return null;
  }
  const rest = key.slice("dir:".length);
  const rootId = rest.split("::")[0] ?? "";
  return sources.find((source) => source.rootId === rootId)?.rootName ?? null;
}

/** Cap on summarized external references (the total stays honest). */
export const MAX_MODULE_REFS = 20;

export interface ModuleReferences {
  ids: Set<string>;
  total: number;
}

/**
 * Direct symbol-edge neighbors outside the module, by name for a
 * stable order, capped for the board. The total counts every
 * neighbor so the cap never pretends to be the whole story.
 */
export function moduleReferenceIds(
  sources: ModuleSource[],
  memberIds: Set<string>,
  max: number = MAX_MODULE_REFS,
): ModuleReferences {
  const names = new Map<string, string>();
  for (const source of sources) {
    for (const node of source.map.nodes) names.set(node.id, node.symbol.name);
  }
  const outside = new Set<string>();
  for (const source of sources) {
    for (const edge of source.map.symbolEdges) {
      const fromIn = memberIds.has(edge.from);
      const toIn = memberIds.has(edge.to);
      if (fromIn && !toIn) outside.add(edge.to);
      else if (toIn && !fromIn) outside.add(edge.from);
    }
  }
  const ordered = [...outside].sort(
    (a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b) || a.localeCompare(b),
  );
  return { ids: new Set(ordered.slice(0, max)), total: ordered.length };
}
