// Explorer container: joins lazy loading with the tree. Emits selections
// and creations to the workspace (which keeps draft dialogs and views)
// and reports the selected module's data for the center views.
import { useEffect, useMemo, useState } from "react";
import { parseMockupSpec } from "../mockup/mockupModel";
import { useRequirementsUi, type Selection } from "../requirements/uiStore";
import { listProjectLinks } from "../code/client";
import type { CodeLinkDto } from "../code/types";
import { useCodeWorkspace } from "../code/useCodeWorkspace";
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
  onSelectScreen: (projectId: string, moduleId: string, mockupId: string, screenId: string) => void;
  onCreateProject: () => void;
  /** Create a project from a code folder (desktop). */
  onCreateProjectFromFolder?: () => void;
  onCreateModule: (projectId: string) => void;
  onNewRequirement: (projectId: string, moduleId: string) => void;
  onProposeRequirements: (projectId: string, moduleId: string) => void;
  onNewMockup: (projectId: string, moduleId: string) => void;
  onSelectedModuleData: (modules: ModuleDto[], artifacts: ArtifactDto[]) => void;
  /** Selected module's links for the design view. */
  onSelectedGraph: (graph: ModuleGraph | null) => void;
  /** Archive, restore or delete from a row's menu. */
  onArchiveAction: (target: ArchiveTarget, action: ArchiveAction) => void;
  /** Rename a project, module, requirement, design or mockup from its row. */
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
  onSelectScreen,
  onCreateProject,
  onCreateProjectFromFolder,
  onCreateModule,
  onNewRequirement,
  onProposeRequirements,
  onNewMockup,
  onSelectedModuleData,
  onSelectedGraph,
  onArchiveAction,
  onRename,
}: ExplorerPanelProps) {
  // Local session: show archived or active lists only.
  const [showArchived, setShowArchived] = useState(false);
  const { handleRevealDir } = useCodeWorkspace();
  // Module↔path links of the selected project (one on-demand call):
  // folder chip + jump on module rows.
  const [moduleLinks, setModuleLinks] = useState<Record<string, CodeLinkDto[]>>({});
  useEffect(() => {
    let stale = false;
    if (selection.projectId === null) {
      setModuleLinks({});
      return;
    }
    const projectId = selection.projectId;
    listProjectLinks(projectId)
      .then((all) => {
        if (stale) return;
        const byModule: Record<string, CodeLinkDto[]> = {};
        for (const link of all.moduleLinks) {
          (byModule[link.ownerId] ??= []).push(link);
        }
        setModuleLinks(byModule);
      })
      .catch(() => {
        // Without links there are no chips: the tree keeps working.
        if (!stale) setModuleLinks({});
      });
    return () => {
      stale = true;
    };
  }, [selection.projectId, refreshToken]);

  function handleOpenInCode(rootId: string, rel: string): void {
    // The explorer always shows folders: revealing needs no view switch.
    handleRevealDir(rootId, rel);
  }

  const data = useExplorerData({
    storageReady,
    projectId: selection.projectId,
    moduleId: selection.moduleId,
    requirementId: selection.requirementId,
    designId: selection.designId,
    mockupId: selection.mockupId,
    screenId: selection.screenId,
    refreshToken,
  });

  // Links of every loaded module, indexed by requirement.
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

  // Screens per mockup, derived from the graph's already loaded
  // details (parsed current version; asking nothing more).
  const mockupScreens = useMemo(() => {
    const merged: Record<string, { screens: { id: string; title: string; components: number }[]; unparsed: boolean }> = {};
    for (const graph of Object.values(data.graphsByModule)) {
      if (graph.status !== "ready" || !graph.details) continue;
      for (const detail of graph.details) {
        if (detail.artifact.kind !== "mockup") continue;
        const current = detail.versions.find((v) => v.id === detail.currentVersionId);
        if (!current) {
          merged[detail.artifact.id] = { screens: [], unparsed: true };
          continue;
        }
        try {
          const parsed = parseMockupSpec(JSON.parse(current.content));
          if (!parsed) {
            merged[detail.artifact.id] = { screens: [], unparsed: true };
          } else {
            merged[detail.artifact.id] = {
              screens: parsed.screens.map((s) => ({
                id: s.id,
                title: s.title,
                components: s.components.length,
              })),
              unparsed: false,
            };
          }
        } catch {
          merged[detail.artifact.id] = { screens: [], unparsed: true };
        }
      }
    }
    return merged;
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
        mockupScreens,
        showArchived,
      }),
    [data, selection, meta, designLinks, linksStatus, mockupScreens, showArchived],
  );

  // Selected module's data for the center views and impact.
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
    // Live context names for the breadcrumb (presentation only).
    const projectName = data.projects.find((p) => p.id === projectId)?.name ?? null;
    const moduleName =
      moduleId === null ? null : (modules.find((m) => m.id === moduleId)?.name ?? null);
    useRequirementsUi.getState().setContextNames({ project: projectName, module: moduleName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, moduleId, data.projects, data.modulesByProject, data.artifactsByModule, data.graphsByModule]);

  // Focus follows the deepest visible selection.
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
    if (node.kind === "project" && node.projectId !== null) {
      onArchiveAction({ kind: "project", projectId: node.projectId }, action);
      return;
    }
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
    // The target comes from the loaded DTOs (real title or null), never
    // from the visible label (which may be derived): so `expected` is true.
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
      // Mockups rename through the diagrams command (the core accepts
      // them); presentation already said "mockup".
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
      case "screen":
        if (node.projectId && node.moduleId && node.artifactId && node.screenId) {
          onSelectScreen(node.projectId, node.moduleId, node.artifactId, node.screenId);
        }
        break;
      case "reqGroup":
      case "designGroup":
      case "mockupGroup":
        // Groups are not selectable: clicking their row expands.
        data.toggle(node.id);
        break;
      default:
        break;
    }
  }

  return (
    <nav className="navigator explorer" aria-label="Project explorer" hidden={hidden}>
      <div className="explorer-head">
        <h3>PROJECTS</h3>
        <button
          type="button"
          className="tree-action"
          aria-label="Create project"
          title="Create project"
          disabled={busy || !storageReady}
          onClick={onCreateProject}
        >
          +
        </button>
        {onCreateProjectFromFolder !== undefined && (
          <button
            type="button"
            className="tree-action"
            aria-label="Create a project from a code folder"
            title="Create a project from a code folder"
            disabled={busy || !storageReady}
            onClick={onCreateProjectFromFolder}
          >
            ⤴
          </button>
        )}
      </div>
      <label className="archived-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived
      </label>
      {globalError && (
        <p className="error" role="alert">
          {globalError}
        </p>
      )}
      {data.projectsLoading && data.projects.length === 0 ? (
        <p className="hint">Loading projects…</p>
      ) : data.projectsError !== null && data.projects.length === 0 ? (
        <p className="error" role="alert">
          {data.projectsError}{" "}
          <button type="button" className="secondary small" onClick={data.reloadProjects}>
            Retry
          </button>
        </p>
      ) : data.projects.length === 0 ? (
        <p className="hint">No projects. Create the first to start.</p>
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
          moduleLinks={moduleLinks}
          onOpenInCode={handleOpenInCode}
        />
      )}
    </nav>
  );
}
