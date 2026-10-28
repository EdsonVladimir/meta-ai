// Contenedor del explorador: une la carga diferida con el árbol. Emite
// selecciones y creaciones hacia el workspace (que conserva diálogos de
// borrador y vistas) e informa de los datos del módulo seleccionado para
// las vistas centrales.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_NAV_WIDTH,
  MAX_NAV_WIDTH,
  MIN_NAV_WIDTH,
  useRequirementsUi,
  type Selection,
} from "../requirements/uiStore";
import type { ArtifactDto, ModuleDto } from "../requirements/types";
import type { RenameTarget } from "../requirements/names";
import type { DesignLink } from "../design/coordination";
import { ExplorerTree } from "./ExplorerTree";
import type { ArchiveAction, ArchiveTarget } from "../requirements/archive";
import { buildForest, moduleKey, type ArtifactMeta, type FlatNode } from "./explorerModel";
import { useExplorerData, type ModuleGraph } from "./useExplorerData";

interface ExplorerPanelProps {
  storageReady: boolean;
  selection: Selection;
  refreshToken: number;
  busy: boolean;
  globalError: string | null;
  meta: Record<string, ArtifactMeta>;
  hidden: boolean;
  onSelectProject: (projectId: string) => void;
  onSelectModule: (projectId: string, moduleId: string) => void;
  onSelectRequirement: (projectId: string, moduleId: string, requirementId: string) => void;
  onSelectDesign: (projectId: string, moduleId: string, designId: string) => void;
  onSelectMockup: (projectId: string, moduleId: string, mockupId: string) => void;
  onCreateProject: () => void;
  onCreateModule: (projectId: string) => void;
  onNewRequirement: (projectId: string, moduleId: string) => void;
  onProposeRequirements: (projectId: string, moduleId: string) => void;
  onNewMockup: (projectId: string, moduleId: string) => void;
  onSelectedModuleData: (modules: ModuleDto[], artifacts: ArtifactDto[]) => void;
  /** Vínculos del módulo seleccionado para la vista de diseño. */
  onSelectedGraph: (graph: ModuleGraph | null) => void;
  /** Archivar, restaurar o eliminar desde el menú de una fila. */
  onArchiveAction: (target: ArchiveTarget, action: ArchiveAction) => void;
  /** Renombrar un proyecto, módulo, requisito, diseño o mockup desde su fila. */
  onRename: (target: RenameTarget) => void;
}

export function ExplorerPanel({
  storageReady,
  selection,
  refreshToken,
  busy,
  globalError,
  meta,
  hidden,
  onSelectProject,
  onSelectModule,
  onSelectRequirement,
  onSelectDesign,
  onSelectMockup,
  onCreateProject,
  onCreateModule,
  onNewRequirement,
  onProposeRequirements,
  onNewMockup,
  onSelectedModuleData,
  onSelectedGraph,
  onArchiveAction,
  onRename,
}: ExplorerPanelProps) {
  // Sesión local: ver archivados o solo listas activas.
  const [showArchived, setShowArchived] = useState(false);
  const data = useExplorerData({
    storageReady,
    projectId: selection.projectId,
    moduleId: selection.moduleId,
    requirementId: selection.requirementId,
    designId: selection.designId,
    mockupId: selection.mockupId,
    refreshToken,
  });

  // Vínculos de todos los módulos cargados, indexados por requisito.
  const designLinks = useMemo(() => {
    const merged: Record<string, DesignLink[]> = {};
    for (const graph of Object.values(data.graphsByModule)) {
      if (graph.index) Object.assign(merged, graph.index.byRequirement);
    }
    return merged;
  }, [data.graphsByModule]);
  const linksStatus = useMemo(() => {
    const statuses: Record<string, { status: "loading" | "error"; error: string | null }> = {};
    for (const [key, graph] of Object.entries(data.graphsByModule)) {
      if (graph.status !== "ready") {
        statuses[key] = { status: graph.status, error: graph.error };
      }
    }
    return statuses;
  }, [data.graphsByModule]);

  const forest = useMemo(
    () =>
      buildForest({
        projects: data.projects,
        modulesByProject: data.modulesByProject,
        artifactsByModule: data.artifactsByModule,
        loadingKeys: data.loadingKeys,
        errorKeys: data.errorKeys,
        expanded: data.expanded,
        selection,
        meta,
        designLinks,
        linksStatus,
        showArchived,
      }),
    [data, selection, meta, designLinks, linksStatus, showArchived],
  );

  // Datos del módulo seleccionado para las vistas centrales y el impacto.
  const { projectId, moduleId } = selection;
  useEffect(() => {
    if (projectId === null) {
      onSelectedModuleData([], []);
      onSelectedGraph(null);
      useRequirementsUi.getState().setContextNames({ project: null, module: null });
      return;
    }
    const modules = data.modulesByProject[projectId] ?? [];
    const moduleCacheKey = moduleId === null ? null : moduleKey(projectId, moduleId);
    const artifacts = moduleCacheKey === null ? [] : (data.artifactsByModule[moduleCacheKey] ?? []);
    onSelectedModuleData(modules, artifacts);
    onSelectedGraph(moduleCacheKey === null ? null : (data.graphsByModule[moduleCacheKey] ?? null));
    // Nombres vigentes del contexto para la miga de pan (solo presentación).
    const projectName = data.projects.find((p) => p.id === projectId)?.name ?? null;
    const moduleName =
      moduleId === null ? null : (modules.find((m) => m.id === moduleId)?.name ?? null);
    useRequirementsUi.getState().setContextNames({ project: projectName, module: moduleName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, moduleId, data.projects, data.modulesByProject, data.artifactsByModule, data.graphsByModule]);

  // El foco sigue a la selección más profunda visible.
  const followId = useMemo(() => {
    const selected: FlatNode[] = [];
    const visit = (nodes: FlatNode[]) => {
      for (const node of nodes) {
        if (node.selected) selected.push(node);
        visit(node.children);
      }
    };
    visit(forest);
    selected.sort((a, b) => b.depth - a.depth);
    return selected[0]?.id ?? null;
  }, [forest]);

  function handleArchiveAction(node: FlatNode, action: ArchiveAction) {
    if (node.kind === "module" && node.projectId !== null && node.moduleId !== null) {
      onArchiveAction(
        { kind: "module", projectId: node.projectId, moduleId: node.moduleId },
        action,
      );
      return;
    }
    if (
      node.kind === "requirement" &&
      node.projectId !== null &&
      node.moduleId !== null &&
      node.artifactId !== null
    ) {
      onArchiveAction(
        {
          kind: "requirement",
          projectId: node.projectId,
          moduleId: node.moduleId,
          artifactId: node.artifactId,
        },
        action,
      );
    }
  }

  function handleRename(node: FlatNode) {
    // El objetivo sale de los DTO cargados (título real o null), nunca de
    // la etiqueta visible (que puede ser derivada): así `expected` es fiel.
    if (node.kind === "project" && node.projectId !== null) {
      const found = data.projects.find((p) => p.id === node.projectId);
      if (!found) return;
      onRename({ kind: "project", projectId: found.id, current: found.name, expected: found.name });
      return;
    }
    if (node.kind === "module" && node.projectId !== null && node.moduleId !== null) {
      const found = (data.modulesByProject[node.projectId] ?? []).find((m) => m.id === node.moduleId);
      if (!found) return;
      onRename({
        kind: "module",
        projectId: node.projectId,
        moduleId: found.id,
        current: found.name,
        expected: found.name,
      });
      return;
    }
    if (
      (node.kind === "requirement" || node.kind === "design" || node.kind === "mockup") &&
      node.projectId !== null &&
      node.moduleId !== null &&
      node.artifactId !== null
    ) {
      const key = moduleKey(node.projectId, node.moduleId);
      const found = (data.artifactsByModule[key] ?? []).find((a) => a.id === node.artifactId);
      if (!found) return;
      const derived = meta[found.id]?.label ?? null;
      // Los mockups se renombran con el comando de diagramas (el núcleo
      // los admite); la presentación ya dijo «mockup».
      onRename({
        kind: node.kind === "mockup" ? "design" : node.kind,
        projectId: node.projectId,
        moduleId: node.moduleId,
        artifactId: found.id,
        current: found.title ?? "",
        expected: found.title,
        derived: found.title === null ? derived : null,
      });
    }
  }

  function handleActivate(node: FlatNode) {
    switch (node.kind) {
      case "project":
        if (node.projectId) onSelectProject(node.projectId);
        break;
      case "module":
        if (node.projectId && node.moduleId) onSelectModule(node.projectId, node.moduleId);
        break;
      case "requirement":
        if (node.projectId && node.moduleId && node.artifactId) {
          onSelectRequirement(node.projectId, node.moduleId, node.artifactId);
        }
        break;
      case "design":
        if (node.projectId && node.moduleId && node.artifactId) {
          onSelectDesign(node.projectId, node.moduleId, node.artifactId);
        }
        break;
      case "mockup":
        if (node.projectId && node.moduleId && node.artifactId) {
          onSelectMockup(node.projectId, node.moduleId, node.artifactId);
        }
        break;
      case "reqGroup":
      case "designGroup":
      case "mockupGroup":
        // Los grupos no son seleccionables: pulsar su fila despliega.
        data.toggle(node.id);
        break;
      default:
        break;
    }
  }

  return (
    <nav className="navigator explorer" aria-label="Explorador de proyectos" hidden={hidden}>
      <div className="explorer-head">
        <h3>PROYECTOS</h3>
        <button
          type="button"
          className="tree-action"
          aria-label="Crear proyecto"
          title="Crear proyecto"
          disabled={busy || !storageReady}
          onClick={onCreateProject}
        >
          +
        </button>
      </div>
      <label className="archived-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Mostrar archivados
      </label>
      {globalError && (
        <p className="error" role="alert">
          {globalError}
        </p>
      )}
      {data.projectsLoading && data.projects.length === 0 ? (
        <p className="hint">Cargando proyectos…</p>
      ) : data.projectsError !== null && data.projects.length === 0 ? (
        <p className="error" role="alert">
          {data.projectsError}{" "}
          <button type="button" className="secondary small" onClick={data.reloadProjects}>
            Reintentar
          </button>
        </p>
      ) : data.projects.length === 0 ? (
        <p className="hint">Sin proyectos. Crea el primero para empezar.</p>
      ) : (
        <ExplorerTree
          forest={forest}
          followId={followId}
          busy={busy}
          onToggle={data.toggle}
          onActivate={handleActivate}
          onRetryProject={data.retryProject}
          onRetryModule={data.retryModule}
          onRetryGraph={data.retryGraph}
          onCreateModule={onCreateModule}
          onNewRequirement={onNewRequirement}
          onPropose={onProposeRequirements}
          onNewMockup={onNewMockup}
          onArchiveAction={handleArchiveAction}
          onRename={handleRename}
        />
      )}
      {!hidden && <ResizeHandle />}
    </nav>
  );
}

/**
 * Tirador para ajustar el ancho lateral (ratón o teclado). El ancho vive
 * en el store como el resto del estado de paneles; null restaura el CSS.
 */
function ResizeHandle() {
  const width = useRequirementsUi((s) => s.navigatorWidth);
  const draggingRef = useRef(false);

  const apply = useCallback((clientX: number, baseX: number, baseWidth: number) => {
    const next = Math.min(MAX_NAV_WIDTH, Math.max(MIN_NAV_WIDTH, baseWidth + clientX - baseX));
    useRequirementsUi.getState().setNavigatorWidth(next);
  }, []);

  return (
    <div
      className="nav-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ajustar ancho del explorador"
      aria-valuenow={width ?? undefined}
      aria-valuemin={MIN_NAV_WIDTH}
      aria-valuemax={MAX_NAV_WIDTH}
      tabIndex={0}
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const baseX = e.clientX;
        const nav = (e.target as HTMLElement).closest("nav");
        const baseWidth = nav?.getBoundingClientRect().width ?? MIN_NAV_WIDTH;
        const move = (ev: PointerEvent) => {
          if (draggingRef.current) apply(ev.clientX, baseX, baseWidth);
        };
        const up = () => {
          draggingRef.current = false;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onKeyDown={(e) => {
        const current = useRequirementsUi.getState().navigatorWidth ?? DEFAULT_NAV_WIDTH;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? 16 : -16;
          useRequirementsUi
            .getState()
            .setNavigatorWidth(
              Math.min(MAX_NAV_WIDTH, Math.max(MIN_NAV_WIDTH, current + delta)),
            );
        } else if (e.key === "Home") {
          e.preventDefault();
          useRequirementsUi.getState().setNavigatorWidth(null);
        }
      }}
    />
  );
}
