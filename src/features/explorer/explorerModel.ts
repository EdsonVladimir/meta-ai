// Pure tree-explorer model. No React, no Tauri: node ids, visible
// forest building and keyboard navigation helpers.
import type { DesignLink } from "../design/coordination";
import type { ArtifactDto, ModuleDto, ProjectDto } from "../requirements/types";
import { artifactLabel } from "../requirements/names";

export type ExplorerNodeKind =
  | "project"
  | "module"
  | "reqGroup"
  | "designGroup"
  | "mockupGroup"
  | "requirement"
  | "design"
  | "mockup"
  | "screen"
  | "status";

export type NodeLoadState = "loading" | "error" | "empty";

/** Known metadata of an artifact whose detail loaded this session. */
export interface ArtifactMeta {
  /** First line of the current content, truncated. */
  label: string;
  /** Current version approval, when known. */
  approved: boolean | null;
}

export interface FlatNode {
  id: string;
  kind: ExplorerNodeKind;
  /** Main text: real name or first line when known. */
  label: string;
  /** ID as secondary info when it differs from the label. */
  secondary: string | null;
  title: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  selected: boolean;
  /** Known review state; null = unknown (no badge). */
  approved: boolean | null;
  /** Design subtype (`flow`/`data_model`) for its badge. */
  artifactKind: string | null;
  /** Link to the parent requirement (shortcuts under requirements only). */
  linkKind: "direct" | "transitive" | null;
  /** The shortcut uses versions that are no longer current. */
  staleLink: boolean;
  /** Effective archiving: own or by module context. */
  archived: boolean;
  /** Own archiving (no context): decides archive or restore. */
  archivedOwn: boolean;
  projectId: string | null;
  moduleId: string | null;
  artifactId: string | null;
  /** Screen (`screen` nodes of the parent mockup only). */
  screenId: string | null;
  loadState: NodeLoadState | null;
  /** Artifact count in groups with loaded data. */
  count: number | null;
  /** Hidden archived items in groups when not shown. */
  hiddenArchived: number | null;
  children: FlatNode[];
}

export interface ForestInput {
  projects: ProjectDto[];
  modulesByProject: Record<string, ModuleDto[]>;
  artifactsByModule: Record<string, ArtifactDto[]>;
  loadingKeys: string[];
  errorKeys: Record<string, string>;
  expanded: string[];
  selection: {
    projectId: string | null;
    moduleId: string | null;
    requirementId: string | null;
    designId: string | null;
    mockupId: string | null;
    screenId: string | null;
  };
  meta: Record<string, ArtifactMeta>;
  /** Designs linked per requirement (derived from exact sources). */
  designLinks: Record<string, DesignLink[]>;
  /** Links state per module (`project/module` key). */
  linksStatus: Record<string, { status: "loading" | "error"; error: string | null }>;
  /**
   * Screens per mockup, derived from the module's already loaded
   * details (asking nothing more). Missing = graph not ready yet.
   */
  mockupScreens: Record<string, { screens: MockupScreenEntry[]; unparsed: boolean }>;
  /** Show archived; otherwise they filter out of the active lists. */
  showArchived: boolean;
}

export function projectNodeId(projectId: string): string {
  return `p:${projectId}`;
}

export function moduleNodeId(projectId: string, moduleId: string): string {
  return `m:${projectId}/${moduleId}`;
}

export function groupNodeId(
  projectId: string,
  moduleId: string,
  group: "req" | "design" | "mockup",
): string {
  return `g:${projectId}/${moduleId}/${group}`;
}

export function artifactNodeId(projectId: string, moduleId: string, artifactId: string): string {
  return `a:${projectId}/${moduleId}/${artifactId}`;
}

/**
 * A design shortcut under a requirement. Same artifact as in the module
 * index, different place: opening either opens the same detail.
 */
export function linkNodeId(requirementId: string, designId: string): string {
  return `l:${requirementId}/${designId}`;
}

/** Status row (loading, error, empty) under an expanded requirement. */
export function linksStatusNodeId(requirementId: string): string {
  return `ls:${requirementId}`;
}

/** Screen summary for the tree (derived, not duplicated). */
export interface MockupScreenEntry {
  id: string;
  title: string;
  components: number;
}

/** Screen under its mockup: opens the same artifact on that screen. */
export function screenNodeId(mockupId: string, screenId: string): string {
  return `s:${mockupId}/${screenId}`;
}

/** Artifact cache key of a module. */
export function moduleKey(projectId: string, moduleId: string): string {
  return `${projectId}/${moduleId}`;
}

/**
 * Visible first line of a content, truncated. Without content there is
 * no invented title: the caller keeps the ID then.
 */
export function firstLine(content: string, max = 60): string {
  const line = content.split("\n", 1)[0].trim().replace(/\s+/g, " ");
  if (line === "") return "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function toggleExpanded(expanded: string[], nodeId: string): string[] {
  return expanded.includes(nodeId)
    ? expanded.filter((id) => id !== nodeId)
    : [...expanded, nodeId];
}

/**
 * Nodes that must expand for the selection to show: project, module
 * and, for artifacts, their group.
 */
export function ancestorsForSelection(
  projectId: string | null,
  moduleId: string | null,
  requirementId: string | null,
  designId: string | null,
  mockupId: string | null = null,
  screenId: string | null = null,
): string[] {
  if (projectId === null) return [];
  const ids = [projectNodeId(projectId)];
  if (moduleId === null) return ids;
  ids.push(moduleNodeId(projectId, moduleId));
  if (requirementId !== null) ids.push(groupNodeId(projectId, moduleId, "req"));
  if (designId !== null) ids.push(groupNodeId(projectId, moduleId, "design"));
  if (mockupId !== null) ids.push(groupNodeId(projectId, moduleId, "mockup"));
  if (mockupId !== null && screenId !== null) {
    ids.push(artifactNodeId(projectId, moduleId, mockupId));
  }
  return ids;
}

function statusNode(parentId: string, depth: number, loadState: NodeLoadState): FlatNode {
  return {
    id: `${parentId}#${loadState}`,
    kind: "status",
    label: loadState === "loading" ? "Loading…" : loadState === "error" ? "Error" : "Empty",
    secondary: null,
    title: "",
    depth,
    expandable: false,
    expanded: false,
    selected: false,
    approved: null,
    artifactKind: null,
    linkKind: null,
    staleLink: false,
    archived: false,
    archivedOwn: false,
    projectId: null,
    moduleId: null,
    artifactId: null,
    screenId: null,
    loadState,
    count: null,
    hiddenArchived: null,
    children: [],
  };
}

/** Archiving context derived from the loaded lists. */
interface ArchiveContext {
  /** Own archiving per module (`project/module` key). */
  moduleArchived: Map<string, boolean>;
  /** Own archiving per artifact (unique global ids). */
  artifactArchived: Map<string, boolean>;
}

function archiveContext(input: ForestInput): ArchiveContext {
  const moduleArchived = new Map<string, boolean>();
  for (const [projectId, modules] of Object.entries(input.modulesByProject)) {
    for (const module of modules) moduleArchived.set(moduleKey(projectId, module.id), module.archived);
  }
  const artifactArchived = new Map<string, boolean>();
  for (const artifacts of Object.values(input.artifactsByModule)) {
    for (const artifact of artifacts) {
      if (!artifactArchived.has(artifact.id)) artifactArchived.set(artifact.id, artifact.archived);
    }
  }
  return { moduleArchived, artifactArchived };
}

/** Honest empty label: tells "none" from "some but archived" apart. */
function emptyLabel(base: string, hidden: number): string {
  return hidden > 0 ? `${base} (${hidden} archived)` : base;
}

/**
 * Secondary and tooltip of a named row: the ID only shows when the label
 * hides it, and the tooltip shows the full name.
 */
function namedRow(
  label: string,
  id: string,
): { secondary: string | null; title: string } {
  if (label === id) return { secondary: null, title: id };
  return { secondary: id, title: `${label} — ${id}` };
}

/**
 * Builds the visible forest in order. Only includes children of expanded
 * nodes; containers without data show their state (loading, error with
 * retry, or empty). Without `showArchived`, archived modules and
 * artifacts filter out of the active lists.
 */
export function buildForest(input: ForestInput): FlatNode[] {
  const expanded = new Set(input.expanded);
  const loading = new Set(input.loadingKeys);
  const archives = archiveContext(input);
  return input.projects.map((project) => {
    const pid = projectNodeId(project.id);
    const projectSelected =
      input.selection.projectId === project.id &&
      input.selection.moduleId === null &&
      input.selection.requirementId === null &&
      input.selection.designId === null;
    const named = namedRow(project.name, project.id);
    const node: FlatNode = {
      id: pid,
      kind: "project",
      label: project.name,
      secondary: named.secondary,
      title: named.title,
      depth: 0,
      expandable: true,
      expanded: expanded.has(pid),
      selected: projectSelected,
      approved: null,
      artifactKind: null,
      linkKind: null,
      staleLink: false,
      archived: false,
      archivedOwn: false,
      projectId: project.id,
      moduleId: null,
      artifactId: null,
      screenId: null,
      loadState: null,
      count: null,
      hiddenArchived: null,
      children: [],
    };
    if (!node.expanded) return node;
    const modules = input.modulesByProject[project.id];
    if (modules === undefined) {
      node.children = [
        statusNode(pid, 1, loading.has(pid) || input.errorKeys[pid] === undefined ? "loading" : "error"),
      ];
      if (input.errorKeys[pid] !== undefined) node.children[0].label = input.errorKeys[pid];
      return node;
    }
    const visible = input.showArchived ? modules : modules.filter((m) => !m.archived);
    // No placeholder row for a project without (visible) modules:
    // archived ones stay reachable through "Show archived".
    if (visible.length === 0) return node;
    node.children = visible.map((module) =>
      buildModule(input, archives, expanded, loading, project.id, module),
    );
    return node;
  });
}

function buildModule(
  input: ForestInput,
  archives: ArchiveContext,
  expanded: Set<string>,
  loading: Set<string>,
  projectId: string,
  module: ModuleDto,
): FlatNode {
  const mid = moduleNodeId(projectId, module.id);
  const moduleSelected =
    input.selection.projectId === projectId &&
    input.selection.moduleId === module.id &&
    input.selection.requirementId === null &&
    input.selection.designId === null;
  const named = namedRow(module.name, module.id);
  const node: FlatNode = {
    id: mid,
    kind: "module",
    label: module.name,
    secondary: named.secondary,
    title: named.title,
    depth: 1,
    expandable: true,
    expanded: expanded.has(mid),
    selected: moduleSelected,
    approved: null,
    artifactKind: null,
    linkKind: null,
    staleLink: false,
    archived: module.archived,
    archivedOwn: module.archived,
    projectId,
    moduleId: module.id,
    artifactId: null,
    screenId: null,
    loadState: null,
    count: null,
    hiddenArchived: null,
    children: [],
  };
  if (!node.expanded) return node;
  node.children = [
    buildGroup(input, archives, expanded, loading, projectId, module.id, "req", 2),
    buildGroup(input, archives, expanded, loading, projectId, module.id, "design", 2),
    buildGroup(input, archives, expanded, loading, projectId, module.id, "mockup", 2),
  ];
  return node;
}

function buildGroup(
  input: ForestInput,
  archives: ArchiveContext,
  expanded: Set<string>,
  loading: Set<string>,
  projectId: string,
  moduleId: string,
  group: "req" | "design" | "mockup",
  depth: number,
): FlatNode {
  const gid = groupNodeId(projectId, moduleId, group);
  const key = moduleKey(projectId, moduleId);
  const all = input.artifactsByModule[key];
  const moduleArchived = archives.moduleArchived.get(key) ?? false;
  const candidates = (all ?? []).filter((a) =>
    group === "req"
      ? a.kind === "requirement"
      : group === "mockup"
        ? a.kind === "mockup"
        : a.kind === "flow" || a.kind === "data_model",
  );
  // Effective archiving = own or by module context.
  const items = input.showArchived
    ? candidates
    : candidates.filter((a) => !a.archived && !moduleArchived);
  const hidden = candidates.length - items.length;
  const node: FlatNode = {
    id: gid,
    kind: group === "req" ? "reqGroup" : group === "mockup" ? "mockupGroup" : "designGroup",
    label:
      group === "req" ? "Requirements" : group === "mockup" ? "Module mockups" : "Module designs",
    secondary: null,
    title:
      group === "req"
        ? "Module requirements"
        : group === "mockup"
          ? "Module mockups"
          : "Module designs",
    depth,
    expandable: true,
    expanded: expanded.has(gid),
    selected: false,
    approved: null,
    artifactKind: null,
    linkKind: null,
    staleLink: false,
    archived: moduleArchived,
    archivedOwn: moduleArchived,
    projectId,
    moduleId,
    artifactId: null,
    screenId: null,
    loadState: null,
    count: all === undefined ? null : items.length,
    hiddenArchived: all === undefined ? null : hidden,
    children: [],
  };
  if (!node.expanded) return node;
  if (all === undefined) {
    const state: NodeLoadState =
      loading.has(key) || input.errorKeys[key] === undefined ? "loading" : "error";
    const status = statusNode(gid, depth + 1, state);
    if (state === "error") status.label = input.errorKeys[key];
    node.children = [status];
    return node;
  }
  if (items.length === 0) {
    const status = statusNode(gid, depth + 1, "empty");
    status.label = emptyLabel(
      group === "req" ? "No requirements" : group === "mockup" ? "No mockups" : "No designs",
      hidden,
    );
    node.children = [status];
    return node;
  }
  node.children = items.map((artifact) =>
    buildArtifact(input, archives, expanded, projectId, moduleId, key, artifact, depth + 1),
  );
  return node;
}

function buildArtifact(
  input: ForestInput,
  archives: ArchiveContext,
  expanded: Set<string>,
  projectId: string,
  moduleId: string,
  moduleCacheKey: string,
  artifact: ArtifactDto,
  depth: number,
): FlatNode {
  const known = input.meta[artifact.id];
  const isReq = artifact.kind === "requirement";
  const isMockup = artifact.kind === "mockup";
  const wanted = isReq
    ? input.selection.requirementId
    : isMockup
      ? input.selection.mockupId
      : input.selection.designId;
  const selected =
    wanted === artifact.id &&
    input.selection.moduleId === moduleId &&
    input.selection.projectId === projectId;
  const label = artifactLabel(artifact.title, known?.label ?? null, artifact.id);
  const id = artifactNodeId(projectId, moduleId, artifact.id);
  const effective = artifact.archived || (archives.moduleArchived.get(moduleCacheKey) ?? false);
  const node: FlatNode = {
    id,
    kind: isReq ? "requirement" : isMockup ? "mockup" : "design",
    label,
    secondary: label !== artifact.id ? artifact.id : null,
    title: label === artifact.id ? artifact.id : `${label} — ${artifact.id}`,
    depth,
    expandable: isReq || isMockup,
    expanded: (isReq || isMockup) && expanded.has(id),
    selected,
    approved: known?.approved ?? null,
    artifactKind: isReq ? null : artifact.kind,
    linkKind: null,
    staleLink: false,
    archived: effective,
    archivedOwn: artifact.archived,
    projectId,
    moduleId,
    artifactId: artifact.id,
    screenId: null,
    loadState: null,
    count: null,
    hiddenArchived: null,
    children: [],
  };
  if (isReq && node.expanded) {
    node.children = buildRequirementLinks(
      input,
      archives,
      projectId,
      moduleId,
      moduleCacheKey,
      artifact.id,
      depth + 1,
    );
  }
  if (isMockup && node.expanded) {
    node.children = buildMockupScreens(
      input,
      projectId,
      moduleId,
      moduleCacheKey,
      artifact.id,
      effective,
      depth + 1,
    );
  }
  return node;
}

/**
 * A mockup's screens as shortcuts to the same artifact: opening any of
 * them opens the mockup on that screen. Derived from the module's already
 * loaded details (asking nothing more); the detail decides what is
 * readable and the graph state decides loading and error.
 */
function buildMockupScreens(
  input: ForestInput,
  projectId: string,
  moduleId: string,
  moduleCacheKey: string,
  mockupId: string,
  archived: boolean,
  depth: number,
): FlatNode[] {
  const known = input.mockupScreens[mockupId];
  if (known === undefined) {
    const info = input.linksStatus[moduleCacheKey];
    if (info?.status === "error") {
      const status = statusNode(screenNodeId(mockupId, ""), depth, "error");
      status.label = info.error ?? "Could not load the screens.";
      status.projectId = projectId;
      status.moduleId = moduleId;
      return [status];
    }
    return [statusNode(screenNodeId(mockupId, ""), depth, "loading")];
  }
  if (known.unparsed) {
    const status = statusNode(screenNodeId(mockupId, ""), depth, "error");
    status.label = "Unreadable content: the detail will tell what fails.";
    status.projectId = projectId;
    status.moduleId = moduleId;
    return [status];
  }
  if (known.screens.length === 0) {
    const status = statusNode(screenNodeId(mockupId, ""), depth, "empty");
    status.label = "No screens";
    return [status];
  }
  return known.screens.map((screen) => {
    const selected =
      input.selection.mockupId === mockupId &&
      input.selection.screenId === screen.id &&
      input.selection.moduleId === moduleId &&
      input.selection.projectId === projectId;
    return {
      id: screenNodeId(mockupId, screen.id),
      kind: "screen" as ExplorerNodeKind,
      label: screen.title,
      secondary: screen.title !== screen.id ? screen.id : null,
      title: `${screen.title} — ${screen.id} · ${screen.components} components`,
      depth,
      expandable: false,
      expanded: false,
      selected,
      approved: null,
      artifactKind: "mockup",
      linkKind: null,
      staleLink: false,
      archived,
      archivedOwn: false,
      projectId,
      moduleId,
      artifactId: mockupId,
      screenId: screen.id,
      loadState: null,
      count: null,
      hiddenArchived: null,
      children: [],
    };
  });
}

/**
 * Linked-design shortcuts under a requirement. They reference the same
 * index artifact (no data duplicated): opening any opens alike.
 */
function buildRequirementLinks(
  input: ForestInput,
  archives: ArchiveContext,
  projectId: string,
  moduleId: string,
  moduleCacheKey: string,
  requirementId: string,
  depth: number,
): FlatNode[] {
  const links = input.designLinks[requirementId];
  if (links === undefined) {
    const info = input.linksStatus[moduleCacheKey];
    if (info?.status === "error") {
      const status = statusNode(linksStatusNodeId(requirementId), depth, "error");
      status.label = info.error ?? "Could not load the links.";
      status.projectId = projectId;
      status.moduleId = moduleId;
      return [status];
    }
    return [statusNode(linksStatusNodeId(requirementId), depth, "loading")];
  }
  // Shortcuts to archived designs filter just like the index.
  const moduleArchived = archives.moduleArchived.get(moduleCacheKey) ?? false;
  const visible = input.showArchived
    ? links
    : links.filter(
        (link) => !(archives.artifactArchived.get(link.artifactId) ?? false) && !moduleArchived,
      );
  if (visible.length === 0) {
    const status = statusNode(linksStatusNodeId(requirementId), depth, "empty");
    status.label =
      links.length === 0 ? "No linked designs" : "No linked designs (archived)";
    return [status];
  }
  // Module index titles (same source, no data duplicated).
  const titles = new Map<string, string | null>();
  for (const artifact of input.artifactsByModule[moduleCacheKey] ?? []) {
    titles.set(artifact.id, artifact.title);
  }
  return visible.map((link) => {
    const known = input.meta[link.artifactId];
    const label = artifactLabel(titles.get(link.artifactId) ?? null, known?.label ?? null, link.artifactId);
    const isMockupLink = link.kind === "mockup";
    const wanted = isMockupLink ? input.selection.mockupId : input.selection.designId;
    return {
      id: linkNodeId(requirementId, link.artifactId),
      kind: (isMockupLink ? "mockup" : "design") as ExplorerNodeKind,
      label,
      secondary: label !== link.artifactId ? link.artifactId : null,
      title: label === link.artifactId ? link.artifactId : `${label} — ${link.artifactId}`,
      depth,
      expandable: false,
      expanded: false,
      selected:
        wanted === link.artifactId &&
        input.selection.moduleId === moduleId &&
        input.selection.projectId === projectId,
      // No approval badge: the shortcut reports the link (direct /
      // transitive / stale) and approval lives on the index's canonical
      // row. That keeps the label readable.
      approved: null,
      artifactKind: link.kind,
      linkKind: link.link,
      staleLink: link.stale,
      archived: (archives.artifactArchived.get(link.artifactId) ?? false) || moduleArchived,
      archivedOwn: archives.artifactArchived.get(link.artifactId) ?? false,
      projectId,
      moduleId,
      artifactId: link.artifactId,
      screenId: null,
      loadState: null,
      count: null,
      hiddenArchived: null,
      children: [],
    };
  });
}

/** Visible rows in walk order, for roving tabindex and keyboard. */
export function flattenVisible(forest: FlatNode[]): FlatNode[] {
  const rows: FlatNode[] = [];
  const visit = (nodes: FlatNode[]) => {
    for (const node of nodes) {
      rows.push(node);
      if (node.expanded) visit(node.children);
    }
  };
  visit(forest);
  return rows;
}

/** May the row take tree focus? Informative states stay out. */
export function isFocusable(node: FlatNode): boolean {
  return node.kind !== "status";
}

/**
 * Next visible row whose label starts with the buffer (type-ahead),
 * searching from after `fromIndex` and wrapping around.
 */
export function findTypeahead(rows: FlatNode[], fromIndex: number, buffer: string): number {
  const needle = buffer.toLocaleLowerCase();
  if (needle === "") return fromIndex;
  for (let step = 1; step <= rows.length; step += 1) {
    const index = (fromIndex + step) % rows.length;
    const row = rows[index];
    if (isFocusable(row) && row.label.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return fromIndex;
}
