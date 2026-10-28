// Modelo puro del explorador en árbol. Sin React ni Tauri: ids de nodo,
// construcción del bosque visible y ayudas de navegación por teclado.
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
  | "status";

export type NodeLoadState = "loading" | "error" | "empty";

/** Metadato conocido de un artefacto cuyo detalle se cargó en la sesión. */
export interface ArtifactMeta {
  /** Primera línea del contenido actual, truncada. */
  label: string;
  /** Aprobación de la versión actual, si se conoce. */
  approved: boolean | null;
}

export interface FlatNode {
  id: string;
  kind: ExplorerNodeKind;
  /** Texto principal: nombre real o primera línea cuando se conoce. */
  label: string;
  /** ID como información secundaria cuando difiere de la etiqueta. */
  secondary: string | null;
  title: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  selected: boolean;
  /** Estado de revisión conocido; null = desconocido (sin badge). */
  approved: boolean | null;
  /** Subtipo de diseño (`flow`/`data_model`) para su badge. */
  artifactKind: string | null;
  /** Vínculo con el requisito padre (solo accesos bajo requisitos). */
  linkKind: "direct" | "transitive" | null;
  /** El acceso usa versiones que ya no son actuales. */
  staleLink: boolean;
  /** Archivado efectivo: propio o por contexto del módulo. */
  archived: boolean;
  /** Archivado propio (sin contexto): decide archivar o restaurar. */
  archivedOwn: boolean;
  projectId: string | null;
  moduleId: string | null;
  artifactId: string | null;
  loadState: NodeLoadState | null;
  /** Nº de artefactos en grupos con datos cargados. */
  count: number | null;
  /** Archivados ocultos en grupos cuando no se muestran. */
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
  };
  meta: Record<string, ArtifactMeta>;
  /** Diseños vinculados por requisito (derivados de fuentes exactas). */
  designLinks: Record<string, DesignLink[]>;
  /** Estado de vínculos por módulo (clave `proyecto/módulo`). */
  linksStatus: Record<string, { status: "loading" | "error"; error: string | null }>;
  /** Mostrar archivados; si no, se filtran de las listas activas. */
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
 * Acceso a un diseño bajo un requisito. Mismo artefacto que en el índice
 * del módulo, distinta ubicación: abrir cualquiera abre el mismo detalle.
 */
export function linkNodeId(requirementId: string, designId: string): string {
  return `l:${requirementId}/${designId}`;
}

/** Fila de estado (carga, error, vacío) bajo un requisito expandido. */
export function linksStatusNodeId(requirementId: string): string {
  return `ls:${requirementId}`;
}

/** Clave de caché de artefactos de un módulo. */
export function moduleKey(projectId: string, moduleId: string): string {
  return `${projectId}/${moduleId}`;
}

/**
 * Primera línea visible de un contenido, truncada. Sin contenido no hay
 * título inventado: el llamador conserva el ID en ese caso.
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
 * Nodos que deben expandirse para que la selección quede visible:
 * proyecto, módulo y, para artefactos, su grupo.
 */
export function ancestorsForSelection(
  projectId: string | null,
  moduleId: string | null,
  requirementId: string | null,
  designId: string | null,
  mockupId: string | null = null,
): string[] {
  if (projectId === null) return [];
  const ids = [projectNodeId(projectId)];
  if (moduleId === null) return ids;
  ids.push(moduleNodeId(projectId, moduleId));
  if (requirementId !== null) ids.push(groupNodeId(projectId, moduleId, "req"));
  if (designId !== null) ids.push(groupNodeId(projectId, moduleId, "design"));
  if (mockupId !== null) ids.push(groupNodeId(projectId, moduleId, "mockup"));
  return ids;
}

function statusNode(parentId: string, depth: number, loadState: NodeLoadState): FlatNode {
  return {
    id: `${parentId}#${loadState}`,
    kind: "status",
    label: loadState === "loading" ? "Cargando…" : loadState === "error" ? "Error" : "Vacío",
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
    loadState,
    count: null,
    hiddenArchived: null,
    children: [],
  };
}

/** Contexto de archivado derivado de las listas cargadas. */
interface ArchiveContext {
  /** Archivado propio por módulo (clave `proyecto/módulo`). */
  moduleArchived: Map<string, boolean>;
  /** Archivado propio por artefacto (ids globales únicos). */
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

/** Etiqueta de vacío honesta: distingue «no hay» de «hay pero archivados». */
function emptyLabel(base: string, hidden: number): string {
  return hidden > 0 ? `${base} (${hidden} archivado${hidden === 1 ? "" : "s"})` : base;
}

/**
 * Secundaria y tooltip de una fila con nombre: el ID solo aparece cuando la
 * etiqueta lo oculta, y el tooltip muestra el nombre completo.
 */
function namedRow(
  label: string,
  id: string,
): { secondary: string | null; title: string } {
  if (label === id) return { secondary: null, title: id };
  return { secondary: id, title: `${label} — ${id}` };
}

/**
 * Construye el bosque visible en orden. Solo incluye hijos de nodos
 * expandidos; los contenedores sin datos muestran su estado
 * (carga, error con reintento, o vacío). Sin `showArchived`, los módulos
 * y artefactos archivados se filtran de las listas activas.
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
    if (visible.length === 0) {
      node.children = [statusNode(pid, 1, "empty")];
      node.children[0].label = emptyLabel("Sin módulos", modules.length - visible.length);
      return node;
    }
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
  // Archivado efectivo = propio o por contexto del módulo.
  const items = input.showArchived
    ? candidates
    : candidates.filter((a) => !a.archived && !moduleArchived);
  const hidden = candidates.length - items.length;
  const node: FlatNode = {
    id: gid,
    kind: group === "req" ? "reqGroup" : group === "mockup" ? "mockupGroup" : "designGroup",
    label:
      group === "req" ? "Requisitos" : group === "mockup" ? "Mockups del módulo" : "Diseños del módulo",
    secondary: null,
    title:
      group === "req"
        ? "Requisitos del módulo"
        : group === "mockup"
          ? "Mockups del módulo"
          : "Diseños del módulo",
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
      group === "req" ? "Sin requisitos" : group === "mockup" ? "Sin mockups" : "Sin diseños",
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
    expandable: isReq,
    expanded: isReq && expanded.has(id),
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
  return node;
}

/**
 * Accesos a diseños vinculados bajo un requisito. Son referencias al mismo
 * artefacto del índice (sin duplicar datos): abrir cualquiera abre igual.
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
      status.label = info.error ?? "No se pudieron cargar los vínculos.";
      status.projectId = projectId;
      status.moduleId = moduleId;
      return [status];
    }
    return [statusNode(linksStatusNodeId(requirementId), depth, "loading")];
  }
  // Los accesos a diseños archivados se filtran igual que el índice.
  const moduleArchived = archives.moduleArchived.get(moduleCacheKey) ?? false;
  const visible = input.showArchived
    ? links
    : links.filter(
        (link) => !(archives.artifactArchived.get(link.artifactId) ?? false) && !moduleArchived,
      );
  if (visible.length === 0) {
    const status = statusNode(linksStatusNodeId(requirementId), depth, "empty");
    status.label =
      links.length === 0 ? "Sin diseños vinculados" : "Sin diseños vinculados (archivados)";
    return [status];
  }
  // Títulos del índice del módulo (misma fuente, sin duplicar datos).
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
      // Sin badge de aprobación: el acceso informa del vínculo (directo /
      // transitivo / desactualizado) y la aprobación vive en la fila
      // canónica del índice. Así la etiqueta conserva espacio legible.
      approved: null,
      artifactKind: link.kind,
      linkKind: link.link,
      staleLink: link.stale,
      archived: (archives.artifactArchived.get(link.artifactId) ?? false) || moduleArchived,
      archivedOwn: archives.artifactArchived.get(link.artifactId) ?? false,
      projectId,
      moduleId,
      artifactId: link.artifactId,
      loadState: null,
      count: null,
      hiddenArchived: null,
      children: [],
    };
  });
}

/** Filas visibles en orden de recorrido, para roving tabindex y teclado. */
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

/** ¿La fila admite foco del árbol? Los estados informativos quedan fuera. */
export function isFocusable(node: FlatNode): boolean {
  return node.kind !== "status";
}

/**
 * Siguiente fila visible cuya etiqueta empieza por el buffer (type-ahead),
 * buscando desde después de `fromIndex` y dando la vuelta.
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
