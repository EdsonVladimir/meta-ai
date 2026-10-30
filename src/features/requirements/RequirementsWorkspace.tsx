import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriEnvironment } from "../../lib/env";
import { createProjectFromFolder } from "./projectFromFolder";
import { addCodeRoot, setRootProject } from "../code/client";
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
  deleteProject,
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
import { NavResizeHandle } from "../explorer/NavResizeHandle";
import { firstLine, moduleKey, type ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import { NewRequirementForm } from "./NewRequirementForm";
import { PerspectiveTabs } from "./PerspectiveTabs";
import { TraceView } from "../trace/TraceView";
import { RequirementEditor } from "./RequirementEditor";
import { ReviewPanel } from "./ReviewPanel";
import { UnsavedDialog } from "./UnsavedDialog";
import { withDesign, withMockup, withRequirement, withScreen } from "./navigation";
import { DEFAULT_RIGHT_WIDTH, MAX_RIGHT_WIDTH, MIN_RIGHT_WIDTH, RESIZE_KEYBOARD_STEP_PX, EMPTY_SELECTION, useRequirementsUi, type CenterView, type DocSaveState, type PanelName, type RightTab, type Selection } from "./uiStore";
import { dirtyDocKeys, docKey } from "./saveStatus";
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
import { type CodeSaveApi } from "../code/CodeWorkspace";
import { ArchitectureView } from "../code/archmap/ArchitectureView";
import { CodeMainPane } from "../code/CodeMainPane";
import { CodeTreePane } from "../code/CodeTreePane";
import { CodeWorkspaceProvider } from "../code/useCodeWorkspace";
import { listCodeRoots } from "../code/client";
import type { CodeRootDto } from "../code/types";
import { listTerminals } from "../terminal/client";
import { listProjects } from "./client";
import {
  listRecents,
  normalizeWorkspaceError,
  removeRecent,
  touchRecent,
} from "../workspace/client";
import type { RecentWorkspaceDto } from "../workspace/types";
import { openProjectFromFolder, samePath } from "../workspace/openProject";
import { WelcomeScreen } from "../workspace/WelcomeScreen";
import { WorkspaceSelector } from "../workspace/WorkspaceSelector";
import { OverviewView } from "../workspace/OverviewView";
import { WorkspaceCloseDialog } from "../workspace/WorkspaceCloseDialog";
import { ModuleCodeLinks } from "../code/ModuleCodeLinks";
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
  draft: "Unsaved draft (memory only)",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed: the draft is kept",
};

type Slot = "detail" | "designDetail" | "mockupDetail" | "impact" | "archive" | "rename";

interface PendingNav {
  selection: Selection;
  showCreateForm: boolean;
  showPropose: boolean;
  /** Explicit view (tabs); null derives from the selection. */
  view: CenterView | null;
  /** Which draft the dialog protects: requirement, visual or mockup. */
  draft: "requirement" | "visual" | "mockup";
}

export function RequirementsWorkspace() {
  const [isNative] = useState<boolean>(() => isTauriEnvironment());
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const moduleId = useRequirementsUi((s) => s.selection.moduleId);
  const requirementId = useRequirementsUi((s) => s.selection.requirementId);
  const designId = useRequirementsUi((s) => s.selection.designId);
  const mockupId = useRequirementsUi((s) => s.selection.mockupId);
  const screenId = useRequirementsUi((s) => s.selection.screenId);
  const navigatorWidth = useRequirementsUi((s) => s.navigatorWidth);
  const centerView = useRequirementsUi((s) => s.centerView);
  const centerDoc = useRequirementsUi((s) => s.centerDoc);
  const showNavigator = useRequirementsUi((s) => s.panels.navigator);
  const showReview = useRequirementsUi((s) => s.panels.review);
  const showTerminal = useRequirementsUi((s) => s.panels.terminal);
  const showAssistant = useRequirementsUi((s) => s.panels.assistant);
  const rightTab = useRequirementsUi((s) => s.rightTab);
  const rightWidth = useRequirementsUi((s) => s.rightWidth);
  const showRight = showReview || showAssistant;

  // Artifacts of the selected module, reported by the explorer for the
  // center views. The full cache lives in the explorer.
  const [selectedArtifacts, setSelectedArtifacts] = useState<ArtifactDto[]>([]);
  // Modules of the selected project (same report): they determine the
  // contextual archiving of the center views.
  const [selectedModules, setSelectedModules] = useState<ModuleDto[]>([]);
  // Links of the selected module (same explorer report).
  const [selectedGraph, setSelectedGraph] = useState<ModuleGraph | null>(null);
  // "Generate design" dialog with source preselection (null = closed).
  const [generateRequest, setGenerateRequest] = useState<{
    preselected: string[] | null;
    preselectedMockups?: string[] | null;
  } | null>(null);
  const [explorerRefresh, setExplorerRefresh] = useState(0);
  const explorerToken = useRequirementsUi((s) => s.explorerToken);
  // External tree changes (structure replica): reload
  // projects and everything already loaded. Only moves forward, never back.
  const seenExplorerToken = useRef(explorerToken);
  useEffect(() => {
    if (explorerToken === seenExplorerToken.current) return;
    seenExplorerToken.current = explorerToken;
    setExplorerRefresh((t) => t + 1);
  }, [explorerToken]);
  // Known labels and states of details loaded in the session.
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
  // Lifted visual draft: survives tab switches; only resets on save,
  // discard or leaving the design.
  const [visual, dispatchVisual] = useReducer(visualDraftReducer, null);
  const [visualSave, setVisualSave] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  // Lifted mockup draft with the same guarantees as the visual one.
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
  // Archive and delete: the preview summary is advisory and execution
  // revalidates in Rust. `archiveAfterSave` chains the draft dialog
  // (save/discard/cancel) before opening the summary.
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
  // Rename: organizational name or metadata title. Touches no content,
  // versions or drafts; Rust revalidates the expected revision.
  // Automatic AI update: per module and per session, off by default.
  // Manual saves schedule it; proposals go to Impact and are never
  // accepted alone.
  const [autoUpdate, setAutoUpdate] = useState<Record<string, boolean>>({});
  const [autoStatus, setAutoStatus] = useState<
    ({ moduleKey: string } & AutoStatus) | null
  >(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoInflight = useRef(false);
  const autoRerun = useRef(false);
  const centralSaving = useRef(false);
  const codeSaveRef = useRef<CodeSaveApi | null>(null);
  const [codeDocStatus, setCodeDocStatus] = useState<Record<string, DocSaveState>>({});
  const centralSaveRef = useRef<() => void>(() => {});
  const saveAllRef = useRef<() => void>(() => {});
  const saveAllBusy = useRef(false);
  const [renameRequest, setRenameRequest] = useState<RenameTarget | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [storage, setStorage] = useState<CoreStatus | null>(null);
  const storageReady = storage?.ready === true;

  // Impact context: lives here (not in Zustand nor in the panel) to
  // survive leaving and returning to the tab.
  const [impactOrigin, setImpactOrigin] = useState<string | null>(null);
  const [impactFrom, setImpactFrom] = useState<string | null>(null);
  const [impactNode, setImpactNode] = useState<string | null>(null);
  const [impactReportData, setImpactReportData] = useState<ImpactReportDto | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [diffSignal, setDiffSignal] = useState(0);
  const bumpImpact = useCallback(() => setRefreshToken((t) => t + 1), []);

  // JSON edits of update proposals, per generation: they live here so
  // navigating (nodes, tabs) never loses them silently.
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

  // Active center lists: archived items (own or by context) are
  // filtered out; still reachable from the tree with "Show archived".
  const moduleArchived =
    moduleId !== null && selectedModules.some((m) => m.id === moduleId && m.archived);
  // Auto-update of the selected module (module or requirement view).
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
  // Fresh data for the deferred auto-update (the timer would capture the
  // save's render, before re-deriving).
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

  // The explorer loads projects, modules and artifacts on demand; here only
  // labels and states of open details are learned.
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

  // Switching projects/modules restarts the impact context.
  useEffect(() => {
    setImpactOrigin(null);
    setImpactFrom(null);
    setImpactNode(null);
    setImpactReportData(null);
    setImpactError(null);
  }, [projectId, moduleId]);

  // The selected requirement is the initial analysis origin. When switching
  // requirements the previous comparison becomes incompatible (versions
  // belong to their artifact) and restarts; while the origin stays, the
  // chosen comparison is kept.
  useEffect(() => {
    if (requirementId === null) return;
    setImpactOrigin(requirementId);
    setImpactFrom(null);
    setImpactNode(null);
  }, [requirementId]);

  // Default origin on entering: the selected requirement, when it belongs
  // to the module; otherwise the first one. Only while no origin is chosen.
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

  // Selections missing from the report clear themselves.
  useEffect(() => {
    if (impactReportData === null || impactNode === null) return;
    const known =
      impactNode === impactReportData.origin.artifact.id ||
      impactReportData.affected.some((a) => a.artifact.id === impactNode);
    if (!known) setImpactNode(null);
  }, [impactReportData, impactNode]);

  // Central Save: Ctrl+S (always avoids the WebView dialog, even inside
  // dialogs where it targets no editor) and the header button via
  // `saveSignal`. The ref avoids resubscribing per render.
  centralSaveRef.current = () => void centralSave();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const target = event.target as HTMLElement | null;
        if (target !== null && typeof target.closest === "function") {
          // Dialogs: targets no editor. Terminal: the key belongs to the
          // PTY (XOFF/XON) and never fires the editor Save.
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
  // Save-all (export gate): ref to avoid resubscribing.
  saveAllRef.current = () => void runSaveAll();
  const saveAllSignal = useRequirementsUi((s) => s.saveAllSignal);
  useEffect(() => {
    if (saveAllSignal === 0) return;
    saveAllRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAllSignal]);
  // Per-document status for the header: only published when changed.
  useEffect(() => {
    const ui = useRequirementsUi.getState();
    const next: Record<string, DocSaveState> = {};
    if (requirementId !== null) {
      const title =
        detail !== null && detail.artifact.id === requirementId
          ? (detail.artifact.title ?? firstLine(currentVersion(detail)?.content ?? "") ?? requirementId)
          : requirementId;
      next[docKey("req", requirementId)] = {
        label: `requirement ${title}`,
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
        label: `design ${title}${!semantic && layout ? " (layout only)" : ""}`,
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
        label: `mockup ${title}${!semantic && layout ? " (layout only)" : ""}`,
        dirty: semantic || layout,
        saving: mockupSave.busy,
        error: mockupSave.error,
      };
    }
    Object.assign(next, codeDocStatus);
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
      // Picking an artifact switches views; picking a project/module keeps it.
      // Creation modes always show in Requirements.
      const derived: CenterView =
        view ??
        (showCreateForm || showPropose
          ? "requirements"
          : ui.centerView === "welcome"
            ? "overview"
            : ui.centerView);
      ui.setCenterView(derived);
      // Only what belongs to the changed artifact restarts: the requirement
      // draft survives navigating across designs and vice versa.
      if (target.requirementId !== current.requirementId) {
        dispatchDraft({ type: "select", requirementId: target.requirementId });
        dispatchReview({ type: "reset" });
        setViewingVersionId(null);
      }
      if (target.designId !== current.designId) {
        dispatchDesignReview({ type: "reset" });
        setViewingDesignVersionId(null);
        setDesignValidated(null);
        // When leaving the design, its visual draft was already saved or
        // discarded in the dialog: here only the state is cleared.
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

  // A visual save error clears when editing of the draft resumes
  // (specification or pins), not when moving the canvas.
  const visualPresent = visual?.history.present;
  const visualPinsKey = visual === null ? "" : visual.pins.join(",");
  useEffect(() => {
    setVisualSave((prev) => (prev.error === null ? prev : { ...prev, error: null }));
  }, [visualPresent, visualPinsKey]);

  // Same for mockups: the error clears when editing resumes.
  const mockupPresent = mockup?.history.present;
  const mockupPinsKey = mockup === null ? "" : mockup.pins.join(",");
  useEffect(() => {
    setMockupSave((prev) => (prev.error === null ? prev : { ...prev, error: null }));
  }, [mockupPresent, mockupPinsKey]);

  function requestTab(view: CenterView) {
    // Overview and Architecture need a project; design views need a
    // module too. Switching views never touches drafts or terminals.
    // Welcome has no tab: close flows are the only way back to it.
    if (view === centerView || view === "welcome") return;
    if (projectId === null) return;
    if (view !== "overview" && view !== "architecture" && moduleId === null) return;
    const ui = useRequirementsUi.getState();
    ui.setCenterView(view);
    ui.setCenterDoc(null);
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
      a.mockupId === b.mockupId &&
      a.screenId === b.screenId
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
          { projectId: created.id, moduleId: null, requirementId: null, designId: null, mockupId: null, screenId: null },
          false,
        );
      }
    } catch (raw) {
      setNavError(normalizeCoreError(raw).message);
    } finally {
      setNavBusy(false);
    }
  }

  // ---- Workspace open/close (welcome, recents, close gate) ----
  const [recents, setRecents] = useState<RecentWorkspaceDto[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recentsError, setRecentsError] = useState<string | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  const [busyRecentId, setBusyRecentId] = useState<string | null>(null);
  const welcomeEpoch = useRef(0);

  const loadRecents = useCallback(async () => {
    if (!isNative) return;
    const epoch = ++welcomeEpoch.current;
    setRecentsLoading(true);
    setRecentsError(null);
    try {
      const entries = await listRecents();
      if (welcomeEpoch.current === epoch) setRecents(entries);
    } catch (raw) {
      if (welcomeEpoch.current === epoch) {
        setRecentsError(normalizeWorkspaceError(raw).message);
      }
    } finally {
      if (welcomeEpoch.current === epoch) setRecentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (centerView === "welcome") void loadRecents();
  }, [centerView, loadRecents]);

  // Records the open workspace in recents. Touches are best-effort after
  // the workspace is already visible; a failure never blocks the user.
  async function recordRecent(projectId: string, id?: string) {
    try {
      const [projects, roots] = await Promise.all([listProjects(), listCodeRoots()]);
      const name = projects.find((p) => p.id === projectId)?.name ?? projectId;
      await touchRecent({
        id,
        label: name,
        projectId,
        rootPaths: roots.filter((r) => r.projectId === projectId).map((r) => r.path),
      });
    } catch (raw) {
      setWelcomeError(
        (prev) =>
          prev ??
          `Opened, but the workspace was not saved to recents: ${normalizeWorkspaceError(raw).message}`,
      );
    }
    void loadRecents();
  }

  async function handleOpenProject() {
    if (!isNative || welcomeBusy) return;
    setWelcomeBusy(true);
    setWelcomeError(null);
    try {
      const result = await openProjectFromFolder({
        pickFolder: async () => {
          const chosen = await open({
            directory: true,
            multiple: false,
            title: "Open project folder",
          });
          return typeof chosen === "string" ? chosen : null;
        },
        listRoots: listCodeRoots,
        listProjects,
        createProject,
        renameProject: (projectId, expectedName, name) =>
          renameProject({ projectId, expectedName, name }),
        addCodeRoot,
        setRootProject,
      });
      if (result.cancelled) return;
      setExplorerRefresh((token) => token + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
      applySelection(
        { ...EMPTY_SELECTION, projectId: result.projectId },
        false,
        false,
        "overview",
      );
      if (result.warnings.length > 0) setWelcomeError(result.warnings.join(" "));
      await recordRecent(result.projectId);
    } catch (raw) {
      setWelcomeError(normalizeWorkspaceError(raw).message);
    } finally {
      setWelcomeBusy(false);
    }
  }

  async function handleOpenRecent(recent: RecentWorkspaceDto) {
    if (!isNative || welcomeBusy || busyRecentId !== null) return;
    setBusyRecentId(recent.id);
    setWelcomeError(null);
    try {
      const roots = await listCodeRoots();
      const restored = roots.map((root) => root.path);
      const failed: string[] = [];
      const restoredCount = { current: 0 };
      for (const path of recent.rootPaths) {
        if (restored.some((known) => samePath(known, path))) {
          restoredCount.current += 1;
          continue;
        }
        try {
          await addCodeRoot(path);
          restoredCount.current += 1;
        } catch {
          failed.push(path);
        }
      }
      setExplorerRefresh((token) => token + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
      let projectId = recent.projectId;
      if (projectId !== null) {
        const projects = await listProjects();
        if (!projects.some((p) => p.id === projectId)) projectId = null;
      }
      if (projectId !== null) {
        applySelection(
          { ...EMPTY_SELECTION, projectId },
          false,
          false,
          "overview",
        );
        await recordRecent(projectId, recent.id);
      }
      if (projectId === null) {
        setWelcomeError(
          recent.projectId === null
            ? `Restored ${restoredCount.current} folder(s) without an associated project. Open one as a project to continue.`
            : "The project for this entry no longer exists; its folders were restored loose. Open one as a project or forget the entry.",
        );
      } else if (failed.length > 0) {
        setWelcomeError(
          `Opened with ${failed.length} missing folder(s). Re-add them from the explorer or forget the entry.`,
        );
      }
    } catch (raw) {
      setWelcomeError(normalizeWorkspaceError(raw).message);
    } finally {
      setBusyRecentId(null);
    }
  }

  async function handleNewProject() {
    if (!isNative || welcomeBusy) return;
    setWelcomeBusy(true);
    setWelcomeError(null);
    try {
      await handleCreateProject();
      const created = useRequirementsUi.getState().selection.projectId;
      if (created === null) {
        setWelcomeError("Could not create the project.");
        return;
      }
      useRequirementsUi.getState().setCenterView("overview");
      await recordRecent(created);
    } finally {
      setWelcomeBusy(false);
    }
  }

  async function handleRemoveRecent(id: string) {
    if (!isNative || busyRecentId !== null) return;
    setBusyRecentId(id);
    try {
      await removeRecent(id);
      setRecents((entries) => entries.filter((entry) => entry.id !== id));
      void loadRecents();
    } catch (raw) {
      setRecentsError(normalizeWorkspaceError(raw).message);
    } finally {
      setBusyRecentId(null);
    }
  }

  // ---- Close gate ----
  // Changing or closing the workspace must settle: unsaved documents
  // (any tab: design, code, mockup) and live terminals survive view
  // switches but the user must know before the context goes away.
  const [closeGate, setCloseGate] = useState<{
    dirtyLabels: string[];
    terminalCount: number;
    terminalCwds: string[];
    terminalsUnknown: boolean;
    saving: boolean;
    saveError: string | null;
  } | null>(null);
  const pendingAfterClose = useRef<(() => void) | null>(null);

  async function requestWorkspaceAction(afterClose: (() => void) | null) {
    if (centerView === "welcome") {
      afterClose?.();
      return;
    }
    const status = useRequirementsUi.getState().docStatus;
    const dirtyLabels = dirtyDocKeys(status).map((key) => status[key]?.label ?? key);
    let terminalCount = 0;
    let terminalCwds: string[] = [];
    let terminalsUnknown = false;
    if (isNative) {
      try {
        const sessions = await listTerminals();
        terminalCount = sessions.length;
        terminalCwds = Array.from(new Set(sessions.map((session) => session.cwd)));
      } catch {
        terminalsUnknown = true;
      }
    }
    if (dirtyLabels.length === 0 && terminalCount === 0 && !terminalsUnknown) {
      if (afterClose !== null) afterClose();
      else doCloseWorkspace();
      return;
    }
    pendingAfterClose.current = afterClose;
    setCloseGate({
      dirtyLabels,
      terminalCount,
      terminalCwds,
      terminalsUnknown,
      saving: false,
      saveError: null,
    });
  }

  function doCloseWorkspace() {
    pendingAfterClose.current = null;
    setCloseGate(null);
    setCreating(false);
    setProposing(false);
    useRequirementsUi.getState().requestDiscard();
    applySelection({ ...EMPTY_SELECTION }, false, false, "welcome");
    useRequirementsUi.getState().setCenterDoc(null);
    setWelcomeError(null);
    void loadRecents();
  }

  async function handleSaveAndClose() {
    if (closeGate?.saving) return;
    setCloseGate((gate) => (gate === null ? gate : { ...gate, saving: true, saveError: null }));
    const startedAt = Date.now();
    await runSaveAll();
    const result = useRequirementsUi.getState().saveAllResult;
    if (result !== null && result.at >= startedAt && result.ok) {
      const afterClose = pendingAfterClose.current;
      doCloseWorkspace();
      afterClose?.();
    } else {
      setCloseGate((gate) =>
        gate === null
          ? gate
          : {
              ...gate,
              saving: false,
              saveError: result?.message ?? "Could not save everything.",
            },
      );
    }
  }

  function handleCloseWithoutSaving() {
    const afterClose = pendingAfterClose.current;
    doCloseWorkspace();
    afterClose?.();
  }

  function handleCancelClose() {
    pendingAfterClose.current = null;
    setCloseGate(null);
  }

  // Open-project/new-project entries: from welcome they run directly;
  // with a workspace open they first settle the current context.
  function guardedOpenProject() {
    if (centerView === "welcome") void handleOpenProject();
    else void requestWorkspaceAction(() => void handleOpenProject());
  }

  function guardedNewProject() {
    if (centerView === "welcome") void handleNewProject();
    else void requestWorkspaceAction(() => void handleNewProject());
  }

  function guardedCloseWorkspace() {
    void requestWorkspaceAction(null);
  }

  function guardedOpenRecent(recent: RecentWorkspaceDto) {
    if (centerView === "welcome") void handleOpenRecent(recent);
    else void requestWorkspaceAction(() => void handleOpenRecent(recent));
  }

  // Project header data: name and associated roots for the workspace
  // bar and the Overview. Reloaded with the explorer refresh token so
  // folder changes are reflected without a dedicated subscription.
  const [projectName, setProjectName] = useState<string | null>(null);
  const [codeRoots, setCodeRoots] = useState<CodeRootDto[]>([]);

  useEffect(() => {
    if (!isNative || projectId === null || centerView === "welcome") {
      setProjectName(null);
      setCodeRoots([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [projects, roots] = await Promise.all([listProjects(), listCodeRoots()]);
        if (cancelled) return;
        setProjectName(projects.find((p) => p.id === projectId)?.name ?? projectId);
        setCodeRoots(roots);
      } catch {
        if (!cancelled) {
          setProjectName(projectId);
          setCodeRoots([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative, projectId, centerView, explorerRefresh]);

  async function handleAddFolder() {
    if (!isNative || projectId === null || navBusy) return;
    setNavBusy(true);
    setNavError(null);
    try {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: "Add folder to project",
      });
      if (typeof chosen !== "string") return;
      const roots = await listCodeRoots();
      const existing = roots.find((root) => samePath(root.path, chosen));
      if (existing !== undefined) {
        if (existing.projectId !== projectId) await setRootProject(existing.id, projectId);
      } else {
        const created = await addCodeRoot(chosen);
        await setRootProject(created.id, projectId);
      }
      setExplorerRefresh((token) => token + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
      void recordRecent(projectId);
    } catch (raw) {
      setNavError(`Could not add the folder: ${normalizeWorkspaceError(raw).message}`);
    } finally {
      setNavBusy(false);
    }
  }

  async function handleCreateProjectFromFolder() {
    if (!isNative) return;
    const before = selectionSnapshot();
    setNavBusy(true);
    setNavError(null);
    try {
      const result = await createProjectFromFolder({
        pickFolder: async () => {
          const chosen = await open({
            directory: true,
            multiple: false,
            title: "Create a project from a code folder",
          });
          return typeof chosen === "string" ? chosen : null;
        },
        createProject,
        renameProject: (projectId, expectedName, name) =>
          renameProject({ projectId, expectedName, name }),
        addCodeRoot,
        setRootProject,
      });
      if (result.cancelled) return;
      setExplorerRefresh((t) => t + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
      if (result.warnings.length > 0) {
        setNavError(result.warnings.join(" "));
      }
      if (sameSelection(before, selectionSnapshot())) {
        applySelection(
          { projectId: result.projectId, moduleId: null, requirementId: null, designId: null, mockupId: null, screenId: null },
          false,
        );
      }
    } catch (raw) {
      // Creating the project or the dialog failed: nothing to select.
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
          { projectId: pid, moduleId: created.id, requirementId: null, designId: null, mockupId: null, screenId: null },
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
          // The selection already resent `select` (clean): just adopt.
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
    const id =
      target.kind === "project"
        ? target.projectId
        : target.kind === "module"
          ? target.moduleId
          : target.artifactId;
    return `${target.projectId}/${target.kind}/${id}/${action}`;
  }

  function requestArchive(target: ArchiveTarget, action: ArchiveAction) {
    // One thing after another: the pending navigation resolves first.
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
        id:
          request.target.kind === "project"
            ? request.target.projectId
            : request.target.kind === "module"
              ? request.target.moduleId
              : request.target.artifactId,
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
    // Closing invalidates in-flight responses: a late one touches nothing.
    begin("archive", "");
    setArchiveRequest(null);
    setArchivePreview(null);
    setArchiveError(null);
  }

  function requestRename(target: RenameTarget) {
    // Renaming touches no drafts or content: opens directly, no guards.
    setRenameError(null);
    setRenameRequest(target);
  }

  /** Target from the open detail (real title, never a label). */
  function requestRenameDetail(kind: "requirement" | "design" | "mockup") {
    const current = kind === "requirement" ? detail : kind === "mockup" ? mockupDetail : designDetail;
    if (current === null || projectId === null || moduleId === null) return;
    const title = current.artifact.title;
    const version = kind === "requirement" ? currentVersion(current) : undefined;
    const derived =
      title === null && version !== undefined ? firstLine(version.content) || null : null;
    requestRename({
      // The diagrams command accepts mockups; presentation already said "mockup".
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
    // Closing invalidates the in-flight response: a late one touches nothing.
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
      // Confirmed success: refresh the tree and the visible detail. The
      // content draft stays intact (the title is not content) and no
      // impact needs recalculating (semantics intact).
      setExplorerRefresh((t) => t + 1);
      if (updated !== null) {
        if (detail?.artifact.id === updated.artifact.id) setDetail(updated);
        if (designDetail?.artifact.id === updated.artifact.id) setDesignDetail(updated);
        if (mockupDetail?.artifact.id === updated.artifact.id) setMockupDetail(updated);
      }
      setRenameRequest(null);
    } catch (raw) {
      if (!isFresh("rename", key, epoch)) return;
      // Failure: the dialog keeps the previous name and allows retrying.
      const err = normalizeCoreError(raw);
      if (err.kind === STALE_NAME) {
        // The live name changed elsewhere: refresh so reopening the dialog
        // gets a fresh `expected`, and ask for an explicit retry.
        setExplorerRefresh((t) => t + 1);
        setRenameError(`${err.message} Close and reopen to see the live name.`);
      } else {
        setRenameError(err.message);
      }
    } finally {
      if (isFresh("rename", key, epoch)) setRenameBusy(false);
    }
  }

  /**
   * Central Save (Ctrl+S or header button): routes to the active editor
   * —requirement, design or mockup— through the existing transactional
   * flow. Without changes it never saves (never identical versions); a
   * failure keeps the draft and shows the error in its editor. Only manual
   * saves schedule the auto-update (never a proposal).
   */
  async function centralSave() {
    if (centralSaving.current || saveBusy || visualSave.busy || mockupSave.busy) return;
    // With an open document, Ctrl+S saves the active tab (independent path).
    if (centerDoc !== null) {
      centralSaving.current = true;
      try {
        await codeSaveRef.current?.saveActive();
      } finally {
        centralSaving.current = false;
      }
      return;
    }
    if (!isNative) {
      useRequirementsUi.getState().setLastSave({
        message: "Saving needs the desktop application.",
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
        message: "No changes to save.",
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
                message: `Requirement saved${saved ? ` (v${saved.number})` : ""}.`,
                kind: "ok",
                at: Date.now(),
              }
            : {
                message: "Could not save the requirement: check the error.",
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
            error: "State the authorship to save the design.",
          });
          useRequirementsUi.getState().setLastSave({
            message: "Missing authorship to save the design.",
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
                message: `Design saved${saved ? ` (v${saved.number})` : ""}.`,
                kind: "ok",
                at: Date.now(),
              }
            : {
                message: "Could not save the design: check the error.",
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
            error: "State the authorship to save the mockup.",
          });
          useRequirementsUi.getState().setLastSave({
            message: "Missing authorship to save the mockup.",
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
                message: `Mockup saved${saved ? ` (v${saved.number})` : ""}.`,
                kind: "ok",
                at: Date.now(),
              }
            : {
                message: "Could not save the mockup: check the error.",
                kind: "error",
                at: Date.now(),
              },
        );
        // Like requirements and designs: the manual save schedules the
        // module's optional auto-update (batched, no recursion).
        if (ok && projectId !== null && moduleId !== null) {
          scheduleAuto(moduleKey(projectId, moduleId));
        }
      }
    } finally {
      centralSaving.current = false;
    }
  }

  /**
   * Save-all (export gate): saves every draft document in sequence,
   * through its transactional flows. Reports via `resolveSaveAll`; a
   * failure discards nothing and leaves its error in the document.
   * Never invents authorship: when missing, it says so.
   */
  async function runSaveAll(): Promise<void> {
    const ui = useRequirementsUi.getState();
    if (saveAllBusy.current) return;
    saveAllBusy.current = true;
    try {
      const failures: string[] = [];
      if (requirementId !== null && draft.dirty) {
        const ok = await performSave();
        if (!ok) failures.push(useRequirementsUi.getState().docStatus[docKey("req", requirementId)]?.label ?? "requirement");
      }
      const designDirty = visual === null ? false : visualSemanticDirty(visual) || visualLayoutDirty(visual);
      if (designId !== null && designDirty) {
        if (saveAuthor.trim() === "") {
          setVisualSave({ busy: false, error: "State the authorship to save the design." });
          failures.push("design (missing authorship)");
        } else {
          const semantic = visual === null ? false : visualSemanticDirty(visual);
          const ok = semantic
            ? await performVisualSave(saveAuthor.trim())
            : await performVisualLayoutSave();
          if (!ok) failures.push("design");
        }
      }
      const mockupDirty = mockup === null ? false : mockupSemanticDirty(mockup) || mockupLayoutDirty(mockup);
      if (mockupId !== null && mockupDirty) {
        if (saveAuthor.trim() === "") {
          setMockupSave({ busy: false, error: "State the authorship to save the mockup." });
          failures.push("mockup (missing authorship)");
        } else {
          const semantic = mockup === null ? false : mockupSemanticDirty(mockup);
          const ok = semantic
            ? await performMockupSave(saveAuthor.trim())
            : await performMockupLayoutSave();
          if (!ok) failures.push("mockup");
        }
      }
      if (codeSaveRef.current !== null) {
        failures.push(...(await codeSaveRef.current.saveAll()));
      }
      ui.resolveSaveAll(
        failures.length === 0
          ? { ok: true, message: "Everything saved.", at: Date.now() }
          : { ok: false, message: `Could not save: ${failures.join(", ")}.`, at: Date.now() },
      );
    } finally {
      saveAllBusy.current = false;
    }
  }

  /**
   * Schedules the module auto-update after a manual save. Batches
   * consecutive saves: each new schedule replaces the previous one and
   * only the last pending one survives.
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
   * Runs the auto-update: proposes updating (one by one, 5 per cycle at
   * most) the module's stale designs, from already persisted versions.
   * Results go to separate proposals; on failure, the save still stands.
   * No recursion: accepting or proposing never schedules another run.
   */
  async function runAuto(key: string) {
    // One simultaneous run per module: new arrivals merge into a single
    // later retry, never into an endless queue.
    if (autoInflight.current) {
      autoRerun.current = true;
      return;
    }
    // When the person switched modules, the pending one is dropped: the
    // visible data is no longer the scheduling save's.
    const data = autoDataRef.current;
    if (
      data.projectId === null ||
      data.moduleId === null ||
      moduleKey(data.projectId, data.moduleId) !== key
    ) {
      return;
    }
    autoInflight.current = true;
    setAutoStatus({ moduleKey: key, message: "Looking for stale designs…", kind: "working" });
    try {
      const stale = data.activeDesigns.filter(
        (a) =>
          (a.kind === "flow" || a.kind === "data_model") &&
          data.selectedGraph?.index?.freshness[a.id]?.stale === true,
      );
      if (stale.length === 0) {
        setAutoStatus({ moduleKey: key, message: "Everything current: nothing to propose.", kind: "ok" });
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
      const extra = stale.length > batch.length ? ` (+${stale.length - batch.length} pending)` : "";
      const tokensText = tokensKnown ? ` · ${tokens} tokens` : "";
      if (failed === 0) {
        setAutoStatus({
          moduleKey: key,
          message: `Auto-AI: ${done} proposal${done === 1 ? "" : "s"} ready in Impact${extra}${tokensText}.`,
          kind: "ok",
        });
      } else {
        setAutoStatus({
          moduleKey: key,
          message: `Auto-AI: ${done} ready, ${failed} failed${extra}. The save is safe.`,
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
      if (target.kind === "project") {
        // Projects are never archived: only deleted when empty and loose.
        if (action !== "delete") {
          setArchiveError("Projects are only deleted; never archived or restored.");
          return;
        }
        await deleteProject({ projectId: target.projectId });
      } else if (target.kind === "module") {
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
      // Confirmed success: refresh, clear what is incompatible, and close.
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
      if (updated !== null && detail?.artifact.id === updated.artifact.id) {
        setDetail(updated);
      }
      if (action === "delete") {
        applySelection(selectionAfterDelete(selectionSnapshot(), target), false, false, null);
        // The impact origin may have vanished with the requirement;
        // with the project, it surely did.
        if (
          target.kind === "project" ||
          (target.kind === "requirement" && impactOrigin === target.artifactId)
        ) {
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
      // Failure: the dialog keeps the summary; selection and drafts intact.
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
          setArchiveError("State the authorship to save the version.");
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
          setArchiveError("State the authorship to save the version.");
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
        setArchiveError("State the authorship to save the version.");
        return;
      }
      const ok = await performSave();
      if (!ok) return;
    }
    proceedAfterArchiveSave();
  }

  // As in navigation: after the requirement, the visual may still ask
  // for its turn, and after the visual, the mockup.
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
      // Discard without switching selection: resync with the detail.
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
      // New version: links and freshness re-derive.
      setExplorerRefresh((t) => t + 1);
      bumpImpact();
      return true;
    } catch (raw) {
      const err = normalizeCoreError(raw);
      dispatchDraft({ type: "saveFailed" });
      if (err.kind === STALE_VERSION) {
        setSaveError(
          `${err.message} The current version was updated: review it and save again. The draft is kept.`,
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
        setApproveError(`${err.message} The current version was updated: review it.`);
        void loadDetail(detail.artifact.id);
      } else {
        setApproveError(err.message);
      }
    } finally {
      setApproveBusy(false);
    }
  }

  /** Changes-dialog presentation for the protected draft. */
  function dialogSubjectId(pending: PendingNav): string | null {
    if (pending.draft === "visual") return designId;
    if (pending.draft === "mockup") return mockupId;
    return requirementId;
  }

  function dialogSubjectLabel(pending: PendingNav): string {
    if (pending.draft === "visual") return `design ${designId}`;
    if (pending.draft === "mockup") return `mockup ${mockupId}`;
    return `requirement ${requirementId}`;
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
    if (kind === "visual") return `design ${designId}`;
    if (kind === "mockup") return `mockup ${mockupId}`;
    return `requirement ${requirementId}`;
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
      setDialogError("State the authorship to save the version.");
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

  // After resolving the requirement, the visual draft may still ask for
  // its turn, and after the visual, the mockup: a changed design is never
  // left without offering to save it.
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
        setDialogError("State the authorship to save the version.");
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
        setDialogError("State the authorship to save the version.");
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
    // Diverged (current moved under the draft): the editor's conflict
    // panel decides, not a blind save.
    if (visual.key !== `${designDetail.artifact.id}:${current.id}`) return false;
    if (!visualSemanticDirty(visual)) return false;
    let spec: unknown;
    try {
      spec = JSON.parse(visual.history.present) as unknown;
    } catch {
      setVisualSave({ busy: false, error: "The draft is not valid JSON." });
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
      // Only clears when nothing was edited during the request (when edited,
      // the draft stays and the advanced detail marks it diverged).
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
          error: `${err.message} The current version was updated: review it.`,
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
    // Diverged (current moved under the draft): the editor's conflict
    // panel decides, not a blind save.
    if (mockup.key !== `${mockupDetail.artifact.id}:${current.id}`) return false;
    if (!mockupSemanticDirty(mockup)) return false;
    let spec: unknown;
    try {
      spec = JSON.parse(mockup.history.present) as unknown;
    } catch {
      setMockupSave({ busy: false, error: "The draft is not valid JSON." });
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
          error: `${err.message} The current version was updated: review it.`,
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
    // Opening the new mockup keeps requirement and design in context.
    requestSelect(
      withMockup(selectionSnapshot(), projectId, moduleId, created.artifact.id),
      false,
      false,
      "mockups",
    );
  }

  function handleProposalAccepted(detail: RequirementDetail) {
    // The panel stays open: only refresh the browser with the created
    // requirement, without moving the selection or touching drafts.
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
      // Keeps the design in context; the caller picks the view.
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
      // Keeps the requirement in context.
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
      // Keeps requirement and design in context.
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
    // Real navigation with the usual draft protection; the map keeps
    // its context when returning to the tab.
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
        setDesignApproveError(`${err.message} The current version was updated: review it.`);
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
      // The designs command revalidates the mockup in Rust and approves.
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
        setMockupApproveError(`${err.message} The current version was updated: review it.`);
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
      <section className="panel" aria-label="Requirements">
        <h2>Requirements</h2>
        <p className="notice">
          You are in a browser. Creating and reviewing requirements is native and
          requires running Ruth IDE as a desktop application (Tauri). No saving
          or approval is simulated.
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

  // The banner only interrupts while checking or on failure; while
  // running, the state lives in the bottom bar without pushing content.
  const banner =
    storage === null ? (
      <p className="store-banner" role="note">
        Checking local storage…
      </p>
    ) : storage.ready ? null : (
      <p className="store-banner error" role="alert">
        Could not open the local database: {storage.message ?? "unknown error"}{" "}
        Nothing was deleted or replaced.
        {storage.dbPath ? <> Path: {storage.dbPath}.</> : null} Check the path and
        permissions, close another Ruth IDE instance if one is open, and reopen.
      </p>
    );

  if (storage !== null && !storage.ready) {
    return (
      <section className="workbench" aria-label="Requirements space">
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

  const workspaceOpen = centerView !== "welcome";
  const terminalMaximized = useRequirementsUi((s) => s.terminalMaximized);
  const associatedRoots = projectId === null ? [] : codeRoots.filter((root) => root.projectId === projectId);

  return (
    <section
      className={`workbench${terminalMaximized && showTerminal ? " terminal-max" : ""}`}
      aria-label="Workspace"
    >
      {banner}
      {workspaceOpen && (
        <div className="workspace-bar">
          <WorkspaceSelector
            label={projectName ?? projectId ?? "Workspace"}
            sublabel={
              associatedRoots.length === 0
                ? "No folders yet"
                : `${associatedRoots.length} folder${associatedRoots.length === 1 ? "" : "s"}`
            }
            recents={recents}
            busy={welcomeBusy}
            onOpenProject={guardedOpenProject}
            onNewProject={guardedNewProject}
            onOpenRecent={(recent) => void guardedOpenRecent(recent)}
            onSwitchWorkspace={guardedCloseWorkspace}
            onCloseWorkspace={guardedCloseWorkspace}
          />
        </div>
      )}
      {/* The provider always stays mounted: tabs and drafts survive
          perspective switches and closing (drafts revert, tabs stay). */}
      <CodeWorkspaceProvider
        saveApiRef={codeSaveRef}
        onDocStatus={setCodeDocStatus}
        visible={centerDoc !== null}
      >
      {centerView === "welcome" ? (
        <WelcomeScreen
          recents={recents}
          recentsLoading={recentsLoading}
          recentsError={recentsError}
          busy={welcomeBusy}
          busyRecentId={busyRecentId}
          error={welcomeError}
          onOpenProject={guardedOpenProject}
          onOpenRecent={(recent) => void guardedOpenRecent(recent)}
          onRemoveRecent={(id) => void handleRemoveRecent(id)}
          onNewProject={guardedNewProject}
          onRetryRecents={() => void loadRecents()}
        />
      ) : (
      <div
        className={`workbench-grid${showRight ? "" : " no-right"}`}
        style={
          {
            // Stored sizes never crush the center on a smaller screen:
            // each side clamps to a viewport share (34vw ≈ 299px at the
            // 880px minimum, no effective limit at 1366px and above).
            ...(navigatorWidth === null ? {} : { "--nav-width": `min(${navigatorWidth}px, 34vw)` }),
            ...(rightWidth === null ? {} : { "--right-width": `min(${rightWidth}px, 34vw)` }),
          } as CSSProperties
        }
      >
        <div className="rail" aria-label="Panels">
          <button
            type="button"
            className={showNavigator ? "active" : ""}
            onClick={() => togglePanel("navigator")}
            aria-pressed={showNavigator}
            title={showNavigator ? "Hide navigator" : "Show navigator"}
            aria-label={showNavigator ? "Hide navigator" : "Show navigator"}
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
            title={showReview ? "Hide review" : "Show review"}
            aria-label={showReview ? "Hide review" : "Show review"}
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
            title={showAssistant ? "Hide assistant" : "Show assistant"}
            aria-label={showAssistant ? "Hide assistant" : "Show assistant"}
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
            title={showTerminal ? "Hide terminal" : "Show terminal"}
            aria-label={showTerminal ? "Hide terminal" : "Show terminal"}
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
          <button
            type="button"
            onClick={() => useRequirementsUi.getState().resetLayout()}
            title="Reset layout (panel sizes and terminal restore)"
            aria-label="Reset layout"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9 M13.5 1.5v3h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {/* Single explorer: projects/design above, code folders below.
            Both stay mounted (hidden, not unmounted) to keep expansion
            and caches. */}
        <div className="nav-slot">
        <ExplorerPanel
          hidden={!showNavigator}
          storageReady={storageReady}
          selection={{ projectId, moduleId, requirementId, designId, mockupId, screenId }}
          refreshToken={explorerRefresh}
          busy={navBusyAll}
          globalError={navError}
          meta={artifactMeta}
          onSelectProject={(id) => {
            if (id !== projectId) {
              requestSelect(
                { projectId: id, moduleId: null, requirementId: null, designId: null, mockupId: null, screenId: null },
                false,
              );
            }
          }}
          onSelectModule={(pid, id) => {
            if (id !== moduleId || pid !== projectId) {
              // Switching modules clears another module's artifacts.
              requestSelect(
                { projectId: pid, moduleId: id, requirementId: null, designId: null, mockupId: null, screenId: null },
                false,
              );
            }
          }}
          onSelectRequirement={(pid, mid, id) => {
            if (id !== requirementId || mid !== moduleId || pid !== projectId) {
              // Opening the requirement keeps design and mockup in context.
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
              // Opening the design keeps requirement and mockup in context.
              requestSelect(withDesign(selectionSnapshot(), pid, mid, id), false, false, "design");
            }
          }}
          onSelectMockup={(pid, mid, id) => {
            if (id !== mockupId || mid !== moduleId || pid !== projectId) {
              // Opening the mockup keeps requirement and design in context.
              requestSelect(withMockup(selectionSnapshot(), pid, mid, id), false, false, "mockups");
            }
          }}
          onSelectScreen={(pid, mid, id, screen) => {
            if (id !== mockupId || screen !== screenId || mid !== moduleId || pid !== projectId) {
              // Opening the screen opens the same artifact on that screen.
              requestSelect(withScreen(selectionSnapshot(), pid, mid, id, screen), false, false, "mockups");
            }
          }}
          onCreateProject={() => void handleCreateProject()}
          onCreateProjectFromFolder={isNative ? () => void handleCreateProjectFromFolder() : undefined}
          onCreateModule={(pid) => void handleCreateModule(pid)}
          onNewRequirement={(pid, mid) => {
            requestSelect(
              { projectId: pid, moduleId: mid, requirementId: null, designId: null, mockupId: null, screenId: null },
              true,
            );
          }}
          onProposeRequirements={(pid, mid) => {
            requestSelect(
              { projectId: pid, moduleId: mid, requirementId: null, designId: null, mockupId: null, screenId: null },
              false,
              true,
            );
          }}
          onNewMockup={(pid, mid) => {
            // Go to Mockups with the chosen module; the form lives there.
            requestSelect(
              { projectId: pid, moduleId: mid, requirementId: null, designId: null, mockupId: null, screenId: null },
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
        <nav
          className="navigator"
          aria-label="Code folders"
          hidden={!showNavigator}
        >
          <CodeTreePane />
        </nav>
        {showNavigator && <NavResizeHandle />}
        </div>

        <div
          className={`workbench-center${
            centerDoc !== null
              ? " code-view"
              : centerView === "architecture"
                ? " architecture-view"
                : ""
          }`}
        >
          <PerspectiveTabs
            centerView={centerView}
            ready={projectId !== null && moduleId !== null}
            projectReady={projectId !== null}
            onSelect={requestTab}
          />
          {centerDoc !== null ? (
            <CodeMainPane />
          ) : (
            <>
              <CodeMainPane bare tabsOnly />
              {centerView === "overview" ? (
                projectId === null ? (
                  <p className="hint">Open a project to see its overview.</p>
                ) : (
                  <OverviewView
                    projectId={projectId}
                    projectName={projectName ?? projectId}
                    roots={codeRoots}
                    onOpenArchitecture={() => requestTab("architecture")}
                    onAddFolder={() => void handleAddFolder()}
                  />
                )
              ) : centerView === "architecture" ? (
                <ArchitectureView />
              ) : centerView === "requirements" ? (
            detailBusy && detail === null ? (
              <p className="hint">Loading requirement…</p>
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
                    Archived module: restore it to create requirements.
                  </p>
                  <button type="button" className="secondary" onClick={() => setCreating(false)}>
                    Close
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
            ) : moduleId === null ? (
              <p className="hint">Select a project and a module.</p>
            ) : (
              <div>
                <p className="hint">Select a requirement or create a new one.</p>
                {isNative && (
                  <ModuleCodeLinks
                    moduleId={moduleId}
                    moduleName={selectedModuleName}
                    archived={moduleArchived}
                  />
                )}
              </div>
            )
          ) : centerView === "impact" ? (
            moduleId === null || projectId === null ? (
              <p className="hint">Select a project and a module.</p>
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
              <p className="hint">Select a project and a module.</p>
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
              <p className="hint">Loading mockup…</p>
            ) : mockupDetailError !== null && mockupDetail === null ? (
              <p className="error" role="alert">
                {mockupDetailError}
              </p>
            ) : mockupDetail !== null ? (
              <div>
                {mockupArchived && (
                  <p className="notice" role="note">
                    Archived mockup: read-only; restore it to edit.
                  </p>
                )}
                <MockupDetail
                  detail={mockupDetail}
                  viewing={viewingMockup}
                  onBackToCurrent={() => setViewingMockupVersionId(null)}
                  onValidatedVersion={(versionId, ok) => setMockupValidated({ versionId, ok })}
                  onRename={() => requestRenameDetail("mockup")}
                  renameDisabled={mockupArchived}
                  screenId={screenId}
                  onScreenChange={(id) => {
                    const ui = useRequirementsUi.getState();
                    if (ui.selection.screenId !== id) {
                      ui.setSelection({ ...ui.selection, screenId: id });
                    }
                  }}
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
              <p className="hint">Select a project and a module.</p>
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
            <p className="hint">Loading design…</p>
          ) : designDetailError !== null && designDetail === null ? (
            <p className="error" role="alert">
              {designDetailError}
            </p>
          ) : designDetail !== null ? (
            <div>
              {designArchived && (
                <p className="notice" role="note">
                  Archived design: read-only; restore it to edit.
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
          ) : centerView === "traceability" ? (
            moduleId === null || projectId === null ? (
              <p className="hint">Select a project and a module.</p>
            ) : (
              <TraceView
                projectId={projectId}
                moduleId={moduleId}
                moduleName={selectedModuleName}
                onOpenArtifact={(artifact) => {
                  if (artifact.kind === "requirement") handleOpenRequirement(artifact.id);
                  else if (artifact.kind === "mockup") handleOpenMockup(artifact.id);
                  else handleOpenDesign(artifact.id);
                }}
              />
            )
          ) : null}
            </>
          )}
        </div>

        {showRight && (
          <div className="right-column">
            <RightResizeHandle />
            <div className="right-tabs" role="tablist" aria-label="Right column">
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "review"}
                className={rightTab === "review" ? "active" : ""}
                onClick={() => showRightTab("review")}
              >
                Review
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === "assistant"}
                className={rightTab === "assistant" ? "active" : ""}
                onClick={() => showRightTab("assistant")}
              >
                Assistant
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
                <p className="hint">Select a project and a module.</p>
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
      )}
      </CodeWorkspaceProvider>

      <TerminalPanel visible={showTerminal && workspaceOpen} onHide={() => togglePanel("terminal")} />

      {closeGate !== null && (
        <WorkspaceCloseDialog
          dirtyLabels={closeGate.dirtyLabels}
          terminalCount={closeGate.terminalCount}
          terminalCwds={closeGate.terminalCwds}
          terminalsUnknown={closeGate.terminalsUnknown}
          saving={closeGate.saving}
          saveError={closeGate.saveError}
          onSaveAndClose={() => void handleSaveAndClose()}
          onCloseWithoutSaving={handleCloseWithoutSaving}
          onCancel={handleCancelClose}
        />
      )}

      <footer className="statusbar" aria-label="Status">
        <span className="status-left">
          <span className={`save-dot ${saveStateValue}`} aria-hidden="true" />
          {saveLabel ?? "Local persistence active"}
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
 * Handle to adjust the right column width (mouse or keyboard). Mirrors
 * the explorer's, on the other side: dragging left widens.
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
      aria-label="Adjust the right column width"
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
          const delta =
            e.key === "ArrowLeft" ? RESIZE_KEYBOARD_STEP_PX : -RESIZE_KEYBOARD_STEP_PX;
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
