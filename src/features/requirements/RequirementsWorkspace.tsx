import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { isTauriEnvironment } from "../../lib/env";
import {
  approveVersion,
  archiveModule,
  archivePreview as fetchArchivePreview,
  archiveRequirement,
  coreStatus,
  createModule,
  createProject,
  createRequirement,
  deleteModule,
  deleteRequirement,
  getRequirement,
  renameModule,
  renameProject,
  renameRequirement,
  restoreModule,
  restoreRequirement,
  saveVersion,
} from "./client";
import {
  canApprove,
  draftReducer,
  EMPTY_DRAFT,
  needsConfirm,
  resolveSaveTarget,
  reviewReducer,
  EMPTY_REVIEW,
  saveState,
  shouldApplyResponse,
  type SaveState,
} from "./coordination";
import { ArchiveDialog } from "./ArchiveDialog";
import { RenameDialog } from "./RenameDialog";
import { renameTargetId, type RenameTarget } from "./names";
import {
  archiveDraftGuard,
  isEffectivelyArchived,
  selectionAfterDelete,
  type ArchiveAction,
  type ArchiveTarget,
} from "./archive";
import { ExplorerPanel } from "../explorer/ExplorerPanel";
import { firstLine, moduleKey, type ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import { NewRequirementForm } from "./NewRequirementForm";
import { RequirementEditor } from "./RequirementEditor";
import { ReviewPanel } from "./ReviewPanel";
import { UnsavedDialog } from "./UnsavedDialog";
import { withDesign, withMockup, withRequirement } from "./navigation";
import { DEFAULT_RIGHT_WIDTH, MAX_RIGHT_WIDTH, MIN_RIGHT_WIDTH, useRequirementsUi, type CenterView, type DocSaveState, type PanelName, type RightTab, type Selection } from "./uiStore";
import { docKey } from "./saveStatus";
import { GenerationPanel } from "../proposals/GenerationPanel";
import {
  approveDesign,
  proposeDesignUpdate,
  renameDesign,
  saveDesignLayout,
  saveDesignVersion,
} from "../design/client";
import type { AutoStatus } from "../design/AutoUpdateToggle";
import { DesignDetail } from "../design/DesignDetail";
import {
  needsVisualConfirm,
  visualDraftReducer,
  visualLayoutDirty,
  visualSemanticDirty,
} from "../design/editing/visualDraft";
import { GenerateDesignDialog } from "../design/GenerateDesignDialog";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ModuleDesigns } from "../design/ModuleDesigns";
import { RequirementDesigns } from "../design/RequirementDesigns";
import { saveMockupVersion } from "../mockup/client";
import { MockupDetail } from "../mockup/MockupDetail";
import { MockupsPanel } from "../mockup/MockupsPanel";
import {
  mockupDraftReducer,
  mockupLayoutDirty,
  mockupSemanticDirty,
  needsMockupConfirm,
} from "../mockup/mockupDraft";
import { impactReport } from "../impact/client";
import { ImpactInspector } from "../impact/ImpactInspector";
import { ImpactTab } from "../impact/ImpactTab";
import { impactQueryKey, type ImpactReportDto } from "../impact/types";
import {
  STALE_NAME,
  STALE_VERSION,
  approvalsForVersion,
  currentVersion,
  normalizeCoreError,
  type ArchivePreviewDto,
  type ArtifactDto,
  type CoreStatus,
  type ModuleDto,
  type RequirementDetail,
} from "./types";

const SAVE_LABELS: Record<SaveState, string | null> = {
  idle: null,
  draft: "Borrador sin guardar (solo en memoria)",
  saving: "Guardando…",
  saved: "Guardado",
  error: "Error al guardar: el borrador se conserva",
};

type Slot = "detail" | "designDetail" | "mockupDetail" | "impact" | "archive" | "rename";

interface PendingNav {
  selection: Selection;
  showCreateForm: boolean;
  showPropose: boolean;
  /** Vista explícita (pestañas); null deriva de la selección. */
  view: CenterView | null;
  /** Qué borrador protege el diálogo: requisito, visual o mockup. */
  draft: "requirement" | "visual" | "mockup";
}

export function RequirementsWorkspace() {
  const [isNative] = useState<boolean>(() => isTauriEnvironment());
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const moduleId = useRequirementsUi((s) => s.selection.moduleId);
  const requirementId = useRequirementsUi((s) => s.selection.requirementId);
  const designId = useRequirementsUi((s) => s.selection.designId);
  const mockupId = useRequirementsUi((s) => s.selection.mockupId);
  const navigatorWidth = useRequirementsUi((s) => s.navigatorWidth);
  const centerView = useRequirementsUi((s) => s.centerView);
  const showNavigator = useRequirementsUi((s) => s.panels.navigator);
  const showReview = useRequirementsUi((s) => s.panels.review);
  const showTerminal = useRequirementsUi((s) => s.panels.terminal);
  const showAssistant = useRequirementsUi((s) => s.panels.assistant);
  const rightTab = useRequirementsUi((s) => s.rightTab);
  const rightWidth = useRequirementsUi((s) => s.rightWidth);
  const showRight = showReview || showAssistant;

  // Artefactos del módulo seleccionado, informados por el explorador
  // para las vistas centrales. La caché completa vive en el explorador.
  const [selectedArtifacts, setSelectedArtifacts] = useState<ArtifactDto[]>([]);
  // Módulos del proyecto seleccionado (mismo informe): determinan el
  // archivado por contexto de las vistas centrales.
  const [selectedModules, setSelectedModules] = useState<ModuleDto[]>([]);
  // Vínculos del módulo seleccionado (mismo informe del explorador).
  const [selectedGraph, setSelectedGraph] = useState<ModuleGraph | null>(null);
  // Diálogo «Generar diseño» con preselección de fuentes (null = cerrado).
  const [generateRequest, setGenerateRequest] = useState<{
    preselected: string[] | null;
    preselectedMockups?: string[] | null;
  } | null>(null);
  const [explorerRefresh, setExplorerRefresh] = useState(0);
  // Etiquetas y estados conocidos de detalles cargados en la sesión.
  const [artifactMeta, setArtifactMeta] = useState<Record<string, ArtifactMeta>>({});
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [designDetail, setDesignDetail] = useState<RequirementDetail | null>(null);
  const [mockupDetail, setMockupDetail] = useState<RequirementDetail | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [designDetailError, setDesignDetailError] = useState<string | null>(null);
  const [mockupDetailError, setMockupDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [designApproveError, setDesignApproveError] = useState<string | null>(null);
  const [mockupApproveError, setMockupApproveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [designDetailBusy, setDesignDetailBusy] = useState(false);
  const [mockupDetailBusy, setMockupDetailBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [designApproveBusy, setDesignApproveBusy] = useState(false);
  const [mockupApproveBusy, setMockupApproveBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  const [draft, dispatchDraft] = useReducer(draftReducer, EMPTY_DRAFT);
  // Borrador visual elevado: sobrevive a cambios de pestaña; solo se
  // reinicia al guardar, descartar o abandonar el diseño.
  const [visual, dispatchVisual] = useReducer(visualDraftReducer, null);
  const [visualSave, setVisualSave] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  // Borrador de mockup elevado con las mismas garantías que el visual.
  const [mockup, dispatchMockup] = useReducer(mockupDraftReducer, null);
  const [mockupSave, setMockupSave] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const [review, dispatchReview] = useReducer(reviewReducer, EMPTY_REVIEW);
  const [designReview, dispatchDesignReview] = useReducer(reviewReducer, EMPTY_REVIEW);
  const [mockupReview, dispatchMockupReview] = useReducer(reviewReducer, EMPTY_REVIEW);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [viewingDesignVersionId, setViewingDesignVersionId] = useState<string | null>(null);
  const [viewingMockupVersionId, setViewingMockupVersionId] = useState<string | null>(null);
  const [designValidated, setDesignValidated] = useState<{ versionId: string; ok: boolean } | null>(
    null,
  );
  const [mockupValidated, setMockupValidated] = useState<{ versionId: string; ok: boolean } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [saveAuthor, setSaveAuthor] = useState("");
  const [approver, setApprover] = useState("");
  const [designApprover, setDesignApprover] = useState("");
  const [mockupApprover, setMockupApprover] = useState("");
  const [dialog, setDialog] = useState<PendingNav | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Archivo y borrado: el resumen previo es consultivo y la ejecución
  // revalida en Rust. `archiveAfterSave` encadena el diálogo de borrador
  // (guardar/descartar/cancelar) antes de abrir el resumen.
  const [archiveRequest, setArchiveRequest] = useState<{
    target: ArchiveTarget;
    action: ArchiveAction;
  } | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewDto | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveAfterSave, setArchiveAfterSave] = useState<{
    target: ArchiveTarget;
    action: ArchiveAction;
  } | null>(null);
  const [archiveGuardKind, setArchiveGuardKind] = useState<"requirement" | "visual" | "mockup" | null>(null);
  // Renombrado: nombre organizativo o título metadato. No toca contenido,
  // versiones ni borradores; Rust revalida la revisión esperada.
  // Actualización IA automática: por módulo y por sesión, desactivada por
  // defecto. Los guardados manuales la programan; las propuestas van a
  // Impacto y nunca se aceptan solas.
  const [autoUpdate, setAutoUpdate] = useState<Record<string, boolean>>({});
  const [autoStatus, setAutoStatus] = useState<
    ({ moduleKey: string } & AutoStatus) | null
  >(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoInflight = useRef(false);
  const autoRerun = useRef(false);
  const centralSaving = useRef(false);
  const centralSaveRef = useRef<() => void>(() => {});
  const saveAllRef = useRef<() => void>(() => {});
  const saveAllBusy = useRef(false);
  const [renameRequest, setRenameRequest] = useState<RenameTarget | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [storage, setStorage] = useState<CoreStatus | null>(null);
  const storageReady = storage?.ready === true;

  // Contexto de impacto: vive aquí (no en Zustand ni en el panel) para
  // conservarlo al salir y volver a la pestaña.
  const [impactOrigin, setImpactOrigin] = useState<string | null>(null);
  const [impactFrom, setImpactFrom] = useState<string | null>(null);
  const [impactNode, setImpactNode] = useState<string | null>(null);
  const [impactReportData, setImpactReportData] = useState<ImpactReportDto | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [diffSignal, setDiffSignal] = useState(0);
  const bumpImpact = useCallback(() => setRefreshToken((t) => t + 1), []);

  // Ediciones JSON de propuestas de actualización, por generación: viven
  // aquí para que navegar (nodos, pestañas) no las pierda sin aviso.
  const [updateEdits, setUpdateEdits] = useState<Record<string, string>>({});
  const handleUpdateEdit = useCallback((generationId: string, text: string | null) => {
    setUpdateEdits((prev) => {
      if (text === null) {
        const { [generationId]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [generationId]: text };
    });
  }, []);

  // Listas centrales activas: lo archivado (propio o por contexto) se
  // filtra; sigue accesible desde el árbol con «Mostrar archivados».
  const moduleArchived =
    moduleId !== null && selectedModules.some((m) => m.id === moduleId && m.archived);
  // Auto-actualización del módulo seleccionado (vista de módulo o requisito).
  const moduleAutoKey =
    projectId !== null && moduleId !== null ? moduleKey(projectId, moduleId) : null;
  const moduleAutoEnabled = moduleAutoKey !== null && (autoUpdate[moduleAutoKey] ?? false);
  const moduleAutoStatus =
    moduleAutoKey !== null && autoStatus?.moduleKey === moduleAutoKey
      ? { message: autoStatus.message, kind: autoStatus.kind }
      : null;
  const selectedModuleName =
    moduleId === null
      ? ""
      : (selectedModules.find((m) => m.id === moduleId)?.name ?? moduleId);
  function toggleModuleAuto(enabled: boolean) {
    if (moduleAutoKey === null) return;
    setAutoUpdate((prev) => ({ ...prev, [moduleAutoKey]: enabled }));
    if (!enabled) {
      setAutoStatus((prev) => (prev?.moduleKey === moduleAutoKey ? null : prev));
    }
  }
  const requirements = selectedArtifacts.filter(
    (a) => a.kind === "requirement" && !isEffectivelyArchived(a.archived, moduleArchived),
  );
  const activeDesigns = selectedArtifacts.filter(
    (a) =>
      (a.kind === "flow" || a.kind === "data_model") &&
      !isEffectivelyArchived(a.archived, moduleArchived),
  );
  const activeMockups = selectedArtifacts.filter(
    (a) => a.kind === "mockup" && !isEffectivelyArchived(a.archived, moduleArchived),
  );
  // Datos frescos para la auto-actualización diferida (el temporizador
  // capturaría el render del guardado, anterior al rederivado).
  const autoDataRef = useRef({
    projectId,
    moduleId,
    activeDesigns,
    selectedGraph,
  });
  autoDataRef.current = { projectId, moduleId, activeDesigns, selectedGraph };
  const requirementArchived =
    detail !== null && isEffectivelyArchived(detail.artifact.archived, moduleArchived);
  const designArchived =
    designDetail !== null &&
    isEffectivelyArchived(designDetail.artifact.archived, moduleArchived);
  const mockupArchived =
    mockupDetail !== null &&
    isEffectivelyArchived(mockupDetail.artifact.archived, moduleArchived);

  const epochRef = useRef(0);
  const slotsRef = useRef<Record<Slot, { key: string; epoch: number }>>({
    detail: { key: "", epoch: 0 },
    designDetail: { key: "", epoch: 0 },
    mockupDetail: { key: "", epoch: 0 },
    impact: { key: "", epoch: 0 },
    archive: { key: "", epoch: 0 },
    rename: { key: "", epoch: 0 },
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

  const handleSelectedModuleData = useCallback(
    (modules: ModuleDto[], artifacts: ArtifactDto[]) => {
      setSelectedModules(modules);
      setSelectedArtifacts(artifacts);
    },
    [],
  );

  const handleSelectedGraph = useCallback((graph: ModuleGraph | null) => {
    setSelectedGraph(graph);
  }, []);

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

  const loadMockupDetail = useCallback(
    async (aid: string) => {
      const epoch = begin("mockupDetail", aid);
      setMockupDetailBusy(true);
      try {
        const result = await getRequirement(aid);
        if (isFresh("mockupDetail", aid, epoch)) {
          setMockupDetail(result);
          setMockupDetailError(null);
          dispatchMockupReview({ type: "reset" });
          setMockupValidated(null);
        }
      } catch (raw) {
        if (isFresh("mockupDetail", aid, epoch)) {
          setMockupDetailError(normalizeCoreError(raw).message);
        }
      } finally {
        if (isFresh("mockupDetail", aid, epoch)) setMockupDetailBusy(false);
      }
    },
    [begin, isFresh],
  );

  const loadImpact = useCallback(
    async (pid: string, origin: string, from: string | null, token: number) => {
      const key = impactQueryKey(pid, origin, from, token);
      const epoch = begin("impact", key);
      setImpactBusy(true);
      try {
        const result = await impactReport({
          projectId: pid,
          artifactId: origin,
          fromVersionId: from,
        });
        if (isFresh("impact", key, epoch)) {
          setImpactReportData(result);
          setImpactError(null);
        }
      } catch (raw) {
        if (isFresh("impact", key, epoch)) {
          setImpactError(normalizeCoreError(raw).message);
        }
      } finally {
        if (isFresh("impact", key, epoch)) setImpactBusy(false);
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
      } catch (raw) {
        if (cancelled) return;
        setStorage({ ready: false, message: normalizeCoreError(raw).message, dbPath: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative]);

  // El explorador carga proyectos, módulos y artefactos bajo demanda; aquí
  // solo se aprenden etiquetas y estados de los detalles abiertos.
  useEffect(() => {
    if (detail === null) return;
    const current = currentVersion(detail);
    if (current === undefined) return;
    const label = firstLine(current.content);
    const approved = approvalsForVersion(detail, current.id).length > 0;
    setArtifactMeta((prev) => {
      const known = prev[detail.artifact.id];
      if (known?.label === label && known.approved === approved) return prev;
      return { ...prev, [detail.artifact.id]: { label: label === "" ? detail.artifact.id : label, approved } };
    });
  }, [detail]);

  useEffect(() => {
    if (designDetail === null) return;
    const current = currentVersion(designDetail);
    if (current === undefined) return;
    const approved = approvalsForVersion(designDetail, current.id).length > 0;
    setArtifactMeta((prev) => {
      const known = prev[designDetail.artifact.id];
      if (known?.label === designDetail.artifact.id && known.approved === approved) return prev;
      return { ...prev, [designDetail.artifact.id]: { label: designDetail.artifact.id, approved } };
    });
  }, [designDetail]);

  useEffect(() => {
    if (mockupDetail === null) return;
    const current = currentVersion(mockupDetail);
    if (current === undefined) return;
    const approved = approvalsForVersion(mockupDetail, current.id).length > 0;
    setArtifactMeta((prev) => {
      const known = prev[mockupDetail.artifact.id];
      if (known?.label === mockupDetail.artifact.id && known.approved === approved) return prev;
      return { ...prev, [mockupDetail.artifact.id]: { label: mockupDetail.artifact.id, approved } };
    });
  }, [mockupDetail]);

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

  useEffect(() => {
    if (!storageReady) return;
    if (mockupId === null) {
      setMockupDetail(null);
      return;
    }
    void loadMockupDetail(mockupId);
  }, [storageReady, mockupId, loadMockupDetail]);

  // Cambiar de proyecto/módulo reinicia el contexto de impacto.
  useEffect(() => {
    setImpactOrigin(null);
    setImpactFrom(null);
    setImpactNode(null);
    setImpactReportData(null);
    setImpactError(null);
  }, [projectId, moduleId]);

  // El requisito seleccionado es el origen inicial del análisis. Al cambiar
  // de requisito la comparación anterior deja de ser compatible (las
  // versiones pertenecen a su artefacto) y se reinicia; mientras el origen
  // no cambia, la comparación elegida se conserva.
  useEffect(() => {
    if (requirementId === null) return;
    setImpactOrigin(requirementId);
    setImpactFrom(null);
    setImpactNode(null);
  }, [requirementId]);

  // Origen por defecto al entrar: el requisito seleccionado, si es del
  // módulo; si no, el primero. Solo cuando aún no hay origen elegido.
  useEffect(() => {
    if (centerView !== "impact" || impactOrigin !== null) return;
    const fallback =
      requirementId !== null && requirements.some((r) => r.id === requirementId)
        ? requirementId
        : (requirements[0]?.id ?? null);
    if (fallback !== null) setImpactOrigin(fallback);
  }, [centerView, impactOrigin, requirementId, requirements]);

  useEffect(() => {
    if (!storageReady || centerView !== "impact") return;
    if (projectId === null || impactOrigin === null) return;
    void loadImpact(projectId, impactOrigin, impactFrom, refreshToken);
  }, [storageReady, centerView, projectId, impactOrigin, impactFrom, refreshToken, loadImpact]);

  // La selección que ya no está en el informe se limpia sola.
  useEffect(() => {
    if (impactReportData === null || impactNode === null) return;
    const known =
      impactNode === impactReportData.origin.artifact.id ||
      impactReportData.affected.some((a) => a.artifact.id === impactNode);
    if (!known) setImpactNode(null);
  }, [impactReportData, impactNode]);

  // Guardar central: Ctrl+S (siempre evita el diálogo del WebView, incluso
  // dentro de diálogos donde no dirige a ningún editor) y botón de
  // cabecera vía `saveSignal`. La ref evita resuscribir por render.
  centralSaveRef.current = () => void centralSave();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const target = event.target as HTMLElement | null;
        if (target !== null && typeof target.closest === "function") {
          // Diálogos: no dirige a ningún editor. Terminal: la tecla es del
          // PTY (XOFF/XON) y jamás dispara el Guardar del editor.
          if (target.closest('[role="dialog"]') !== null) return;
          if (target.closest(".terminal-panel") !== null) return;
        }
        centralSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const saveSignal = useRequirementsUi((s) => s.saveSignal);
  useEffect(() => {
    if (saveSignal === 0) return;
    centralSaveRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSignal]);
  // Guardar-todo (puerta de exportación): ref para no re-suscribir.
  saveAllRef.current = () => void runSaveAll();
  const saveAllSignal = useRequirementsUi((s) => s.saveAllSignal);
  useEffect(() => {
    if (saveAllSignal === 0) return;
    saveAllRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAllSignal]);
  // Estado por documento para el encabezado: se publica solo si cambió.
  useEffect(() => {
    const ui = useRequirementsUi.getState();
    const next: Record<string, DocSaveState> = {};
    if (requirementId !== null) {
      const title =
        detail !== null && detail.artifact.id === requirementId
          ? (detail.artifact.title ?? firstLine(currentVersion(detail)?.content ?? "") ?? requirementId)
          : requirementId;
      next[docKey("req", requirementId)] = {
        label: `requisito ${title}`,
        dirty: draft.dirty,
        saving: saveBusy,
        error: saveError,
      };
    }
    if (designId !== null) {
      const semantic = visualSemanticDirty(visual);
      const layout = visualLayoutDirty(visual);
      const title =
        designDetail !== null && designDetail.artifact.id === designId
          ? (designDetail.artifact.title ?? designId)
          : designId;
      next[docKey("design", designId)] = {
        label: `diseño ${title}${!semantic && layout ? " (solo disposición)" : ""}`,
        dirty: semantic || layout,
        saving: visualSave.busy,
        error: visualSave.error,
      };
    }
    if (mockupId !== null) {
      const semantic = mockupSemanticDirty(mockup);
      const layout = mockupLayoutDirty(mockup);
      const title =
        mockupDetail !== null && mockupDetail.artifact.id === mockupId
          ? (mockupDetail.artifact.title ?? mockupId)
          : mockupId;
      next[docKey("mockup", mockupId)] = {
        label: `mockup ${title}${!semantic && layout ? " (solo disposición)" : ""}`,
        dirty: semantic || layout,
        saving: mockupSave.busy,
        error: mockupSave.error,
      };
    }
    if (JSON.stringify(ui.docStatus) !== JSON.stringify(next)) {
      ui.setDocStatus(next);
    }
  });
  useEffect(() => {
    return () => {
      if (autoTimer.current !== null) clearTimeout(autoTimer.current);
    };
  }, []);

  const applySelection = useCallback(
    (target: Selection, showCreateForm: boolean, showPropose = false, view: CenterView | null = null) => {
      const ui = useRequirementsUi.getState();
      const current = ui.selection;
      ui.setSelection(target);
      // Elegir artefacto cambia de vista; elegir proyecto/módulo la conserva.
      // Los modos de creación siempre se muestran en Requisitos.
      const derived: CenterView =
        view ?? (showCreateForm || showPropose ? "requirements" : ui.centerView);
      ui.setCenterView(derived);
      // Solo se reinicia lo del artefacto que cambió: el borrador del
      // requisito sobrevive al navegar entre diseños y viceversa.
      if (target.requirementId !== current.requirementId) {
        dispatchDraft({ type: "select", requirementId: target.requirementId });
        dispatchReview({ type: "reset" });
        setViewingVersionId(null);
      }
      if (target.designId !== current.designId) {
        dispatchDesignReview({ type: "reset" });
        setViewingDesignVersionId(null);
        setDesignValidated(null);
        // Al abandonar el diseño, su borrador visual ya se guardó o se
        // descartó en el diálogo: aquí solo se limpia el estado.
        dispatchVisual({ type: "reset" });
        setVisualSave({ busy: false, error: null });
      }
      if (target.mockupId !== current.mockupId) {
        dispatchMockupReview({ type: "reset" });
        setViewingMockupVersionId(null);
        setMockupValidated(null);
        dispatchMockup({ type: "reset" });
        setMockupSave({ busy: false, error: null });
      }
      setCreating(showCreateForm);
      setProposing(showPropose);
      setSaveError(null);
      setApproveError(null);
      setDesignApproveError(null);
      setMockupApproveError(null);
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
        setDialog({ selection: target, showCreateForm, showPropose, view, draft: "requirement" });
        return;
      }
      if (needsVisualConfirm(visual, designId, target.designId)) {
        setDialogError(null);
        setDialog({ selection: target, showCreateForm, showPropose, view, draft: "visual" });
        return;
      }
      if (needsMockupConfirm(mockup, mockupId, target.mockupId)) {
        setDialogError(null);
        setDialog({ selection: target, showCreateForm, showPropose, view, draft: "mockup" });
        return;
      }
      applySelection(target, showCreateForm, showPropose, view);
    },
    [applySelection, draft.dirty, requirementId, visual, designId, mockup, mockupId],
  );

  // Un error de guardado visual se limpia al retomar la edición del
  // borrador (especificación o fijaciones), no al mover el lienzo.
  const visualPresent = visual?.history.present;
  const visualPinsKey = visual === null ? "" : visual.pins.join(",");
  useEffect(() => {
    setVisualSave((prev) => (prev.error === null ? prev : { ...prev, error: null }));
  }, [visualPresent, visualPinsKey]);

  // Igual para el mockup: el error se limpia al retomar la edición.
  const mockupPresent = mockup?.history.present;
  const mockupPinsKey = mockup === null ? "" : mockup.pins.join(",");
  useEffect(() => {
    setMockupSave((prev) => (prev.error === null ? prev : { ...prev, error: null }));
  }, [mockupPresent, mockupPinsKey]);

  function requestTab(view: CenterView) {
    if (view === centerView || projectId === null || moduleId === null) return;
    // Cambio puro de perspectiva: nunca toca requisito, módulo ni borradores,
    // así que no necesita diálogo. Solo se abandonan los modos de creación
    // al salir de Requisitos (su formulario se desmonta igualmente).
    useRequirementsUi.getState().setCenterView(view);
    if (view !== "requirements") {
      setCreating(false);
      setProposing(false);
    }
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
      a.designId === b.designId &&
      a.mockupId === b.mockupId
    );
  }, []);

  async function handleCreateProject() {
    const before = selectionSnapshot();
    setNavBusy(true);
    setNavError(null);
    try {
      const created = await createProject();
      setExplorerRefresh((t) => t + 1);
      if (sameSelection(before, selectionSnapshot())) {
        applySelection(
          { projectId: created.id, moduleId: null, requirementId: null, designId: null, mockupId: null },
          false,
        );
      }
    } catch (raw) {
      setNavError(normalizeCoreError(raw).message);
    } finally {
      setNavBusy(false);
    }
  }

  async function handleCreateModule(pid: string) {
    const before = selectionSnapshot();
    setNavBusy(true);
    setNavError(null);
    try {
      const created = await createModule(pid);
      setExplorerRefresh((t) => t + 1);
      const now = selectionSnapshot();
      if (sameSelection(before, now) && now.projectId === pid) {
        applySelection(
          { projectId: pid, moduleId: created.id, requirementId: null, designId: null, mockupId: null },
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
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
      const now = selectionSnapshot();
      if (sameSelection(before, now) && now.moduleId === moduleId) {
        begin("detail", created.artifact.id);
        setDetail(created);
        setDetailError(null);
        applySelection(
          withRequirement(selectionSnapshot(), projectId, moduleId, created.artifact.id),
          false,
        );
        const current = currentVersion(created);
        if (current) {
          // La selección ya reenvió `select` (limpio): basta adoptar.
          dispatchDraft({ type: "snapshot", requirementId: created.artifact.id, content: current.content });
        }
      }
    } catch (raw) {
      setCreateError(normalizeCoreError(raw).message);
    } finally {
      setCreateBusy(false);
    }
  }

  function archiveKey(target: ArchiveTarget, action: ArchiveAction): string {
    const id = target.kind === "module" ? target.moduleId : target.artifactId;
    return `${target.projectId}/${target.kind}/${id}/${action}`;
  }

  function requestArchive(target: ArchiveTarget, action: ArchiveAction) {
    // Una cosa tras otra: primero se resuelve la navegación pendiente.
    if (dialog !== null || archiveAfterSave !== null) return;
    const guard = archiveDraftGuard({
      target,
      selection: selectionSnapshot(),
      requirementDirty: draft.dirty,
      visualDirty: visualSemanticDirty(visual) || visualLayoutDirty(visual),
      mockupDirty: mockupSemanticDirty(mockup) || mockupLayoutDirty(mockup),
    });
    if (guard !== null) {
      setArchiveError(null);
      setArchiveAfterSave({ target, action });
      setArchiveGuardKind(guard);
      return;
    }
    void openArchive({ target, action });
  }

  async function openArchive(request: { target: ArchiveTarget; action: ArchiveAction }) {
    setArchiveRequest(request);
    setArchivePreview(null);
    setArchiveError(null);
    const key = archiveKey(request.target, request.action);
    const epoch = begin("archive", key);
    setArchiveLoading(true);
    try {
      const preview = await fetchArchivePreview({
        projectId: request.target.projectId,
        kind: request.target.kind,
        id: request.target.kind === "module" ? request.target.moduleId : request.target.artifactId,
      });
      if (!isFresh("archive", key, epoch)) return;
      setArchivePreview(preview);
    } catch (raw) {
      if (!isFresh("archive", key, epoch)) return;
      setArchiveError(normalizeCoreError(raw).message);
    } finally {
      if (isFresh("archive", key, epoch)) setArchiveLoading(false);
    }
  }

  function closeArchive() {
    // Cerrar invalida las respuestas en vuelo: una tardía no toca nada.
    begin("archive", "");
    setArchiveRequest(null);
    setArchivePreview(null);
    setArchiveError(null);
  }

  function requestRename(target: RenameTarget) {
    // Renombrar no toca borradores ni contenido: abre directo, sin guardias.
    setRenameError(null);
    setRenameRequest(target);
  }

  /** Objetivo desde el detalle abierto (título real, nunca etiqueta). */
  function requestRenameDetail(kind: "requirement" | "design" | "mockup") {
    const current = kind === "requirement" ? detail : kind === "mockup" ? mockupDetail : designDetail;
    if (current === null || projectId === null || moduleId === null) return;
    const title = current.artifact.title;
    const version = kind === "requirement" ? currentVersion(current) : undefined;
    const derived =
      title === null && version !== undefined ? firstLine(version.content) || null : null;
    requestRename({
      // El comando de diagramas admite mockups; la presentación ya dijo «mockup».
      kind: kind === "mockup" ? "design" : kind,
      projectId,
      moduleId,
      artifactId: current.artifact.id,
      current: title ?? "",
      expected: title,
      derived,
    });
  }

  function closeRename() {
    // Cerrar invalida la respuesta en vuelo: una tardía no toca nada.
    begin("rename", "");
    setRenameRequest(null);
    setRenameError(null);
  }

  async function performRename(name: string, author: string) {
    if (renameRequest === null) return;
    const target = renameRequest;
    const key = `${target.kind}:${renameTargetId(target)}`;
    const epoch = begin("rename", key);
    setRenameBusy(true);
    setRenameError(null);
    try {
      let updated: RequirementDetail | null = null;
      if (target.kind === "project") {
        await renameProject({ projectId: target.projectId, expectedName: target.expected, name });
      } else if (target.kind === "module") {
        await renameModule({
          projectId: target.projectId,
          moduleId: target.moduleId,
          expectedName: target.expected,
          name,
        });
      } else if (target.kind === "requirement") {
        updated = await renameRequirement({
          projectId: target.projectId,
          artifactId: target.artifactId,
          expectedTitle: target.expected,
          title: name,
          by: author,
        });
      } else {
        updated = await renameDesign({
          projectId: target.projectId,
          artifactId: target.artifactId,
          expectedTitle: target.expected,
          title: name,
          by: author,
        });
      }
      if (!isFresh("rename", key, epoch)) return;
      // Éxito confirmado: refrescar el árbol y el detalle visible. El
      // borrador de contenido queda intacto (el título no es contenido) y
      // no hay impacto que recalcular (semántica intacta).
      setExplorerRefresh((t) => t + 1);
      if (updated !== null) {
        if (detail?.artifact.id === updated.artifact.id) setDetail(updated);
        if (designDetail?.artifact.id === updated.artifact.id) setDesignDetail(updated);
        if (mockupDetail?.artifact.id === updated.artifact.id) setMockupDetail(updated);
      }
      setRenameRequest(null);
    } catch (raw) {
      if (!isFresh("rename", key, epoch)) return;
      // Fallo: el diálogo conserva el nombre anterior y permite reintentar.
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_NAME) {
        // El nombre vigente cambió fuera: refrescar para que al reabrir el
        // diálogo el `expected` sea fresco, y pedir reintento explícito.
        setExplorerRefresh((t) => t + 1);
        setRenameError(`${err.message} Cierra y vuelve a abrir para ver el nombre vigente.`);
      } else {
        setRenameError(err.message);
      }
    } finally {
      if (isFresh("rename", key, epoch)) setRenameBusy(false);
    }
  }

  /**
   * Guardar central (Ctrl+S o botón de cabecera): dirige al editor activo
   * —requisito, diseño o mockup— por el flujo transaccional existente.
   * Sin cambios no guarda (nunca versiones idénticas); un fallo conserva
   * el borrador y muestra el error en su editor. Solo los guardados
   * manuales programan la auto-actualización (nunca una propuesta).
   */
  async function centralSave() {
    if (centralSaving.current || saveBusy || visualSave.busy || mockupSave.busy) return;
    if (!isNative) {
      useRequirementsUi.getState().setLastSave({
        message: "Guardar requiere la aplicación de escritorio.",
        kind: "info",
        at: Date.now(),
      });
      return;
    }
    const designCurrent =
      designDetail === null ? undefined : currentVersion(designDetail);
    const mockupCurrent =
      mockupDetail === null ? undefined : currentVersion(mockupDetail);
    const target = resolveSaveTarget({
      centerView,
      requirementId,
      designId,
      mockupId,
      requirementDirty: draft.dirty,
      designDirty: visual === null ? false : visualSemanticDirty(visual),
      designKeyOk:
        visual !== null &&
        designDetail !== null &&
        designCurrent !== undefined &&
        visual.key === `${designDetail.artifact.id}:${designCurrent.id}`,
      mockupDirty: mockup === null ? false : mockupSemanticDirty(mockup),
      mockupKeyOk:
        mockup !== null &&
        mockupDetail !== null &&
        mockupCurrent !== undefined &&
        mockup.key === `${mockupDetail.artifact.id}:${mockupCurrent.id}`,
    });
    if (target === null) {
      useRequirementsUi.getState().setLastSave({
        message: "Sin cambios que guardar.",
        kind: "info",
        at: Date.now(),
      });
      return;
    }
    centralSaving.current = true;
    try {
      if (target === "requirement") {
        const ok = await performSave();
        const saved = detail === null ? undefined : currentVersion(detail);
        useRequirementsUi.getState().setLastSave(
          ok
            ? {
                message: `Requisito guardado${saved ? ` (v${saved.number})` : ""}.`,
                kind: "ok",
                at: Date.now(),
              }
            : {
                message: "No se pudo guardar el requisito: revisa el error.",
                kind: "error",
                at: Date.now(),
              },
        );
        if (ok && projectId !== null && moduleId !== null) {
          scheduleAuto(moduleKey(projectId, moduleId));
        }
      } else if (target === "design") {
        if (saveAuthor.trim() === "") {
          setVisualSave({
            busy: false,
            error: "Indica la autoría para guardar el diseño.",
          });
          useRequirementsUi.getState().setLastSave({
            message: "Falta la autoría para guardar el diseño.",
            kind: "error",
            at: Date.now(),
          });
          return;
        }
        const ok = await performVisualSave(saveAuthor.trim());
        const saved = designDetail === null ? undefined : currentVersion(designDetail);
        useRequirementsUi.getState().setLastSave(
          ok
            ? {
                message: `Diseño guardado${saved ? ` (v${saved.number})` : ""}.`,
                kind: "ok",
                at: Date.now(),
              }
            : {
                message: "No se pudo guardar el diseño: revisa el error.",
                kind: "error",
                at: Date.now(),
              },
        );
        if (ok && projectId !== null && moduleId !== null) {
          scheduleAuto(moduleKey(projectId, moduleId));
        }
      } else if (target === "mockup") {
        if (saveAuthor.trim() === "") {
          setMockupSave({
            busy: false,
            error: "Indica la autoría para guardar el mockup.",
          });
          useRequirementsUi.getState().setLastSave({
            message: "Falta la autoría para guardar el mockup.",
            kind: "error",
            at: Date.now(),
          });
          return;
        }
        const ok = await performMockupSave(saveAuthor.trim());
        const saved = mockupDetail === null ? undefined : currentVersion(mockupDetail);
        useRequirementsUi.getState().setLastSave(
          ok
            ? {
                message: `Mockup guardado${saved ? ` (v${saved.number})` : ""}.`,
                kind: "ok",
                at: Date.now(),
              }
            : {
                message: "No se pudo guardar el mockup: revisa el error.",
                kind: "error",
                at: Date.now(),
              },
        );
      }
    } finally {
      centralSaving.current = false;
    }
  }

  /**
   * Guardar-todo (puerta de exportación): guarda en secuencia cada
   * documento con borrador, por sus flujos transaccionales. Informa con
   * `resolveSaveAll`; un fallo no descarta nada y deja su error en el
   * documento. Nunca inventa autoría: si falta, lo dice.
   */
  async function runSaveAll(): Promise<void> {
    const ui = useRequirementsUi.getState();
    if (saveAllBusy.current) return;
    saveAllBusy.current = true;
    try {
      const failures: string[] = [];
      if (requirementId !== null && draft.dirty) {
        const ok = await performSave();
        if (!ok) failures.push(useRequirementsUi.getState().docStatus[docKey("req", requirementId)]?.label ?? "requisito");
      }
      const designDirty = visual === null ? false : visualSemanticDirty(visual) || visualLayoutDirty(visual);
      if (designId !== null && designDirty) {
        if (saveAuthor.trim() === "") {
          setVisualSave({ busy: false, error: "Indica la autoría para guardar el diseño." });
          failures.push("diseño (falta autoría)");
        } else {
          const semantic = visual === null ? false : visualSemanticDirty(visual);
          const ok = semantic
            ? await performVisualSave(saveAuthor.trim())
            : await performVisualLayoutSave();
          if (!ok) failures.push("diseño");
        }
      }
      const mockupDirty = mockup === null ? false : mockupSemanticDirty(mockup) || mockupLayoutDirty(mockup);
      if (mockupId !== null && mockupDirty) {
        if (saveAuthor.trim() === "") {
          setMockupSave({ busy: false, error: "Indica la autoría para guardar el mockup." });
          failures.push("mockup (falta autoría)");
        } else {
          const semantic = mockup === null ? false : mockupSemanticDirty(mockup);
          const ok = semantic
            ? await performMockupSave(saveAuthor.trim())
            : await performMockupLayoutSave();
          if (!ok) failures.push("mockup");
        }
      }
      ui.resolveSaveAll(
        failures.length === 0
          ? { ok: true, message: "Todo guardado.", at: Date.now() }
          : { ok: false, message: `No se pudo guardar: ${failures.join(", ")}.`, at: Date.now() },
      );
    } finally {
      saveAllBusy.current = false;
    }
  }

  /**
   * Programa la auto-actualización del módulo tras un guardado manual.
   * Agrupa guardados consecutivos: cada nuevo programa sustituye al
   * anterior y solo el último pendiente sobrevive.
   */
  function scheduleAuto(key: string) {
    if (!autoUpdate[key]) return;
    if (autoTimer.current !== null) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      void runAuto(key);
    }, 2500);
  }

  /**
   * Ejecuta la auto-actualización: propone actualizar (de una en una,
   * máximo 5 por ciclo) los diseños desactualizados del módulo, desde
   * versiones ya persistidas. Los resultados van a propuestas separadas;
   * si falla, el guardado sigue siendo exitoso. Sin recursión: aceptar
   * o proponer nunca programa otra ejecución.
   */
  async function runAuto(key: string) {
    // Una ejecución simultánea por módulo: lo nuevo se fusiona en un
    // único reintento posterior, nunca en una cola infinita.
    if (autoInflight.current) {
      autoRerun.current = true;
      return;
    }
    // Si la persona cambió de módulo, la pendiente se descarta: los datos
    // visibles ya no son los del guardado que la programó.
    const data = autoDataRef.current;
    if (
      data.projectId === null ||
      data.moduleId === null ||
      moduleKey(data.projectId, data.moduleId) !== key
    ) {
      return;
    }
    autoInflight.current = true;
    setAutoStatus({ moduleKey: key, message: "Buscando diseños desactualizados…", kind: "working" });
    try {
      const stale = data.activeDesigns.filter(
        (a) =>
          (a.kind === "flow" || a.kind === "data_model") &&
          data.selectedGraph?.index?.freshness[a.id]?.stale === true,
      );
      if (stale.length === 0) {
        setAutoStatus({ moduleKey: key, message: "Todo al día: nada que proponer.", kind: "ok" });
        return;
      }
      const batch = stale.slice(0, 5);
      let tokens = 0;
      let tokensKnown = false;
      let done = 0;
      let failed = 0;
      for (const target of batch) {
        try {
          const generation = await proposeDesignUpdate({
            projectId: data.projectId,
            artifactId: target.id,
          });
          const total =
            generation.usage.totalTokens ??
            (generation.usage.inputTokens ?? 0) + (generation.usage.outputTokens ?? 0);
          if (
            generation.usage.totalTokens !== null &&
            generation.usage.totalTokens !== undefined
          ) {
            tokensKnown = true;
          }
          tokens += total;
          done += 1;
        } catch {
          failed += 1;
        }
      }
      const extra = stale.length > batch.length ? ` (+${stale.length - batch.length} pendientes)` : "";
      const tokensText = tokensKnown ? ` · ${tokens} tokens` : "";
      if (failed === 0) {
        setAutoStatus({
          moduleKey: key,
          message: `Auto-IA: ${done} propuesta${done === 1 ? "" : "s"} lista${done === 1 ? "" : "s"} en Impacto${extra}${tokensText}.`,
          kind: "ok",
        });
      } else {
        setAutoStatus({
          moduleKey: key,
          message: `Auto-IA: ${done} listas, ${failed} fallidas${extra}. El guardado está a salvo.`,
          kind: "error",
        });
      }
      bumpImpact();
    } finally {
      autoInflight.current = false;
      if (autoRerun.current) {
        autoRerun.current = false;
        void runAuto(key);
      }
    }
  }

  async function performArchive() {
    if (archiveRequest === null) return;
    const { target, action } = archiveRequest;
    const key = archiveKey(target, action);
    const epoch = begin("archive", key);
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      let updated: RequirementDetail | null = null;
      if (target.kind === "module") {
        if (action === "archive") {
          await archiveModule({ projectId: target.projectId, moduleId: target.moduleId });
        } else if (action === "restore") {
          await restoreModule({ projectId: target.projectId, moduleId: target.moduleId });
        } else {
          await deleteModule({ projectId: target.projectId, moduleId: target.moduleId });
        }
      } else if (action === "archive") {
        updated = await archiveRequirement({
          projectId: target.projectId,
          artifactId: target.artifactId,
        });
      } else if (action === "restore") {
        updated = await restoreRequirement({
          projectId: target.projectId,
          artifactId: target.artifactId,
        });
      } else {
        await deleteRequirement({ projectId: target.projectId, artifactId: target.artifactId });
      }
      if (!isFresh("archive", key, epoch)) return;
      // Éxito confirmado: refrescar, limpiar lo incompatible y cerrar.
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
      if (updated !== null && detail?.artifact.id === updated.artifact.id) {
        setDetail(updated);
      }
      if (action === "delete") {
        applySelection(selectionAfterDelete(selectionSnapshot(), target), false, false, null);
        // El origen de impacto puede haber desaparecido con el requisito.
        if (target.kind === "requirement" && impactOrigin === target.artifactId) {
          setImpactOrigin(null);
          setImpactFrom(null);
          setImpactNode(null);
          setImpactReportData(null);
        }
      }
      setArchiveRequest(null);
      setArchivePreview(null);
    } catch (raw) {
      if (!isFresh("archive", key, epoch)) return;
      // Fallo: el diálogo conserva el resumen; selección y borradores intactos.
      setArchiveError(normalizeCoreError(raw).message);
    } finally {
      if (isFresh("archive", key, epoch)) setArchiveBusy(false);
    }
  }

  async function handleArchiveDialogSave() {
    if (archiveAfterSave === null || archiveGuardKind === null) return;
    if (archiveGuardKind === "visual") {
      if (visualSemanticDirty(visual)) {
        if (saveAuthor.trim() === "") {
          setArchiveError("Indica la autoría para guardar la versión.");
          return;
        }
        const ok = await performVisualSave(saveAuthor.trim());
        if (!ok) return;
      } else {
        const ok = await performVisualLayoutSave();
        if (!ok) return;
      }
    } else if (archiveGuardKind === "mockup") {
      if (mockupSemanticDirty(mockup)) {
        if (saveAuthor.trim() === "") {
          setArchiveError("Indica la autoría para guardar la versión.");
          return;
        }
        const ok = await performMockupSave(saveAuthor.trim());
        if (!ok) return;
      } else {
        const ok = await performMockupLayoutSave();
        if (!ok) return;
      }
    } else {
      if (saveAuthor.trim() === "") {
        setArchiveError("Indica la autoría para guardar la versión.");
        return;
      }
      const ok = await performSave();
      if (!ok) return;
    }
    proceedAfterArchiveSave();
  }

  // Como en la navegación: tras el requisito, el visual aún puede pedir
  // turno, y tras el visual, el mockup.
  function proceedAfterArchiveSave() {
    const next = archiveAfterSave;
    if (next === null || archiveGuardKind === null) return;
    if (
      archiveGuardKind === "requirement" &&
      next.target.kind === "module" &&
      designId !== null &&
      (visualSemanticDirty(visual) || visualLayoutDirty(visual))
    ) {
      setArchiveGuardKind("visual");
      setArchiveError(null);
      return;
    }
    if (
      (archiveGuardKind === "requirement" || archiveGuardKind === "visual") &&
      next.target.kind === "module" &&
      mockupId !== null &&
      (mockupSemanticDirty(mockup) || mockupLayoutDirty(mockup))
    ) {
      setArchiveGuardKind("mockup");
      setArchiveError(null);
      return;
    }
    setArchiveAfterSave(null);
    setArchiveGuardKind(null);
    setArchiveError(null);
    void openArchive(next);
  }

  function handleArchiveDialogDiscard() {
    if (archiveAfterSave === null || archiveGuardKind === null) return;
    if (archiveGuardKind === "visual") {
      dispatchVisual({ type: "reset" });
      setVisualSave({ busy: false, error: null });
    } else if (archiveGuardKind === "mockup") {
      dispatchMockup({ type: "reset" });
      setMockupSave({ busy: false, error: null });
    } else if (detail !== null) {
      // Descartar sin cambiar de selección: resincronizar con el detalle.
      const current = currentVersion(detail);
      dispatchDraft({
        type: "discard",
        requirementId: detail.artifact.id,
        content: current ? current.content : "",
      });
      dispatchReview({ type: "reset" });
      setViewingVersionId(null);
    }
    proceedAfterArchiveSave();
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
        rev: draft.rev,
      });
      dispatchReview({ type: "reset" });
      setViewingVersionId(null);
      // Nueva versión: los vínculos y la vigencia se rederivan.
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
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
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
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

  /** Presentación del diálogo de cambios según el borrador protegido. */
  function dialogSubjectId(pending: PendingNav): string | null {
    if (pending.draft === "visual") return designId;
    if (pending.draft === "mockup") return mockupId;
    return requirementId;
  }

  function dialogSubjectLabel(pending: PendingNav): string {
    if (pending.draft === "visual") return `diseño ${designId}`;
    if (pending.draft === "mockup") return `mockup ${mockupId}`;
    return `requisito ${requirementId}`;
  }

  function dialogLayoutOnly(pending: PendingNav): boolean {
    if (pending.draft === "visual") return !visualSemanticDirty(visual);
    if (pending.draft === "mockup") return !mockupSemanticDirty(mockup);
    return false;
  }

  function dialogBusy(pending: PendingNav): boolean {
    if (pending.draft === "visual") return visualSave.busy;
    if (pending.draft === "mockup") return mockupSave.busy;
    return saveBusy;
  }

  function dialogSaveError(pending: PendingNav): string | null {
    if (pending.draft === "visual") return visualSave.error;
    if (pending.draft === "mockup") return mockupSave.error;
    return saveError;
  }

  function archiveSubjectId(kind: "requirement" | "visual" | "mockup"): string | null {
    if (kind === "visual") return designId;
    if (kind === "mockup") return mockupId;
    return requirementId;
  }

  function archiveSubjectLabel(kind: "requirement" | "visual" | "mockup"): string {
    if (kind === "visual") return `diseño ${designId}`;
    if (kind === "mockup") return `mockup ${mockupId}`;
    return `requisito ${requirementId}`;
  }

  async function handleDialogSave() {
    if (dialog === null) return;
    if (dialog.draft === "visual") {
      await handleVisualDialogSave();
      return;
    }
    if (dialog.draft === "mockup") {
      await handleMockupDialogSave();
      return;
    }
    if (saveAuthor.trim() === "") {
      setDialogError("Indica la autoría para guardar la versión.");
      return;
    }
    const ok = await performSave();
    if (ok) proceedAfterDialog(dialog);
  }

  function handleDialogDiscard() {
    if (dialog === null) return;
    if (dialog.draft === "visual") {
      dispatchVisual({ type: "reset" });
      setVisualSave({ busy: false, error: null });
      proceedAfterDialog({ ...dialog, draft: "visual" });
      return;
    }
    if (dialog.draft === "mockup") {
      dispatchMockup({ type: "reset" });
      setMockupSave({ busy: false, error: null });
      applySelection(dialog.selection, dialog.showCreateForm, dialog.showPropose, dialog.view);
      return;
    }
    proceedAfterDialog(dialog);
  }

  // Tras resolver el requisito, el borrador visual aún puede pedir turno, y
  // tras el visual, el mockup: nunca se abandona un diseño con cambios sin
  // ofrecer guardarlos.
  function proceedAfterDialog(resolved: PendingNav) {
    if (
      resolved.draft === "requirement" &&
      needsVisualConfirm(visual, designId, resolved.selection.designId)
    ) {
      setDialogError(null);
      setDialog({ ...resolved, draft: "visual" });
      return;
    }
    if (
      (resolved.draft === "requirement" || resolved.draft === "visual") &&
      needsMockupConfirm(mockup, mockupId, resolved.selection.mockupId)
    ) {
      setDialogError(null);
      setDialog({ ...resolved, draft: "mockup" });
      return;
    }
    applySelection(resolved.selection, resolved.showCreateForm, resolved.showPropose, resolved.view);
  }

  async function handleVisualDialogSave() {
    if (dialog === null || dialog.draft !== "visual") return;
    if (visualSemanticDirty(visual)) {
      if (saveAuthor.trim() === "") {
        setDialogError("Indica la autoría para guardar la versión.");
        return;
      }
      const ok = await performVisualSave(saveAuthor.trim());
      if (ok) {
        proceedAfterDialog(dialog);
      }
      return;
    }
    const ok = await performVisualLayoutSave();
    if (ok) proceedAfterDialog(dialog);
  }

  async function handleMockupDialogSave() {
    if (dialog === null || dialog.draft !== "mockup") return;
    if (mockupSemanticDirty(mockup)) {
      if (saveAuthor.trim() === "") {
        setDialogError("Indica la autoría para guardar la versión.");
        return;
      }
      const ok = await performMockupSave(saveAuthor.trim());
      if (ok) {
        applySelection(dialog.selection, dialog.showCreateForm, dialog.showPropose, dialog.view);
      }
      return;
    }
    const ok = await performMockupLayoutSave();
    if (ok) applySelection(dialog.selection, dialog.showCreateForm, dialog.showPropose, dialog.view);
  }

  async function performVisualSave(author: string): Promise<boolean> {
    if (designDetail === null || projectId === null || visual === null) return false;
    const current = currentVersion(designDetail);
    if (current === undefined) return false;
    // Separado (la actual avanzó bajo el borrador): decide el panel de
    // conflicto del editor, no un guardado a ciegas.
    if (visual.key !== `${designDetail.artifact.id}:${current.id}`) return false;
    if (!visualSemanticDirty(visual)) return false;
    let spec: unknown;
    try {
      spec = JSON.parse(visual.history.present) as unknown;
    } catch {
      setVisualSave({ busy: false, error: "El borrador no es JSON válido." });
      return false;
    }
    setVisualSave({ busy: true, error: null });
    const sentPresent = visual.history.present;
    const sentPins = visual.pins;
    const sentAllowed = visual.allowed;
    try {
      const saved = await saveDesignVersion({
        projectId,
        artifactId: designDetail.artifact.id,
        expectedVersionId: current.id,
        author,
        spec,
        sourceVersionIds: visual.pins,
        layout: visual.layout,
      });
      begin("designDetail", saved.artifact.id);
      setDesignDetail(saved);
      // Solo limpia si nada se editó durante la petición (si se editó,
      // el borrador se conserva y el detalle avanzado lo marca separado).
      dispatchVisual({ type: "saved", present: sentPresent, pins: sentPins, allowed: sentAllowed });
      dispatchDesignReview({ type: "reset" });
      setViewingDesignVersionId(null);
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
      setVisualSave({ busy: false, error: null });
      return true;
    } catch (raw) {
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_VERSION) {
        setVisualSave({
          busy: false,
          error: `${err.message} Se ha actualizado la versión actual: revísala.`,
        });
        void loadDesignDetail(designDetail.artifact.id);
      } else {
        setVisualSave({ busy: false, error: err.message });
      }
      return false;
    }
  }

  async function performVisualLayoutSave(): Promise<boolean> {
    if (designDetail === null || visual === null) return false;
    const current = currentVersion(designDetail);
    if (current === undefined) return false;
    if (visual.key !== `${designDetail.artifact.id}:${current.id}`) return false;
    setVisualSave({ busy: true, error: null });
    const sentLayout = visual.layout;
    try {
      await saveDesignLayout({
        artifactId: designDetail.artifact.id,
        versionId: current.id,
        layout: visual.layout,
      });
      dispatchVisual({ type: "savedLayout", layout: sentLayout });
      setVisualSave({ busy: false, error: null });
      return true;
    } catch (raw) {
      setVisualSave({ busy: false, error: normalizeCoreError(raw).message });
      return false;
    }
  }

  async function performMockupSave(author: string): Promise<boolean> {
    if (mockupDetail === null || projectId === null || mockup === null) return false;
    const current = currentVersion(mockupDetail);
    if (current === undefined) return false;
    // Separado (la actual avanzó bajo el borrador): decide el panel de
    // conflicto del editor, no un guardado a ciegas.
    if (mockup.key !== `${mockupDetail.artifact.id}:${current.id}`) return false;
    if (!mockupSemanticDirty(mockup)) return false;
    let spec: unknown;
    try {
      spec = JSON.parse(mockup.history.present) as unknown;
    } catch {
      setMockupSave({ busy: false, error: "El borrador no es JSON válido." });
      return false;
    }
    setMockupSave({ busy: true, error: null });
    const sentPresent = mockup.history.present;
    const sentPins = mockup.pins;
    const sentAllowed = mockup.allowed;
    try {
      const saved = await saveMockupVersion({
        projectId,
        artifactId: mockupDetail.artifact.id,
        expectedVersionId: current.id,
        author,
        spec,
        sourceVersionIds: mockup.pins,
        layout: mockup.layout,
      });
      begin("mockupDetail", saved.artifact.id);
      setMockupDetail(saved);
      dispatchMockup({ type: "saved", present: sentPresent, pins: sentPins, allowed: sentAllowed });
      dispatchMockupReview({ type: "reset" });
      setViewingMockupVersionId(null);
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
      setMockupSave({ busy: false, error: null });
      return true;
    } catch (raw) {
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_VERSION) {
        setMockupSave({
          busy: false,
          error: `${err.message} Se ha actualizado la versión actual: revísala.`,
        });
        void loadMockupDetail(mockupDetail.artifact.id);
      } else {
        setMockupSave({ busy: false, error: err.message });
      }
      return false;
    }
  }

  async function performMockupLayoutSave(): Promise<boolean> {
    if (mockupDetail === null || mockup === null) return false;
    const current = currentVersion(mockupDetail);
    if (current === undefined) return false;
    if (mockup.key !== `${mockupDetail.artifact.id}:${current.id}`) return false;
    setMockupSave({ busy: true, error: null });
    const sentLayout = mockup.layout;
    try {
      await saveDesignLayout({
        artifactId: mockupDetail.artifact.id,
        versionId: current.id,
        layout: mockup.layout,
      });
      dispatchMockup({ type: "savedLayout", layout: sentLayout });
      setMockupSave({ busy: false, error: null });
      return true;
    } catch (raw) {
      setMockupSave({ busy: false, error: normalizeCoreError(raw).message });
      return false;
    }
  }

  function handleAdoptPins(pins: string[]) {
    if (visual === null) return;
    dispatchVisual({ type: "pins", pins, allowed: visual.allowed });
  }

  function handleAdoptMockupPins(pins: string[]) {
    if (mockup === null) return;
    dispatchMockup({ type: "pins", pins, allowed: mockup.allowed });
  }

  function handleDeclareMockupSources(pins: string[], allowed: string[]) {
    if (mockup === null) return;
    dispatchMockup({ type: "pins", pins, allowed });
  }

  async function handleMockupCreated(created: RequirementDetail) {
    if (projectId === null || moduleId === null) return;
    if (created.artifact.projectId !== projectId || created.artifact.moduleId !== moduleId) return;
    setExplorerRefresh((t) => t + 1);
    // Abrir el mockup nuevo conserva requisito y diseño en contexto.
    requestSelect(
      withMockup(selectionSnapshot(), projectId, moduleId, created.artifact.id),
      false,
      false,
      "mockups",
    );
  }

  function handleProposalAccepted(detail: RequirementDetail) {
    // El panel sigue abierto: solo refrescar el navegador con el requisito
    // creado, sin mover la selección ni tocar borradores.
    if (projectId === null || moduleId === null) return;
    if (detail.artifact.projectId !== projectId || detail.artifact.moduleId !== moduleId) return;
    setExplorerRefresh((t) => t + 1);
    bumpImpact();
  }

  function handleDesignAccepted(detail: RequirementDetail) {
    if (projectId === null || moduleId === null) return;
    if (detail.artifact.projectId !== projectId || detail.artifact.moduleId !== moduleId) return;
    setExplorerRefresh((t) => t + 1);
    bumpImpact();
  }

  function handleOpenRequirement(artifactId: string) {
    if (projectId !== null && moduleId !== null) {
      // Conserva el diseño en contexto; la vista la elige quien llama.
      requestSelect(
        withRequirement(selectionSnapshot(), projectId, moduleId, artifactId),
        false,
        false,
        "requirements",
      );
    }
  }

  function handleOpenDesign(artifactId: string) {
    if (projectId !== null && moduleId !== null) {
      // Conserva el requisito en contexto.
      requestSelect(
        withDesign(selectionSnapshot(), projectId, moduleId, artifactId),
        false,
        false,
        "design",
      );
    }
  }

  function handleOpenMockup(artifactId: string) {
    if (projectId !== null && moduleId !== null) {
      // Conserva requisito y diseño en contexto.
      requestSelect(
        withMockup(selectionSnapshot(), projectId, moduleId, artifactId),
        false,
        false,
        "mockups",
      );
    }
  }

  function handleOpenImpactArtifact(artifactId: string, kind: string) {
    if (projectId === null || moduleId === null) return;
    // Navegación real con la protección de borradores habitual; el mapa
    // conserva su contexto al volver a la pestaña.
    const snapshot = selectionSnapshot();
    const target =
      kind === "requirement"
        ? withRequirement(snapshot, projectId, moduleId, artifactId)
        : kind === "mockup"
          ? withMockup(snapshot, projectId, moduleId, artifactId)
          : withDesign(snapshot, projectId, moduleId, artifactId);
    const view: CenterView =
      kind === "requirement" ? "requirements" : kind === "mockup" ? "mockups" : "design";
    requestSelect(target, false, false, view);
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
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
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

  async function handleApproveMockup() {
    if (mockupDetail === null || projectId === null) return;
    const current = currentVersion(mockupDetail);
    if (current === undefined) return;
    setMockupApproveBusy(true);
    setMockupApproveError(null);
    try {
      // El comando de diseños revalida el mockup en Rust y aprueba.
      const approved = await approveDesign({
        projectId,
        artifactId: mockupDetail.artifact.id,
        expectedVersionId: current.id,
        approver: mockupApprover,
      });
      begin("mockupDetail", approved.artifact.id);
      setMockupDetail(approved);
      dispatchMockupReview({ type: "reset" });
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
    } catch (raw) {
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_VERSION) {
        setMockupApproveError(`${err.message} Se ha actualizado la versión actual: revísala.`);
        void loadMockupDetail(mockupDetail.artifact.id);
      } else {
        setMockupApproveError(err.message);
      }
    } finally {
      setMockupApproveBusy(false);
    }
  }

  const current = detail ? currentVersion(detail) : undefined;
  const mutating = saveBusy || approveBusy || createBusy;
  const approveAllowed =
    detail !== null &&
    current !== undefined &&
    !requirementArchived &&
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
    !designArchived &&
    designValidated?.versionId === designCurrent.id &&
    designValidated.ok &&
    canApprove({
      reviewedVersionId: designReview.reviewedVersionId,
      currentVersionId: designCurrent.id,
      dirty: visualSemanticDirty(visual),
      approver: designApprover,
      busy: designApproveBusy || visualSave.busy,
    });

  const mockupCurrent = mockupDetail ? currentVersion(mockupDetail) : undefined;
  const approveAllowedMockup =
    mockupDetail !== null &&
    mockupCurrent !== undefined &&
    !mockupArchived &&
    mockupValidated?.versionId === mockupCurrent.id &&
    mockupValidated.ok &&
    canApprove({
      reviewedVersionId: mockupReview.reviewedVersionId,
      currentVersionId: mockupCurrent.id,
      dirty: mockupSemanticDirty(mockup),
      approver: mockupApprover,
      busy: mockupApproveBusy || mockupSave.busy,
    });
  const viewingDesign =
    viewingDesignVersionId !== null && designDetail
      ? (designDetail.versions.find((v) => v.id === viewingDesignVersionId) ?? null)
      : null;
  const viewingMockup =
    viewingMockupVersionId !== null && mockupDetail
      ? (mockupDetail.versions.find((v) => v.id === viewingMockupVersionId) ?? null)
      : null;
  const navBusyAll =
    navBusy ||
    mutating ||
    designApproveBusy ||
    mockupApproveBusy ||
    archiveBusy ||
    archiveLoading ||
    renameBusy;

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

  function togglePanel(panel: PanelName) {
    useRequirementsUi.getState().togglePanel(panel);
  }

  function showRightTab(tab: RightTab) {
    const ui = useRequirementsUi.getState();
    ui.setRightTab(tab);
    if (!ui.panels[tab]) ui.togglePanel(tab);
  }

  return (
    <section className="workbench" aria-label="Espacio de trabajo">
      {banner}
      <div
        className={`workbench-grid${showRight ? "" : " no-right"}`}
        style={
          {
            ...(navigatorWidth === null ? {} : { "--nav-width": `${navigatorWidth}px` }),
            ...(rightWidth === null ? {} : { "--right-width": `${rightWidth}px` }),
          } as CSSProperties
        }
      >
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
            className={showReview && rightTab === "review" ? "active" : ""}
            onClick={() => {
              if (rightTab !== "review") showRightTab("review");
              else togglePanel("review");
            }}
            aria-pressed={showReview && rightTab === "review"}
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
          <button
            type="button"
            className={showAssistant && rightTab === "assistant" ? "active" : ""}
            onClick={() => {
              if (rightTab !== "assistant") showRightTab("assistant");
              else togglePanel("assistant");
            }}
            aria-pressed={showAssistant && rightTab === "assistant"}
            title={showAssistant ? "Ocultar asistente" : "Mostrar asistente"}
            aria-label={showAssistant ? "Ocultar asistente" : "Mostrar asistente"}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M8 1.5 9.7 6.3l4.8 1.7-4.8 1.7L8 14.5 6.3 9.7 1.5 8l4.8-1.7Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`rail-bottom ${showTerminal ? "active" : ""}`}
            onClick={() => togglePanel("terminal")}
            aria-pressed={showTerminal}
            title={showTerminal ? "Ocultar terminal" : "Mostrar terminal"}
            aria-label={showTerminal ? "Ocultar terminal" : "Mostrar terminal"}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2 4.5 6 8l-4 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8 11.5h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <ExplorerPanel
          hidden={!showNavigator}
          storageReady={storageReady}
          selection={{ projectId, moduleId, requirementId, designId, mockupId }}
          refreshToken={explorerRefresh}
          busy={navBusyAll}
          globalError={navError}
          meta={artifactMeta}
          onSelectProject={(id) => {
            if (id !== projectId) {
              requestSelect(
                { projectId: id, moduleId: null, requirementId: null, designId: null, mockupId: null },
                false,
              );
            }
          }}
          onSelectModule={(pid, id) => {
            if (id !== moduleId || pid !== projectId) {
              // Cambiar de módulo limpia artefactos de otro módulo.
              requestSelect(
                { projectId: pid, moduleId: id, requirementId: null, designId: null, mockupId: null },
                false,
              );
            }
          }}
          onSelectRequirement={(pid, mid, id) => {
            if (id !== requirementId || mid !== moduleId || pid !== projectId) {
              // Abrir el requisito conserva diseño y mockup en contexto.
              requestSelect(
                withRequirement(selectionSnapshot(), pid, mid, id),
                false,
                false,
                "requirements",
              );
            }
          }}
          onSelectDesign={(pid, mid, id) => {
            if (id !== designId || mid !== moduleId || pid !== projectId) {
              // Abrir el diseño conserva requisito y mockup en contexto.
              requestSelect(withDesign(selectionSnapshot(), pid, mid, id), false, false, "design");
            }
          }}
          onSelectMockup={(pid, mid, id) => {
            if (id !== mockupId || mid !== moduleId || pid !== projectId) {
              // Abrir el mockup conserva requisito y diseño en contexto.
              requestSelect(withMockup(selectionSnapshot(), pid, mid, id), false, false, "mockups");
            }
          }}
          onCreateProject={() => void handleCreateProject()}
          onCreateModule={(pid) => void handleCreateModule(pid)}
          onNewRequirement={(pid, mid) => {
            requestSelect(
              { projectId: pid, moduleId: mid, requirementId: null, designId: null, mockupId: null },
              true,
            );
          }}
          onProposeRequirements={(pid, mid) => {
            requestSelect(
              { projectId: pid, moduleId: mid, requirementId: null, designId: null, mockupId: null },
              false,
              true,
            );
          }}
          onNewMockup={(pid, mid) => {
            // Ir a Mockups con el módulo elegido; el formulario vive allí.
            requestSelect(
              { projectId: pid, moduleId: mid, requirementId: null, designId: null, mockupId: null },
              false,
              false,
              "mockups",
            );
          }}
          onSelectedModuleData={handleSelectedModuleData}
          onSelectedGraph={handleSelectedGraph}
          onArchiveAction={(target, action) => requestArchive(target, action)}
          onRename={requestRename}
        />

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
            <button
              type="button"
              role="tab"
              aria-selected={centerView === "impact"}
              className={centerView === "impact" ? "active" : ""}
              onClick={() => requestTab("impact")}
            >
              Impacto
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={centerView === "mockups"}
              className={centerView === "mockups" ? "active" : ""}
              onClick={() => requestTab("mockups")}
            >
              Mockups
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
                readOnly={requirementArchived}
                onEdit={(content) => {
                  dispatchDraft({ type: "edit", content });
                  dispatchReview({ type: "reset" });
                }}
                onAuthorChange={setSaveAuthor}
                onSave={() => void performSave()}
                onBackToCurrent={() => setViewingVersionId(null)}
                onRename={() => requestRenameDetail("requirement")}
              />
            ) : proposing && projectId !== null && moduleId !== null ? (
              <GenerationPanel
                key={`${projectId}/${moduleId}`}
                projectId={projectId}
                moduleId={moduleId}
                moduleArchived={moduleArchived}
                onAccepted={(detail) => void handleProposalAccepted(detail)}
                onOpenRequirement={handleOpenRequirement}
              />
            ) : creating && moduleId !== null ? (
              moduleArchived ? (
                <div>
                  <p className="notice" role="note">
                    Módulo archivado: restaúralo para crear requisitos.
                  </p>
                  <button type="button" className="secondary" onClick={() => setCreating(false)}>
                    Cerrar
                  </button>
                </div>
              ) : (
                <NewRequirementForm
                  busy={createBusy}
                  error={createError}
                  onCreate={(content, author) => void handleCreateRequirement(content, author)}
                  onCancel={() => setCreating(false)}
                />
              )
            ) : (
              <p className="hint">
                {moduleId === null
                  ? "Selecciona un proyecto y un módulo."
                  : "Selecciona un requisito o crea uno nuevo."}
              </p>
            )
          ) : centerView === "impact" ? (
            moduleId === null || projectId === null ? (
              <p className="hint">Selecciona un proyecto y un módulo.</p>
            ) : (
              <ImpactTab
                projectId={projectId}
                moduleId={moduleId}
                requirements={requirements}
                originId={impactOrigin}
                fromVersionId={impactFrom}
                report={impactReportData}
                busy={impactBusy}
                error={impactError}
                selectedId={impactNode}
                diffSignal={diffSignal}
                onOriginChange={(id) => {
                  setImpactOrigin(id);
                  setImpactFrom(null);
                  setImpactNode(null);
                }}
                onFromChange={setImpactFrom}
                onSelectNode={setImpactNode}
                onOpenArtifact={handleOpenImpactArtifact}
              />
            )
          ) : centerView === "mockups" ? (
            moduleId === null || projectId === null ? (
              <p className="hint">Selecciona un proyecto y un módulo.</p>
            ) : mockupId === null ? (
              <MockupsPanel
                projectId={projectId}
                moduleId={moduleId}
                moduleName={selectedModuleName}
                mockups={activeMockups}
                graph={selectedGraph}
                meta={artifactMeta}
                moduleArchived={moduleArchived}
                onOpenMockup={handleOpenMockup}
                onCreatedMockup={(created) => void handleMockupCreated(created)}
              />
            ) : mockupDetailBusy && mockupDetail === null ? (
              <p className="hint">Cargando mockup…</p>
            ) : mockupDetailError !== null && mockupDetail === null ? (
              <p className="error" role="alert">
                {mockupDetailError}
              </p>
            ) : mockupDetail !== null ? (
              <div>
                {mockupArchived && (
                  <p className="notice" role="note">
                    Mockup archivado: se consulta en lectura; restaúralo para editarlo.
                  </p>
                )}
                <MockupDetail
                  detail={mockupDetail}
                  viewing={viewingMockup}
                  onBackToCurrent={() => setViewingMockupVersionId(null)}
                  onValidatedVersion={(versionId, ok) => setMockupValidated({ versionId, ok })}
                  onRename={() => requestRenameDetail("mockup")}
                  renameDisabled={mockupArchived}
                  onGenerateDesign={
                    mockupArchived || mockupId === null
                      ? undefined
                      : () =>
                          setGenerateRequest({
                            preselected: [],
                            preselectedMockups: [mockupId],
                          })
                  }
                  editing={
                    projectId === null || moduleId === null || mockupArchived
                      ? undefined
                      : {
                        projectId,
                        moduleId,
                        draft: mockup,
                        onAction: dispatchMockup,
                        save: mockupSave,
                        onSave: (author) => void performMockupSave(author),
                        onSaveLayoutOnly: () => void performMockupLayoutSave(),
                        onAdoptPins: handleAdoptMockupPins,
                        onDeclareSources: handleDeclareMockupSources,
                      }
                  }
                />
              </div>
            ) : null
          ) : designId === null ? (
            moduleId === null || projectId === null ? (
              <p className="hint">Selecciona un proyecto y un módulo.</p>
            ) : requirementId !== null ? (
              <RequirementDesigns
                key={`${projectId}/${moduleId}/${requirementId}`}
                projectId={projectId}
                moduleId={moduleId}
                requirementId={requirementId}
                graph={selectedGraph}
                meta={artifactMeta}
                designs={selectedArtifacts}
                moduleName={selectedModuleName}
                autoEnabled={moduleAutoEnabled}
                autoStatus={moduleAutoStatus}
                onToggleAuto={toggleModuleAuto}
                onOpenDesign={handleOpenDesign}
                onOpenRequirement={handleOpenRequirement}
                onGenerate={(preselected) => setGenerateRequest({ preselected })}
                archived={isEffectivelyArchived(
                  detail?.artifact.id === requirementId
                    ? detail.artifact.archived
                    : (selectedArtifacts.find((a) => a.id === requirementId)?.archived ?? false),
                  moduleArchived,
                )}
              />
            ) : (
              <ModuleDesigns
                designs={activeDesigns}
                graph={selectedGraph}
                meta={artifactMeta}
                moduleArchived={moduleArchived}
                onOpenDesign={handleOpenDesign}
                onGenerate={() => setGenerateRequest({ preselected: null })}
                moduleName={selectedModuleName}
                autoEnabled={moduleAutoEnabled}
                autoStatus={moduleAutoStatus}
                onToggleAuto={toggleModuleAuto}
              />
            )
          ) : designDetailBusy && designDetail === null ? (
            <p className="hint">Cargando diseño…</p>
          ) : designDetailError !== null && designDetail === null ? (
            <p className="error" role="alert">
              {designDetailError}
            </p>
          ) : designDetail !== null ? (
            <div>
              {designArchived && (
                <p className="notice" role="note">
                  Diseño archivado: se consulta en lectura; restaúralo para editarlo.
                </p>
              )}
              <DesignDetail
                detail={designDetail}
                viewing={viewingDesign}
                onBackToCurrent={() => setViewingDesignVersionId(null)}
                onValidatedVersion={(versionId, ok) => setDesignValidated({ versionId, ok })}
                onRename={() => requestRenameDetail("design")}
                renameDisabled={designArchived}
                editing={
                  projectId === null || designArchived
                    ? undefined
                    : {
                      projectId,
                      draft: visual,
                      onAction: dispatchVisual,
                      save: visualSave,
                      onSave: (author) => void performVisualSave(author),
                      onSaveLayoutOnly: () => void performVisualLayoutSave(),
                      onAdoptPins: handleAdoptPins,
                    }
              }
              />
            </div>
          ) : null}
        </div>

        {showRight && (
          <div className="right-column">
            <RightResizeHandle />
            <div className="right-tabs" role="tablist" aria-label="Columna derecha">
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "review"}
                className={rightTab === "review" ? "active" : ""}
                onClick={() => showRightTab("review")}
              >
                Revisión
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "assistant"}
                className={rightTab === "assistant" ? "active" : ""}
                onClick={() => showRightTab("assistant")}
              >
                Asistente
              </button>
            </div>
            {rightTab === "assistant" ? (
              projectId !== null && moduleId !== null ? (
                <AssistantPanel
                  projectId={projectId}
                  moduleId={moduleId}
                  moduleName={selectedModuleName}
                  moduleArchived={moduleArchived}
                  artifacts={selectedArtifacts}
                  context={{
                    requirementId,
                    designId,
                    mockupId,
                    requirementDetail: detail,
                    designDetail,
                    mockupDetail,
                  }}
                  draftsDirty={{
                    requirement: draft.dirty,
                    design: visualSemanticDirty(visual),
                    mockup: mockupSemanticDirty(mockup),
                  }}
                  impactReport={impactReportData}
                  onAcceptedRequirement={(accepted) => void handleProposalAccepted(accepted)}
                  onAcceptedDesign={(accepted) => void handleDesignAccepted(accepted)}
                  onOpenRequirement={handleOpenRequirement}
                  onOpenDesign={handleOpenDesign}
                  onOpenImpactArtifact={handleOpenImpactArtifact}
                  onOpenImpact={() => useRequirementsUi.getState().setCenterView("impact")}
                />
              ) : (
                <p className="hint">Selecciona un proyecto y un módulo.</p>
              )
            ) : (
              <>
        {showReview && centerView === "impact" && impactReportData !== null && projectId !== null && moduleId !== null && (
          <ImpactInspector
            report={impactReportData}
            projectId={projectId}
            moduleId={moduleId}
            selectedId={impactNode}
            edits={updateEdits}
            onEdit={handleUpdateEdit}
            onSelectNode={setImpactNode}
            onOpenArtifact={handleOpenImpactArtifact}
            onShowDiff={() => setDiffSignal((s) => s + 1)}
            onAccepted={(detail) => void handleDesignAccepted(detail)}
          />
        )}
        {showReview && centerView === "requirements" && detail !== null && current !== undefined && (
          <ReviewPanel
            detail={detail}
            reviewedVersionId={review.reviewedVersionId}
            approver={approver}
            dirty={draft.dirty}
            busy={mutating}
            approveAllowed={approveAllowed}
            approveError={approveError}
            viewingVersionId={viewingVersionId}
            archived={requirementArchived}
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
        {showReview && centerView === "design" && designDetail !== null && designCurrent !== undefined && (
          <ReviewPanel
            detail={designDetail}
            reviewedVersionId={designReview.reviewedVersionId}
            approver={designApprover}
            dirty={visualSemanticDirty(visual)}
            busy={designApproveBusy || visualSave.busy}
            approveAllowed={approveAllowedDesign}
            approveError={designApproveError}
            viewingVersionId={viewingDesignVersionId}
            sources={designCurrent.sources}
            archived={designArchived}
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
        {showReview && centerView === "mockups" && mockupDetail !== null && mockupCurrent !== undefined && (
          <ReviewPanel
            detail={mockupDetail}
            reviewedVersionId={mockupReview.reviewedVersionId}
            approver={mockupApprover}
            dirty={mockupSemanticDirty(mockup)}
            busy={mockupApproveBusy || mockupSave.busy}
            approveAllowed={approveAllowedMockup}
            approveError={mockupApproveError}
            viewingVersionId={viewingMockupVersionId}
            sources={mockupCurrent.sources}
            archived={mockupArchived}
            onToggleReview={(versionId, checked) =>
              dispatchMockupReview({ type: "toggle", versionId, checked })
            }
            onApproverChange={setMockupApprover}
            onApprove={() => void handleApproveMockup()}
            onViewVersion={(versionId) =>
              setViewingMockupVersionId(
                versionId === mockupDetail.currentVersionId ? null : versionId,
              )
            }
          />
        )}
              </>
            )}
          </div>
        )}
      </div>

      <TerminalPanel visible={showTerminal} onHide={() => togglePanel("terminal")} />

      <footer className="statusbar" aria-label="Estado">
        <span className="status-left">
          <span className={`save-dot ${saveStateValue}`} aria-hidden="true" />
          {saveLabel ?? "Persistencia local activa"}
        </span>
        <span className="status-right">
          {projectId ?? "—"} / {moduleId ?? "—"}
          {requirementId !== null ? ` / ${requirementId}` : ""}
          {designId !== null ? ` / ${designId}` : ""}
        </span>
      </footer>

      {dialog !== null && dialogSubjectId(dialog) !== null && (
        <UnsavedDialog
          subject={dialogSubjectLabel(dialog)}
          layoutOnly={dialogLayoutOnly(dialog)}
          author={saveAuthor}
          busy={dialogBusy(dialog)}
          error={dialogError ?? dialogSaveError(dialog)}
          onAuthorChange={setSaveAuthor}
          onSave={() => void handleDialogSave()}
          onDiscard={handleDialogDiscard}
          onCancel={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}

      {generateRequest !== null && projectId !== null && moduleId !== null && (
        <GenerateDesignDialog
          projectId={projectId}
          moduleId={moduleId}
          artifacts={selectedArtifacts}
          preselected={generateRequest.preselected}
          preselectedMockups={generateRequest.preselectedMockups ?? null}
          onClose={() => setGenerateRequest(null)}
          onAccepted={(detail) => void handleDesignAccepted(detail)}
          onOpenDesign={(designId) => {
            setGenerateRequest(null);
            handleOpenDesign(designId);
          }}
        />
      )}

      {archiveAfterSave !== null &&
        archiveGuardKind !== null &&
        archiveSubjectId(archiveGuardKind) !== null && (
          <UnsavedDialog
            subject={archiveSubjectLabel(archiveGuardKind)}
            layoutOnly={
              archiveGuardKind === "visual"
                ? !visualSemanticDirty(visual)
                : archiveGuardKind === "mockup"
                  ? !mockupSemanticDirty(mockup)
                  : false
            }
            author={saveAuthor}
            busy={
              archiveGuardKind === "visual"
                ? visualSave.busy
                : archiveGuardKind === "mockup"
                  ? mockupSave.busy
                  : saveBusy
            }
            error={
              archiveError ??
              (archiveGuardKind === "visual"
                ? visualSave.error
                : archiveGuardKind === "mockup"
                  ? mockupSave.error
                  : saveError)
            }
            onAuthorChange={setSaveAuthor}
            onSave={() => void handleArchiveDialogSave()}
            onDiscard={handleArchiveDialogDiscard}
            onCancel={() => {
              setArchiveAfterSave(null);
              setArchiveGuardKind(null);
              setArchiveError(null);
            }}
          />
        )}

      {archiveRequest !== null && (
        <ArchiveDialog
          target={archiveRequest.target}
          action={archiveRequest.action}
          preview={archivePreview}
          loading={archiveLoading}
          busy={archiveBusy}
          error={archiveError}
          onActionChange={(action) =>
            setArchiveRequest((prev) => (prev === null ? prev : { ...prev, action }))
          }
          onConfirm={() => void performArchive()}
          onRetry={() => void openArchive(archiveRequest)}
          onClose={closeArchive}
        />
      )}

      {renameRequest !== null && (
        <RenameDialog
          target={renameRequest}
          busy={renameBusy}
          error={renameError}
          author={saveAuthor}
          onConfirm={(name, author) => void performRename(name, author)}
          onClose={closeRename}
        />
      )}
    </section>
  );
}

/**
 * Tirador para ajustar el ancho de la columna derecha (ratón o teclado).
 * Espeja el del explorador, al otro lado: arrastrar a la izquierda ensancha.
 */
function RightResizeHandle() {
  const width = useRequirementsUi((s) => s.rightWidth);
  const draggingRef = useRef(false);

  const apply = useCallback((clientX: number, baseX: number, baseWidth: number) => {
    const next = Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, baseWidth - (clientX - baseX)));
    useRequirementsUi.getState().setRightWidth(next);
  }, []);

  return (
    <div
      className="right-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ajustar ancho de la columna derecha"
      aria-valuenow={width ?? undefined}
      aria-valuemin={MIN_RIGHT_WIDTH}
      aria-valuemax={MAX_RIGHT_WIDTH}
      tabIndex={0}
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const baseX = e.clientX;
        const column = (e.target as HTMLElement).closest(".right-column");
        const baseWidth = column?.getBoundingClientRect().width ?? DEFAULT_RIGHT_WIDTH;
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
        const current = useRequirementsUi.getState().rightWidth ?? DEFAULT_RIGHT_WIDTH;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const delta = e.key === "ArrowLeft" ? 16 : -16;
          useRequirementsUi
            .getState()
            .setRightWidth(
              Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, current + delta)),
            );
        } else if (e.key === "Home") {
          e.preventDefault();
          useRequirementsUi.getState().setRightWidth(null);
        }
      }}
    />
  );
}
