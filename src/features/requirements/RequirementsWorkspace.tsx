import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { isTauriEnvironment } from "../../lib/env";
import {
  approveVersion,
  coreStatus,
  createModule,
  createProject,
  createRequirement,
  getRequirement,
  listModules,
  listProjects,
  saveVersion,
} from "./client";
import {
  canApprove,
  draftReducer,
  EMPTY_DRAFT,
  needsConfirm,
  reviewReducer,
  EMPTY_REVIEW,
  saveState,
  shouldApplyResponse,
  type SaveState,
} from "./coordination";
import { NavigatorPanel } from "./NavigatorPanel";
import { NewRequirementForm } from "./NewRequirementForm";
import { RequirementEditor } from "./RequirementEditor";
import { ReviewPanel } from "./ReviewPanel";
import { UnsavedDialog } from "./UnsavedDialog";
import { useRequirementsUi, type CenterView, type Selection } from "./uiStore";
import { GenerationPanel } from "../proposals/GenerationPanel";
import { approveDesign, listArtifacts } from "../design/client";
import { DesignDetail } from "../design/DesignDetail";
import { DesignPanel } from "../design/DesignPanel";
import {
  STALE_VERSION,
  currentVersion,
  normalizeCoreError,
  type ArtifactDto,
  type CoreStatus,
  type ModuleDto,
  type ProjectDto,
  type RequirementDetail,
} from "./types";

const SAVE_LABELS: Record<SaveState, string | null> = {
  idle: null,
  draft: "Borrador sin guardar (solo en memoria)",
  saving: "Guardando…",
  saved: "Guardado",
  error: "Error al guardar: el borrador se conserva",
};

type Slot = "projects" | "modules" | "artifacts" | "detail" | "designDetail";

interface PendingNav {
  selection: Selection;
  showCreateForm: boolean;
  showPropose: boolean;
  /** Vista explícita (pestañas); null deriva de la selección. */
  view: CenterView | null;
}

export function RequirementsWorkspace() {
  const [isNative] = useState<boolean>(() => isTauriEnvironment());
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const moduleId = useRequirementsUi((s) => s.selection.moduleId);
  const requirementId = useRequirementsUi((s) => s.selection.requirementId);
  const designId = useRequirementsUi((s) => s.selection.designId);
  const centerView = useRequirementsUi((s) => s.centerView);
  const showNavigator = useRequirementsUi((s) => s.panels.navigator);
  const showReview = useRequirementsUi((s) => s.panels.review);

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [modules, setModules] = useState<ModuleDto[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [designDetail, setDesignDetail] = useState<RequirementDetail | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [designDetailError, setDesignDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [designApproveError, setDesignApproveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [designDetailBusy, setDesignDetailBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [designApproveBusy, setDesignApproveBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  const [draft, dispatchDraft] = useReducer(draftReducer, EMPTY_DRAFT);
  const [review, dispatchReview] = useReducer(reviewReducer, EMPTY_REVIEW);
  const [designReview, dispatchDesignReview] = useReducer(reviewReducer, EMPTY_REVIEW);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [viewingDesignVersionId, setViewingDesignVersionId] = useState<string | null>(null);
  const [designValidated, setDesignValidated] = useState<{ versionId: string; ok: boolean } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [saveAuthor, setSaveAuthor] = useState("");
  const [approver, setApprover] = useState("");
  const [designApprover, setDesignApprover] = useState("");
  const [dialog, setDialog] = useState<PendingNav | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [storage, setStorage] = useState<CoreStatus | null>(null);
  const storageReady = storage?.ready === true;

  const requirements = artifacts.filter((a) => a.kind === "requirement");
  const designs = artifacts.filter((a) => a.kind !== "requirement");

  const epochRef = useRef(0);
  const slotsRef = useRef<Record<Slot, { key: string; epoch: number }>>({
    projects: { key: "", epoch: 0 },
    modules: { key: "", epoch: 0 },
    artifacts: { key: "", epoch: 0 },
    detail: { key: "", epoch: 0 },
    designDetail: { key: "", epoch: 0 },
  });

  const begin = useCallback((slot: Slot, key: string): number => {
    epochRef.current += 1;
    slotsRef.current[slot] = { key, epoch: epochRef.current };
    return epochRef.current;
  }, []);

  const isFresh = useCallback((slot: Slot, key: string, epoch: number): boolean => {
    return shouldApplyResponse(slotsRef.current[slot], { key, epoch });
  }, []);

  const applyDetail = useCallback(
    (slot: Slot, key: string, epoch: number, next: RequirementDetail | null) => {
      if (!isFresh(slot, key, epoch)) return;
      setDetail(next);
      setDetailError(null);
      dispatchReview({ type: "reset" });
      if (next) {
        const current = currentVersion(next);
        if (current) {
          dispatchDraft({ type: "snapshot", requirementId: next.artifact.id, content: current.content });
        }
      }
    },
    [isFresh],
  );

  const loadProjects = useCallback(async () => {
    const epoch = begin("projects", "all");
    setNavBusy(true);
    try {
      const result = await listProjects();
      if (isFresh("projects", "all", epoch)) {
        setProjects(result);
        setNavError(null);
      }
    } catch (raw) {
      if (isFresh("projects", "all", epoch)) {
        setNavError(normalizeCoreError(raw).message);
      }
    } finally {
      if (isFresh("projects", "all", epoch)) setNavBusy(false);
    }
  }, [begin, isFresh]);

  const loadModules = useCallback(
    async (pid: string) => {
      const epoch = begin("modules", pid);
      setNavBusy(true);
      try {
        const result = await listModules(pid);
        if (isFresh("modules", pid, epoch)) {
          setModules(result);
          setNavError(null);
        }
      } catch (raw) {
        if (isFresh("modules", pid, epoch)) {
          setNavError(normalizeCoreError(raw).message);
        }
      } finally {
        if (isFresh("modules", pid, epoch)) setNavBusy(false);
      }
    },
    [begin, isFresh],
  );

  const loadArtifacts = useCallback(
    async (pid: string, mid: string) => {
      const key = `${pid}/${mid}`;
      const epoch = begin("artifacts", key);
      setNavBusy(true);
      try {
        const result = await listArtifacts(pid, mid);
        if (isFresh("artifacts", key, epoch)) {
          setArtifacts(result);
          setNavError(null);
        }
      } catch (raw) {
        if (isFresh("artifacts", key, epoch)) {
          setNavError(normalizeCoreError(raw).message);
        }
      } finally {
        if (isFresh("artifacts", key, epoch)) setNavBusy(false);
      }
    },
    [begin, isFresh],
  );

  const loadDetail = useCallback(
    async (rid: string) => {
      const epoch = begin("detail", rid);
      setDetailBusy(true);
      try {
        const result = await getRequirement(rid);
        applyDetail("detail", rid, epoch, result);
      } catch (raw) {
        if (isFresh("detail", rid, epoch)) {
          setDetailError(normalizeCoreError(raw).message);
        }
      } finally {
        if (isFresh("detail", rid, epoch)) setDetailBusy(false);
      }
    },
    [applyDetail, begin, isFresh],
  );

  const loadDesignDetail = useCallback(
    async (aid: string) => {
      const epoch = begin("designDetail", aid);
      setDesignDetailBusy(true);
      try {
        const result = await getRequirement(aid);
        if (isFresh("designDetail", aid, epoch)) {
          setDesignDetail(result);
          setDesignDetailError(null);
          dispatchDesignReview({ type: "reset" });
          setDesignValidated(null);
        }
      } catch (raw) {
        if (isFresh("designDetail", aid, epoch)) {
          setDesignDetailError(normalizeCoreError(raw).message);
        }
      } finally {
        if (isFresh("designDetail", aid, epoch)) setDesignDetailBusy(false);
      }
    },
    [begin, isFresh],
  );

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await coreStatus();
        if (cancelled) return;
        setStorage(status);
        if (status.ready) void loadProjects();
      } catch (raw) {
        if (cancelled) return;
        setStorage({ ready: false, message: normalizeCoreError(raw).message, dbPath: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative, loadProjects]);

  useEffect(() => {
    if (!storageReady) return;
    if (projectId === null) {
      setModules([]);
      return;
    }
    void loadModules(projectId);
  }, [storageReady, projectId, loadModules]);

  useEffect(() => {
    if (!storageReady) return;
    if (projectId === null || moduleId === null) {
      setArtifacts([]);
      return;
    }
    void loadArtifacts(projectId, moduleId);
  }, [storageReady, projectId, moduleId, loadArtifacts]);

  useEffect(() => {
    if (!storageReady) return;
    if (requirementId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(requirementId);
  }, [storageReady, requirementId, loadDetail]);

  useEffect(() => {
    if (!storageReady) return;
    if (designId === null) {
      setDesignDetail(null);
      return;
    }
    void loadDesignDetail(designId);
  }, [storageReady, designId, loadDesignDetail]);

  const applySelection = useCallback(
    (target: Selection, showCreateForm: boolean, showPropose = false, view: CenterView | null = null) => {
      const ui = useRequirementsUi.getState();
      ui.selectProject(target.projectId);
      if (target.projectId !== null) ui.selectModule(target.moduleId);
      if (target.moduleId !== null) {
        if (target.designId !== null) ui.selectDesign(target.designId);
        else ui.selectRequirement(target.requirementId);
      }
      // Elegir artefacto cambia de vista; elegir proyecto/módulo la conserva.
      const derived: CenterView =
        view ??
        (target.designId !== null
          ? "design"
          : target.requirementId !== null || showCreateForm || showPropose
            ? "requirements"
            : ui.centerView);
      ui.setCenterView(derived);
      dispatchDraft({ type: "select", requirementId: target.requirementId });
      dispatchReview({ type: "reset" });
      dispatchDesignReview({ type: "reset" });
      setViewingVersionId(null);
      setViewingDesignVersionId(null);
      setDesignValidated(null);
      setCreating(showCreateForm);
      setProposing(showPropose);
      setSaveError(null);
      setApproveError(null);
      setDesignApproveError(null);
      setCreateError(null);
      setDialog(null);
      setDialogError(null);
    },
    [],
  );

  const requestSelect = useCallback(
    (target: Selection, showCreateForm: boolean, showPropose = false, view: CenterView | null = null) => {
      if (needsConfirm(draft.dirty, requirementId, target.requirementId)) {
        setDialogError(null);
        setDialog({ selection: target, showCreateForm, showPropose, view });
        return;
      }
      applySelection(target, showCreateForm, showPropose, view);
    },
    [applySelection, draft.dirty, requirementId],
  );

  function requestTab(view: CenterView) {
    if (view === centerView || projectId === null || moduleId === null) return;
    requestSelect(
      {
        projectId,
        moduleId,
        requirementId: view === "requirements" ? requirementId : null,
        designId: view === "design" ? designId : null,
      },
      false,
      false,
      view,
    );
  }

  const selectionSnapshot = useCallback(
    (): Selection => ({ ...useRequirementsUi.getState().selection }),
    [],
  );

  const sameSelection = useCallback((a: Selection, b: Selection): boolean => {
    return (
      a.projectId === b.projectId &&
      a.moduleId === b.moduleId &&
      a.requirementId === b.requirementId &&
      a.designId === b.designId
    );
  }, []);

  async function handleCreateProject() {
    const before = selectionSnapshot();
    setNavBusy(true);
    setNavError(null);
    try {
      const created = await createProject();
      await loadProjects();
      if (sameSelection(before, selectionSnapshot())) {
        applySelection(
          { projectId: created.id, moduleId: null, requirementId: null, designId: null },
          false,
        );
      }
    } catch (raw) {
      setNavError(normalizeCoreError(raw).message);
    } finally {
      setNavBusy(false);
    }
  }

  async function handleCreateModule() {
    if (projectId === null) return;
    const before = selectionSnapshot();
    setNavBusy(true);
    setNavError(null);
    try {
      const created = await createModule(projectId);
      await loadModules(projectId);
      const now = selectionSnapshot();
      if (sameSelection(before, now) && now.projectId === projectId) {
        applySelection(
          { projectId, moduleId: created.id, requirementId: null, designId: null },
          false,
        );
      }
    } catch (raw) {
      setNavError(normalizeCoreError(raw).message);
    } finally {
      setNavBusy(false);
    }
  }

  async function handleCreateRequirement(content: string, author: string) {
    if (projectId === null || moduleId === null) return;
    const before = selectionSnapshot();
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createRequirement({ projectId, moduleId, content, author });
      await loadArtifacts(projectId, moduleId);
      const now = selectionSnapshot();
      if (sameSelection(before, now) && now.moduleId === moduleId) {
        begin("detail", created.artifact.id);
        setDetail(created);
        setDetailError(null);
        applySelection(
          { projectId, moduleId, requirementId: created.artifact.id, designId: null },
          false,
        );
        const current = currentVersion(created);
        if (current) {
          dispatchDraft({ type: "saved", requirementId: created.artifact.id, content: current.content });
        }
      }
    } catch (raw) {
      setCreateError(normalizeCoreError(raw).message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function performSave(): Promise<boolean> {
    if (detail === null || projectId === null) return false;
    const current = currentVersion(detail);
    if (current === undefined) return false;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const saved = await saveVersion({
        projectId,
        artifactId: detail.artifact.id,
        expectedVersionId: current.id,
        content: draft.content,
        author: saveAuthor,
      });
      begin("detail", saved.artifact.id);
      setDetail(saved);
      const next = currentVersion(saved);
      dispatchDraft({
        type: "saved",
        requirementId: saved.artifact.id,
        content: next ? next.content : draft.content,
      });
      dispatchReview({ type: "reset" });
      setViewingVersionId(null);
      return true;
    } catch (raw) {
      const err = normalizeCoreError(raw);
      dispatchDraft({ type: "saveFailed" });
      if (err.kind === STALE_VERSION) {
        setSaveError(
          `${err.message} Se ha actualizado la versión actual: revísala y guarda de nuevo. El borrador se conserva.`,
        );
        void loadDetail(detail.artifact.id);
      } else {
        setSaveError(err.message);
      }
      return false;
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleApprove() {
    if (detail === null || projectId === null) return;
    const current = currentVersion(detail);
    if (current === undefined) return;
    setApproveBusy(true);
    setApproveError(null);
    try {
      const approved = await approveVersion({
        projectId,
        artifactId: detail.artifact.id,
        expectedVersionId: current.id,
        approver,
      });
      begin("detail", approved.artifact.id);
      setDetail(approved);
      dispatchReview({ type: "reset" });
    } catch (raw) {
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_VERSION) {
        setApproveError(`${err.message} Se ha actualizado la versión actual: revísala.`);
        void loadDetail(detail.artifact.id);
      } else {
        setApproveError(err.message);
      }
    } finally {
      setApproveBusy(false);
    }
  }

  async function handleDialogSave() {
    if (dialog === null || saveAuthor.trim() === "") {
      setDialogError("Indica la autoría para guardar la versión.");
      return;
    }
    const ok = await performSave();
    if (ok) applySelection(dialog.selection, dialog.showCreateForm, dialog.showPropose, dialog.view);
  }

  function handleDialogDiscard() {
    if (dialog === null) return;
    applySelection(dialog.selection, dialog.showCreateForm, dialog.showPropose, dialog.view);
  }

  async function handleProposalAccepted(detail: RequirementDetail) {
    // El panel sigue abierto: solo refrescar el navegador con el requisito
    // creado, sin mover la selección ni tocar borradores.
    if (projectId === null || moduleId === null) return;
    if (detail.artifact.projectId !== projectId || detail.artifact.moduleId !== moduleId) return;
    await loadArtifacts(projectId, moduleId);
  }

  async function handleDesignAccepted(detail: RequirementDetail) {
    if (projectId === null || moduleId === null) return;
    if (detail.artifact.projectId !== projectId || detail.artifact.moduleId !== moduleId) return;
    await loadArtifacts(projectId, moduleId);
  }

  function handleOpenRequirement(artifactId: string) {
    if (projectId !== null && moduleId !== null) {
      requestSelect({ projectId, moduleId, requirementId: artifactId, designId: null }, false);
    }
  }

  function handleOpenDesign(artifactId: string) {
    if (projectId !== null && moduleId !== null) {
      requestSelect({ projectId, moduleId, requirementId: null, designId: artifactId }, false);
    }
  }

  async function handleApproveDesign() {
    if (designDetail === null || projectId === null) return;
    const current = currentVersion(designDetail);
    if (current === undefined) return;
    setDesignApproveBusy(true);
    setDesignApproveError(null);
    try {
      const approved = await approveDesign({
        projectId,
        artifactId: designDetail.artifact.id,
        expectedVersionId: current.id,
        approver: designApprover,
      });
      begin("designDetail", approved.artifact.id);
      setDesignDetail(approved);
      dispatchDesignReview({ type: "reset" });
    } catch (raw) {
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_VERSION) {
        setDesignApproveError(`${err.message} Se ha actualizado la versión actual: revísala.`);
        void loadDesignDetail(designDetail.artifact.id);
      } else {
        setDesignApproveError(err.message);
      }
    } finally {
      setDesignApproveBusy(false);
    }
  }

  const current = detail ? currentVersion(detail) : undefined;
  const mutating = saveBusy || approveBusy || createBusy;
  const approveAllowed =
    detail !== null &&
    current !== undefined &&
    canApprove({
      reviewedVersionId: review.reviewedVersionId,
      currentVersionId: current.id,
      dirty: draft.dirty,
      approver,
      busy: mutating,
    });
  const viewing =
    viewingVersionId !== null && detail
      ? (detail.versions.find((v) => v.id === viewingVersionId) ?? null)
      : null;

  const designCurrent = designDetail ? currentVersion(designDetail) : undefined;
  const approveAllowedDesign =
    designDetail !== null &&
    designCurrent !== undefined &&
    designValidated?.versionId === designCurrent.id &&
    designValidated.ok &&
    canApprove({
      reviewedVersionId: designReview.reviewedVersionId,
      currentVersionId: designCurrent.id,
      dirty: false,
      approver: designApprover,
      busy: designApproveBusy,
    });
  const viewingDesign =
    viewingDesignVersionId !== null && designDetail
      ? (designDetail.versions.find((v) => v.id === viewingDesignVersionId) ?? null)
      : null;
  const navBusyAll = navBusy || mutating || designApproveBusy;

  if (!isNative) {
    return (
      <section className="panel" aria-label="Requisitos">
        <h2>Requisitos</h2>
        <p className="notice">
          Estás en un navegador. Crear y revisar requisitos es nativo y requiere
          ejecutar Ruth IDE como aplicación de escritorio (Tauri). No se simula
          ningún guardado ni aprobación.
        </p>
      </section>
    );
  }

  const saveStateValue = saveState({
    hasSelection: requirementId !== null,
    saving: saveBusy,
    error: saveError,
    dirty: draft.dirty,
  });
  const saveLabel = SAVE_LABELS[saveStateValue];

  // La banda solo interrumpe al comprobar o fallar; en marcha, el estado
  // vive en la barra inferior sin empujar el contenido.
  const banner =
    storage === null ? (
      <p className="store-banner" role="note">
        Comprobando almacenamiento local…
      </p>
    ) : storage.ready ? null : (
      <p className="store-banner error" role="alert">
        No se pudo abrir la base local: {storage.message ?? "error desconocido"}{" "}
        Nada se ha borrado ni reemplazado.
        {storage.dbPath ? <> Ruta: {storage.dbPath}.</> : null} Revisa la ruta y
        los permisos, cierra otra instancia de Ruth IDE si está abierta y vuelve
        a abrir.
      </p>
    );

  if (storage !== null && !storage.ready) {
    return (
      <section className="workbench" aria-label="Espacio de requisitos">
        {banner}
      </section>
    );
  }

  function togglePanel(panel: "navigator" | "review") {
    useRequirementsUi.getState().togglePanel(panel);
  }

  return (
    <section className="workbench" aria-label="Espacio de trabajo">
      {banner}
      <div className="workbench-grid">
        <div className="rail" aria-label="Paneles">
          <button
            type="button"
            className={showNavigator ? "active" : ""}
            onClick={() => togglePanel("navigator")}
            aria-pressed={showNavigator}
            title={showNavigator ? "Ocultar navegador" : "Mostrar navegador"}
            aria-label={showNavigator ? "Ocultar navegador" : "Mostrar navegador"}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M1 3.5A1.5 1.5 0 0 1 2.5 2h4l1.5 2h4.5A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 11.5v-8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
          <button
            type="button"
            className={showReview ? "active" : ""}
            onClick={() => togglePanel("review")}
            aria-pressed={showReview}
            title={showReview ? "Ocultar revisión" : "Mostrar revisión"}
            aria-label={showReview ? "Ocultar revisión" : "Mostrar revisión"}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2.5 8.5 6 12l7.5-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {showNavigator && (
          <NavigatorPanel
            projects={projects}
            modules={modules}
            requirements={requirements}
            designs={designs}
            projectId={projectId}
            moduleId={moduleId}
            requirementId={requirementId}
            designId={designId}
            busy={navBusyAll}
            error={navError}
            onSelectProject={(id) => {
              if (id !== projectId) {
                requestSelect(
                  { projectId: id, moduleId: null, requirementId: null, designId: null },
                  false,
                );
              }
            }}
            onSelectModule={(id) => {
              if (id !== moduleId && projectId !== null) {
                requestSelect(
                  { projectId, moduleId: id, requirementId: null, designId: null },
                  false,
                );
              }
            }}
            onSelectRequirement={(id) => {
              if (id !== requirementId && projectId !== null && moduleId !== null) {
                requestSelect({ projectId, moduleId, requirementId: id, designId: null }, false);
              }
            }}
            onSelectDesign={(id) => {
              if (id !== designId && projectId !== null && moduleId !== null) {
                requestSelect({ projectId, moduleId, requirementId: null, designId: id }, false);
              }
            }}
            onCreateProject={() => void handleCreateProject()}
            onCreateModule={() => void handleCreateModule()}
            onNewRequirement={() => {
              if (projectId !== null && moduleId !== null) {
                requestSelect(
                  { projectId, moduleId, requirementId: null, designId: null },
                  true,
                );
              }
            }}
            onProposeRequirements={() => {
              if (projectId !== null && moduleId !== null) {
                requestSelect(
                  { projectId, moduleId, requirementId: null, designId: null },
                  false,
                  true,
                );
              }
            }}
          />
        )}

        <div className="workbench-center">
          <div className="center-tabs" role="tablist" aria-label="Vistas">
            <button
              type="button"
              role="tab"
              aria-selected={centerView === "requirements"}
              className={centerView === "requirements" ? "active" : ""}
              onClick={() => requestTab("requirements")}
            >
              Requisitos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={centerView === "design"}
              className={centerView === "design" ? "active" : ""}
              onClick={() => requestTab("design")}
            >
              Diseño
            </button>
          </div>
          {centerView === "requirements" ? (
            detailBusy && detail === null ? (
              <p className="hint">Cargando requisito…</p>
            ) : detailError !== null && detail === null ? (
              <p className="error" role="alert">
                {detailError}
              </p>
            ) : detail !== null ? (
              <RequirementEditor
                detail={detail}
                draft={draft.content}
                dirty={draft.dirty}
                author={saveAuthor}
                viewing={viewing}
                busy={saveBusy}
                error={saveError}
                onEdit={(content) => {
                  dispatchDraft({ type: "edit", content });
                  dispatchReview({ type: "reset" });
                }}
                onAuthorChange={setSaveAuthor}
                onSave={() => void performSave()}
                onBackToCurrent={() => setViewingVersionId(null)}
              />
            ) : proposing && projectId !== null && moduleId !== null ? (
              <GenerationPanel
                key={`${projectId}/${moduleId}`}
                projectId={projectId}
                moduleId={moduleId}
                onAccepted={(detail) => void handleProposalAccepted(detail)}
                onOpenRequirement={handleOpenRequirement}
              />
            ) : creating && moduleId !== null ? (
              <NewRequirementForm
                busy={createBusy}
                error={createError}
                onCreate={(content, author) => void handleCreateRequirement(content, author)}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <p className="hint">
                {moduleId === null
                  ? "Selecciona un proyecto y un módulo."
                  : "Selecciona un requisito o crea uno nuevo."}
              </p>
            )
          ) : designId === null ? (
            moduleId === null || projectId === null ? (
              <p className="hint">Selecciona un proyecto y un módulo.</p>
            ) : (
              <DesignPanel
                key={`${projectId}/${moduleId}`}
                projectId={projectId}
                moduleId={moduleId}
                artifacts={artifacts}
                onAccepted={(detail) => void handleDesignAccepted(detail)}
                onOpenDesign={handleOpenDesign}
              />
            )
          ) : designDetailBusy && designDetail === null ? (
            <p className="hint">Cargando diseño…</p>
          ) : designDetailError !== null && designDetail === null ? (
            <p className="error" role="alert">
              {designDetailError}
            </p>
          ) : designDetail !== null ? (
            <DesignDetail
              detail={designDetail}
              viewing={viewingDesign}
              onBackToCurrent={() => setViewingDesignVersionId(null)}
              onValidatedVersion={(versionId, ok) => setDesignValidated({ versionId, ok })}
            />
          ) : null}
        </div>

        {showReview && detail !== null && current !== undefined && (
          <ReviewPanel
            detail={detail}
            reviewedVersionId={review.reviewedVersionId}
            approver={approver}
            dirty={draft.dirty}
            busy={mutating}
            approveAllowed={approveAllowed}
            approveError={approveError}
            viewingVersionId={viewingVersionId}
            onToggleReview={(versionId, checked) =>
              dispatchReview({ type: "toggle", versionId, checked })
            }
            onApproverChange={setApprover}
            onApprove={() => void handleApprove()}
            onViewVersion={(versionId) =>
              setViewingVersionId(versionId === detail.currentVersionId ? null : versionId)
            }
          />
        )}
        {showReview && detail === null && designDetail !== null && designCurrent !== undefined && (
          <ReviewPanel
            detail={designDetail}
            reviewedVersionId={designReview.reviewedVersionId}
            approver={designApprover}
            dirty={false}
            busy={designApproveBusy}
            approveAllowed={approveAllowedDesign}
            approveError={designApproveError}
            viewingVersionId={viewingDesignVersionId}
            sources={designCurrent.sources}
            onToggleReview={(versionId, checked) =>
              dispatchDesignReview({ type: "toggle", versionId, checked })
            }
            onApproverChange={setDesignApprover}
            onApprove={() => void handleApproveDesign()}
            onViewVersion={(versionId) =>
              setViewingDesignVersionId(
                versionId === designDetail.currentVersionId ? null : versionId,
              )
            }
          />
        )}
      </div>

      <footer className="statusbar" aria-label="Estado">
        <span className="status-left">
          <span className={`save-dot ${saveStateValue}`} aria-hidden="true" />
          {saveLabel ?? "Persistencia local activa"}
        </span>
        <span className="status-right">
          {projectId ?? "—"} / {moduleId ?? "—"}
          {(requirementId ?? designId) !== null ? ` / ${requirementId ?? designId}` : ""}
        </span>
      </footer>

      {dialog !== null && requirementId !== null && (
        <UnsavedDialog
          requirementId={requirementId}
          author={saveAuthor}
          busy={saveBusy}
          error={dialogError ?? saveError}
          onAuthorChange={setSaveAuthor}
          onSave={() => void handleDialogSave()}
          onDiscard={handleDialogDiscard}
          onCancel={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}
    </section>
  );
}
