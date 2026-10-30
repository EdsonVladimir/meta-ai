// Top-level project maps: one automatic board per detected code
// project (or per folder when a root holds none) of the selected
// project. The Architecture scope (joint view, one project, or one
// explicit folder) comes from the tree; visibility eyes live in the
// tree too. Saved content only; drafts warn. Cards open a single
// shared inspector; symbols show their relations with evidence.
//
// The canvas owns its compact toolbar (module filter, search,
// layer/edge menus, grouping, details) and a bottom status bar
// with aggregated coverage, so headers never steal board space.
import { useEffect, useMemo, useRef, useState } from "react";
import { fnv1aHex } from "../model";
import { listCodeDir, listProjectLinks, normalizeCodeError, readCodeFile } from "../client";
import type { CodeFileDto, CodeRootDto, CodeTab } from "../types";
import { listModules } from "../../requirements/client";
import { defaultAnalyzeTs } from "../structure/tsWorkerClient";
import { combineResults, emptyResult } from "../structure/structureMerge";
import {
  STRUCTURE_LIMITS,
  type StructureInput,
  type StructureRelation,
  type StructureResult,
  type StructureSymbol,
} from "../structure/structureTypes";
import {
  MAX_ARCH_INSPECTOR_WIDTH,
  DEFAULT_ARCH_INSPECTOR_WIDTH,
  MIN_ARCH_INSPECTOR_WIDTH,
  RESIZE_KEYBOARD_STEP_PX,
  useRequirementsUi,
  type ArchScope,
} from "../../requirements/uiStore";
import {
  discoverRootProjects,
  type DetectedCodeProject,
  type RootProjects,
} from "../detectProjects";
import type { ArchLayer } from "./archLayers";
import {
  buildArchMap,
  MAX_MAP_EDGES,
  MAX_MAP_FILES,
  MAX_MAP_SYMBOL_EDGES,
  MAX_MAP_SYMBOLS,
  type ArchMap,
  type ArchMapEdge,
  type ArchMapFile,
  type ArchMapNode,
} from "./archModel";
import {
  DEFAULT_EDGE_OPTS,
  emptyExpansion,
  fileKey,
  layoutBoard,
  layoutSymbolBoard,
  type BoardEdgeOpts,
  type BoardExpansion,
} from "./boardLayout";
import { ArchMapBoard, countLabel } from "./ArchMapBoard";
import { ArchSymbolBoard } from "./ArchSymbolBoard";
import { BoardViewport } from "./BoardViewport";
import { ArchMapInspector, type SymbolRef } from "./ArchMapInspector";
import { FlowBoard } from "./FlowBoard";
import { layoutFlowBoard, type FlowLayout } from "./flowLayout";
import { FlowInspector } from "./FlowInspector";
import {
  buildFlowGraph,
  type FlowGraph,
  type FlowProject,
  type FlowStart,
} from "./flowModel";
import {
  ArchitectureToolbar,
  type ToolbarDetailRow,
  type ToolbarHiddenEntry,
} from "./ArchitectureToolbar";
import {
  buildModuleIndex,
  moduleReferenceIds,
  resolveManualModules,
  type ManualModule,
  type ModuleSource,
} from "./codeModules";
import {
  allLayersOn,
  effectiveLayer,
  filterMapColumns,
  filterSymbolNodes,
  type EffectiveLayer,
  type FilteredMap,
  type FilteredSymbols,
} from "./mapFilter";
import {
  collectTsScope,
  PROJECT_MAP_MAX_FILES,
  rootsOfProject,
  type ListDirFn,
} from "./projectMaps";
import { publishAnalysisSummary } from "../../workspace/analysisCache";

export interface ProjectMapDeps {
  listDir: ListDirFn;
  readFile: (rootId: string, rel: string) => Promise<CodeFileDto>;
  analyzeTs: (files: StructureInput[]) => Promise<StructureResult>;
  /** Existing manual module↔code associations (absent = none offered). */
  loadManualModules?: (projectId: string) => Promise<ManualModule[]>;
}

const REAL_DEPS: ProjectMapDeps = {
  listDir: (rootId, rel) => listCodeDir(rootId, rel),
  readFile: (rootId, rel) => readCodeFile(rootId, rel),
  analyzeTs: (files) => defaultAnalyzeTs(files),
  loadManualModules: async (projectId) => {
    const [mods, links] = await Promise.all([
      listModules(projectId),
      listProjectLinks(projectId),
    ]);
    return resolveManualModules(mods, links.moduleLinks);
  },
};

/** Files added to the collection cap on each "Load more files". */
export const MAP_LOAD_MORE_STEP = 200;
/**
 * Files analyzed per call: the analyzer truncates each call past its
 * file cap, so scopes continue in explicit batches instead.
 */
export const MAP_ANALYZE_BATCH = STRUCTURE_LIMITS.maxFiles;

type SectionStatus =
  | "collecting"
  | "reading"
  | "analyzing"
  | "ready"
  | "error"
  | "cancelled";

interface SectionMapState {
  status: SectionStatus;
  /** Retry generation this state belongs to (cached maps survive toggles). */
  nonce: number;
  /** Collection cap this state was built with. */
  cap: number;
  /** Analysis batches accumulated in this state. */
  batches: number;
  map: ArchMap | null;
  relations: StructureRelation[];
  symbolIndex: Map<string, SymbolRef>;
  /** Files the map was built from (for honest draft warnings). */
  rels: string[];
  collected: number;
  collectTruncated: boolean;
  collectTruncatedBy: "files" | "dirs" | "listing" | null;
  excludedSubtrees: number;
  skippedDirs: number;
  symbolsTruncated: boolean;
  relationsTruncated: boolean;
  error: string | null;
}

/** One analyzed board: a detected project, a folder, or a whole root. */
export interface MapSection {
  key: string;
  root: CodeRootDto;
  /** Analyzed folder relative to the root (`""` is the whole root). */
  rel: string;
  title: string;
  kind: "project" | "folder" | "implicit";
  project: DetectedCodeProject | null;
  analyzer: "ts" | "none";
  /** Nested project subtrees excluded from this section. */
  excludeRels: string[];
}

interface ProjectMapViewProps {
  projectId: string;
  roots: CodeRootDto[];
  hidden: Record<string, boolean>;
  onToggleRoot: (rootId: string) => void;
  tabs: CodeTab[];
  /** Global board filters (Architecture toolbar); all on when absent. */
  layersOn?: Record<ArchLayer, boolean>;
  query?: string;
  showTests?: boolean;
  showConfig?: boolean;
  edgeOpts?: BoardEdgeOpts;
  /** Board zoom level (CSS zoom over layout-constant geometry). */
  zoom?: number;
  /** Zoom setter (wheel zoom and Fit; absent = display only). */
  onZoomChange?: (zoom: number) => void;
  /** Card granularity: symbol cards, or files as a secondary view. */
  groupBy?: "symbols" | "files";
  deps?: ProjectMapDeps;
  /** Active Architecture scope (joint view, project, or folder). */
  scope: ArchScope;
  onScopeChange: (scope: ArchScope) => void;
  /** Detected projects hidden from the joint view, by scope key. */
  hiddenProjects: Record<string, boolean>;
  onShowAllProjects: () => void;
  /** Restores one hidden project (Details panel; absent = Show all only). */
  onToggleProject?: (key: string) => void;
}

function baseName(rel: string): string {
  const slash = rel.lastIndexOf("/");
  return slash === -1 ? rel : rel.slice(slash + 1);
}

/** Flow projects from analyzed sections (titles as labels, merged results as input). */
export function flowProjectsOf(
  sections: MapSection[],
  merged: Record<string, { result: StructureResult }>,
): FlowProject[] {
  const projects: FlowProject[] = [];
  for (const section of sections) {
    const found = merged[section.key];
    if (found === undefined) continue;
    projects.push({ key: section.key, label: section.title, result: found.result });
  }
  return projects;
}

export function indexSymbols(symbols: StructureSymbol[]): Map<string, SymbolRef> {
  const index = new Map<string, SymbolRef>();
  for (const symbol of symbols) {
    index.set(symbol.id, {
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      rel: symbol.rel,
      rootId: symbol.rootId,
    });
  }
  return index;
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

interface InspectorData {
  /** Section the selection belongs to. */
  sectionKey: string;
  file: ArchMapFile;
  /** The selected symbol card, when the selection came from the symbol board. */
  node: ArchMapNode | null;
  edges: ArchMapEdge[];
  relations: StructureRelation[];
  symbolIndex: Map<string, SymbolRef>;
}

function findInspectorData(
  sections: MapSection[],
  states: Record<string, SectionMapState>,
  selectedKey: string | null,
  selectedSymbolId: string | null,
): InspectorData | null {
  if (selectedKey === null) return null;
  for (const section of sections) {
    const map = states[section.key]?.map ?? null;
    if (map === null) continue;
    const file = map.files.find((entry) => fileKey(entry.rootId, entry.rel) === selectedKey);
    if (file === undefined) continue;
    const state = states[section.key];
    const node =
      selectedSymbolId === null
        ? null
        : (map.nodes.find((entry) => entry.id === selectedSymbolId) ?? null);
    return {
      sectionKey: section.key,
      file,
      node,
      edges: map.edges,
      relations: state.relations,
      symbolIndex: state.symbolIndex,
    };
  }
  return null;
}

export function ProjectMapView({
  projectId,
  roots,
  hidden,
  onToggleRoot,
  tabs,
  layersOn,
  query,
  showTests,
  showConfig,
  edgeOpts,
  zoom,
  onZoomChange,
  groupBy,
  deps,
  scope,
  onScopeChange,
  hiddenProjects,
  onShowAllProjects,
  onToggleProject,
}: ProjectMapViewProps) {
  // Canvas filters live here (the toolbar renders here too). Provided
  // props pin values from the outside (tests, embeds); otherwise the
  // view owns them, so nothing above the canvas has to care.
  const [innerLayers, setInnerLayers] = useState<Record<ArchLayer, boolean>>(allLayersOn);
  const [innerQuery, setInnerQuery] = useState("");
  const [innerTests, setInnerTests] = useState(true);
  const [innerConfig, setInnerConfig] = useState(true);
  const [innerEdgeOpts, setInnerEdgeOpts] = useState<BoardEdgeOpts>(DEFAULT_EDGE_OPTS);
  const [innerGroupBy, setInnerGroupBy] = useState<"symbols" | "files">("symbols");
  const [innerZoom, setInnerZoom] = useState(1);
  const activeLayers = layersOn ?? innerLayers;
  const activeQuery = query ?? innerQuery;
  const activeShowTests = showTests ?? innerTests;
  const activeShowConfig = showConfig ?? innerConfig;
  const activeEdgeOpts = edgeOpts ?? innerEdgeOpts;
  const activeGroupBy = groupBy ?? innerGroupBy;
  const activeZoom = zoom ?? innerZoom;
  const layerOverrides = useRequirementsUi((s) => s.layerOverrides);
  // The module filter survives perspective switches (session-only):
  // re-picking it after every return would punish exploration.
  const archModule = useRequirementsUi((s) => s.archModule);
  const setArchModule = useRequirementsUi((s) => s.setArchModule);
  const showExternal = useRequirementsUi((s) => s.archShowExternalRefs);
  const setShowExternal = useRequirementsUi((s) => s.setArchShowExternalRefs);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [manualModules, setManualModules] = useState<ManualModule[]>([]);
  const [manualState, setManualState] = useState<"loading" | "ready" | "error">("loading");
  const projectRoots = useMemo(() => rootsOfProject(roots, projectId), [roots, projectId]);
  const visibleRoots = useMemo(
    () => projectRoots.filter((root) => hidden[root.id] !== true),
    [projectRoots, hidden],
  );
  const [discovered, setDiscovered] = useState<Record<string, RootProjects>>({});
  const [states, setStates] = useState<Record<string, SectionMapState>>({});
  /** One selection for the whole view (a single shared inspector). */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSymbolId, setSelectedSymbolIdRaw] = useState<string | null>(null);
  /** Member row of the selected symbol shown in the inspector (index). */
  const [selectedMember, setSelectedMember] = useState<number | null>(null);
  const setSelectedSymbolId = (id: string | null): void => {
    setSelectedSymbolIdRaw(id);
    setSelectedMember(null);
  };
  /** Flow mode entry (null = boards); the chip leaves it. */
  const [flowStart, setFlowStart] = useState<FlowStart | null>(null);
  /** Flow board selection (node + optional member). */
  const [flowSelected, setFlowSelected] = useState<{
    nodeId: string;
    member: string | null;
  } | null>(null);
  /** Expansion is keyed by globally unique ids, so it survives project switches. */
  const [expansion, setExpansion] = useState<BoardExpansion>(emptyExpansion);
  /** Symbol cards with their member list collapsed (open by default). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [retryNonce, setRetryNonce] = useState<Record<string, number>>({});
  const [fileCaps, setFileCaps] = useState<Record<string, number>>({});
  const [batchCount, setBatchCount] = useState<Record<string, number>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const depsRef = useRef(deps ?? REAL_DEPS);
  depsRef.current = deps ?? REAL_DEPS;
  const epochRef = useRef(0);
  /** Per-section run token: cancel abandons only its own section. */
  const tokenRef = useRef<Record<string, number>>({});
  /** Accumulated batch results per section (reset on retry/scope change). */
  const mergedRef = useRef<Record<string, { nonce: number; batches: number; result: StructureResult }>>(
    {},
  );

  // The tree lists every workspace root, so the scoped root joins
  // discovery even when it is not associated with this project.
  const scopeRootId = scope.kind === "all" ? null : scope.rootId;
  const discoveryRoots = useMemo(() => {
    if (scopeRootId === null) return projectRoots;
    if (projectRoots.some((root) => root.id === scopeRootId)) return projectRoots;
    const extra = roots.find((root) => root.id === scopeRootId) ?? null;
    return extra === null ? projectRoots : [...projectRoots, extra];
  }, [projectRoots, roots, scopeRootId]);
  const discoverySig = discoveryRoots.map((root) => root.id).join(",");

  // Nested project discovery per root (manifest names + small reads
  // only; never runs project code). Cached per session.
  useEffect(() => {
    let stale = false;
    const sniff = {
      listDir: (rootId: string, rel: string) => depsRef.current.listDir(rootId, rel),
      readFile: (rootId: string, rel: string) => depsRef.current.readFile(rootId, rel),
    };
    for (const root of discoveryRoots) {
      if (root.missing) continue;
      void discoverRootProjects(root.id, root.name, sniff).then((found) => {
        if (stale) return;
        setDiscovered((prev) => {
          if (prev[root.id] === found) return prev;
          return { ...prev, [root.id]: found };
        });
      });
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, discoverySig]);

  // Existing manual module↔code associations for the filter. Absent
  // without a loader (tests); stale responses never land (projectId
  // run only, guarded).
  useEffect(() => {
    let stale = false;
    setManualModules([]);
    const loader = depsRef.current.loadManualModules;
    if (loader === undefined) {
      setManualState("ready");
      return;
    }
    setManualState("loading");
    void loader(projectId).then(
      (mods) => {
        if (stale) return;
        setManualModules(mods);
        setManualState("ready");
      },
      () => {
        if (!stale) setManualState("error");
      },
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const detectedAll = useMemo(
    () =>
      visibleRoots.flatMap((root) => discovered[root.id]?.projects ?? []).sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      ),
    [visibleRoots, discovered],
  );
  const detectionPending = projectRoots.some(
    (root) => !root.missing && discovered[root.id] === undefined,
  );

  const scopeIssue = useMemo((): string | null => {
    if (scope.kind === "all") return null;
    const root = roots.find((candidate) => candidate.id === scope.rootId) ?? null;
    if (root === null) return "The scoped folder is no longer in the workspace.";
    if (root.missing) return `The scoped folder "${root.name}" is no longer on disk.`;
    if (scope.kind === "project") {
      const found = discovered[root.id];
      if (found === undefined) return null;
      const match = found.projects.some((project) => project.rel === scope.rel);
      if (!match) return "The scoped project was not detected anymore.";
    }
    return null;
  }, [scope, roots, discovered]);

  const sections = useMemo((): MapSection[] => {
    if (scopeIssue !== null) return [];
    if (scope.kind === "project" || scope.kind === "folder") {
      const root = roots.find((candidate) => candidate.id === scope.rootId) ?? null;
      if (root === null || root.missing) return [];
      if (scope.kind === "project") {
        const found = discovered[root.id];
        if (found === undefined) return [];
        const project = found.projects.find((item) => item.rel === scope.rel) ?? null;
        if (project === null) return [];
        const nested = found.projects
          .filter((item) => item.rel !== project.rel && item.rel.startsWith(`${project.rel}/`))
          .map((item) => item.rel);
        return [
          {
            key: project.key,
            root,
            rel: project.rel,
            title: project.name,
            kind: "project",
            project,
            analyzer: project.analyzer,
            excludeRels: nested,
          },
        ];
      }
      return [
        {
          key: `${scope.rootId}::${scope.rel}`,
          root,
          rel: scope.rel,
          title: scope.rel === "" ? root.name : `${baseName(scope.rel)} (folder)`,
          kind: "folder",
          project: null,
          analyzer: "ts",
          excludeRels: [],
        },
      ];
    }
    const out: MapSection[] = [];
    for (const root of projectRoots) {
      if (root.missing) continue;
      // Hidden roots leave no section (their cached maps survive in
      // `states`, so un-hiding restores without re-analyzing); the
      // tree eye and the Details panel restore them.
      if (hidden[root.id] === true) continue;
      const found = discovered[root.id];
      if (found === undefined) continue;
      if (found.projects.length === 0) {
        out.push({
          key: `${root.id}::`,
          root,
          rel: "",
          title: root.name,
          kind: "implicit",
          project: null,
          analyzer: "ts",
          excludeRels: [],
        });
        continue;
      }
      for (const project of found.projects) {
        if (hiddenProjects[project.key] === true) continue;
        const nested = found.projects
          .filter((item) => item.rel !== project.rel && item.rel.startsWith(`${project.rel}/`))
          .map((item) => item.rel);
        out.push({
          key: project.key,
          root,
          rel: project.rel,
          title: project.name,
          kind: "project",
          project,
          analyzer: project.analyzer,
          excludeRels: nested,
        });
      }
    }
    return out;
  }, [scope, scopeIssue, roots, projectRoots, discovered, hidden, hiddenProjects]);

  const visibleSig = sections.map((section) => section.key).join(",");
  const retrySig = sections
    .map(
      (section) =>
        `${section.key}@${fileCaps[section.key] ?? PROJECT_MAP_MAX_FILES}:${retryNonce[section.key] ?? 0}:b${batchCount[section.key] ?? 1}`,
    )
    .join(",");
  const scopeSig = scope.kind === "all" ? "all" : `${scope.rootId}::${scope.rel}:${scope.kind}`;

  useEffect(() => {
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    void (async () => {
      for (const section of sections) {
        if (section.analyzer === "none") continue;
        const nonce = retryNonce[section.key] ?? 0;
        const cap = fileCaps[section.key] ?? PROJECT_MAP_MAX_FILES;
        const wantBatches = batchCount[section.key] ?? 1;
        const cached = statesRef.current[section.key];
        if (
          cached !== undefined &&
          (cached.status === "ready" ||
            cached.status === "error" ||
            cached.status === "cancelled") &&
          cached.nonce === nonce &&
          cached.cap === cap &&
          cached.batches === wantBatches
        ) {
          continue;
        }
        const token = (tokenRef.current[section.key] ?? 0) + 1;
        tokenRef.current[section.key] = token;
        const live = () =>
          epochRef.current === epoch && tokenRef.current[section.key] === token;
        const patch = (next: Partial<SectionMapState>) => {
          if (!live()) return;
          setStates((prev) => ({
            ...prev,
            [section.key]: { ...(prev[section.key] ?? fresh(nonce, cap)), ...next, nonce, cap },
          }));
        };
        patch({
          status: "collecting",
          map: null,
          error: null,
          excludedSubtrees: 0,
          skippedDirs: 0,
        });
        try {
          const collected = await collectTsScope(
            section.root.id,
            depsRef.current.listDir,
            cap,
            undefined,
            {
              startRel: section.rel,
              excludeRels: section.excludeRels,
            },
          );
          if (!live()) return;
          patch({
            status: "reading",
            collected: collected.files.length,
            collectTruncated: collected.truncated,
            collectTruncatedBy: collected.truncatedBy,
            excludedSubtrees: collected.excludedSubtrees,
            skippedDirs: collected.skippedDirs,
          });
          const inputs: StructureInput[] = [];
          const skipped: Array<{ rel: string; reason: string }> = [];
          for (const file of collected.files) {
            if (!live()) return;
            try {
              const content = await depsRef.current.readFile(section.root.id, file.rel);
              inputs.push({
                rootId: section.root.id,
                rel: file.rel,
                content: content.text,
                hash: fnv1aHex(content.text),
              });
            } catch (raw) {
              skipped.push({ rel: file.rel, reason: normalizeCodeError(raw).message });
            }
          }
          if (!live()) return;
          if (inputs.length === 0) {
            if (collected.files.length === 0) {
              patch({
                status: "ready",
                map: emptyMap(),
                relations: [],
                symbolIndex: new Map(),
                rels: [],
                batches: 0,
                symbolsTruncated: false,
                relationsTruncated: false,
              });
            } else {
              patch({ status: "error", error: "None of the collected files could be read." });
            }
            continue;
          }
          patch({ status: "analyzing" });
          // One call per batch (the analyzer caps each call); results
          // merge, so resolution stays per batch (documented). Kept
          // batches reuse only when they still prefix current inputs:
          // changed content restarts instead of mixing stale data.
          const keep = mergedRef.current[section.key];
          const sameRun = keep !== undefined && keep.nonce === nonce;
          const keepRels = sameRun ? keep.result.files.map((file) => file.rel) : [];
          const prefixOk =
            keepRels.length > 0 &&
            keepRels.every((rel, index) => inputs[index]?.rel === rel);
          let base = emptyResult();
          let done = 0;
          if (sameRun && prefixOk && keep.batches <= wantBatches) {
            base = keep.result;
            done = keep.batches;
          }
          for (let batch = done + 1; batch <= wantBatches; batch += 1) {
            const slice = inputs.slice((batch - 1) * MAP_ANALYZE_BATCH, batch * MAP_ANALYZE_BATCH);
            if (slice.length === 0) break;
            if (!live()) return;
            const part = await depsRef.current.analyzeTs(slice);
            if (!live()) return;
            base = combineResults([base, part]);
            done = batch;
            mergedRef.current[section.key] = { nonce, batches: done, result: base };
          }
          const result = base;
          const built = buildArchMap(result);
          const analyzedRels = result.files.map((file) => file.rel);
          publishAnalysisSummary({
            rootId: section.root.id,
            scopeRel: section.rel,
            scopeName: section.title,
            files: built.files.length,
            edges: built.edges.length,
            truncated:
              collected.truncated ||
              built.filesTruncated ||
              built.edgesTruncated ||
              result.symbolsTruncated ||
              result.relationsTruncated ||
              analyzedRels.length < inputs.length,
            at: Date.now(),
          });
          patch({
            status: "ready",
            map: { ...built, skipped: [...built.skipped, ...skipped] },
            relations: result.relations,
            symbolIndex: indexSymbols(result.symbols),
            rels: analyzedRels,
            batches: done,
            symbolsTruncated: result.symbolsTruncated,
            relationsTruncated: result.relationsTruncated,
          });
        } catch (raw) {
          patch({ status: "error", error: normalizeCodeError(raw).message });
        }
      }
    })();
    // Signatures (not identities) drive re-runs; epoch + tokens drop
    // stale work on scope switches and cancels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, visibleSig, retrySig, scopeSig]);

  function cancelSection(key: string): void {
    tokenRef.current[key] = (tokenRef.current[key] ?? 0) + 1;
    setStates((prev) => {
      const current = prev[key] ?? fresh(retryNonce[key] ?? 0, fileCaps[key] ?? PROJECT_MAP_MAX_FILES);
      // Cancelling a later batch keeps the accumulated map (still
      // honest: pending stays visible with its Continue button, and
      // completed batches resume instead of re-running).
      const keepMap = current.map !== null && current.batches > 0;
      return {
        ...prev,
        [key]: {
          ...current,
          status: keepMap ? "ready" : "cancelled",
          nonce: retryNonce[key] ?? 0,
          cap: fileCaps[key] ?? PROJECT_MAP_MAX_FILES,
          batches: keepMap ? current.batches : 0,
          error: null,
        },
      };
    });
  }

  // A scope switch never shows the previous scope results.
  useEffect(() => {
    setSelectedKey(null);
    setSelectedSymbolId(null);
    setArchModule(null);
    setFlowStart(null);
    setFlowSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scopeSig]);

  const analyzedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const section of sections) {
      for (const rel of states[section.key]?.rels ?? []) keys.add(`${section.root.id}::${rel}`);
    }
    return keys;
  }, [sections, states]);
  const dirtyAnalyzed = tabs.filter(
    (tab) => tab.dirty && analyzedKeys.has(`${tab.rootId}::${tab.rel}`),
  );

  // Module options over the analyzed boards (declared, manual,
  // directory). Selection state stays while its card is visible;
  // when the filter hides it, the inspector says so instead of
  // showing stale data (see `outsideModule` below).
  const symbolMode = activeGroupBy === "symbols";
  const moduleSources = useMemo((): ModuleSource[] => {
    const out: ModuleSource[] = [];
    for (const section of sections) {
      const map = states[section.key]?.map ?? null;
      if (map === null) continue;
      out.push({ rootId: section.root.id, rootName: section.root.name, scopeRel: section.rel, map });
    }
    return out;
  }, [sections, states]);
  const moduleIndex = useMemo(
    () => buildModuleIndex(moduleSources, manualModules),
    [moduleSources, manualModules],
  );
  const selectedOption = moduleIndex.options.find((option) => option.key === archModule) ?? null;
  const memberIds = selectedOption === null ? null : (moduleIndex.members.get(selectedOption.key) ?? new Set<string>());
  const references = useMemo(
    () =>
      symbolMode && memberIds !== null && showExternal
        ? moduleReferenceIds(moduleSources, memberIds)
        : { ids: new Set<string>(), total: 0 },
    [symbolMode, moduleSources, memberIds, showExternal],
  );
  const onlyIds = useMemo(() => {
    if (memberIds === null) return null;
    if (!symbolMode || !showExternal) return memberIds;
    return new Set([...memberIds, ...references.ids]);
  }, [memberIds, symbolMode, showExternal, references]);

  // Dangling module keys (stale links, re-analysis without the
  // module) reset once everything settled — never mid-flight.
  const settled =
    !detectionPending &&
    manualState !== "loading" &&
    sections.every((section) => {
      const status = states[section.key]?.status;
      return (
        status === undefined ||
        status === "ready" ||
        status === "error" ||
        status === "cancelled"
      );
    });
  useEffect(() => {
    if (archModule !== null && settled && !moduleIndex.members.has(archModule)) {
      setArchModule(null);
    }
  });

  // Filtering runs here (the toolbar lives here too): sections only
  // lay out and render what they receive.
  const filteredBySection = useMemo(() => {
    const out = new Map<string, { files: FilteredMap; symbols: FilteredSymbols }>();
    for (const section of sections) {
      const map = states[section.key]?.map ?? null;
      out.set(section.key, {
        files: filterMapColumns(map, activeQuery, activeLayers, {
          showTests: activeShowTests,
          showConfig: activeShowConfig,
          onlyIds,
        }),
        symbols: filterSymbolNodes(map, activeQuery, activeLayers, {
          showTests: activeShowTests,
          showConfig: activeShowConfig,
          overrides: layerOverrides,
          onlyIds,
        }),
      });
    }
    return out;
  }, [
    sections,
    states,
    activeQuery,
    activeLayers,
    activeShowTests,
    activeShowConfig,
    layerOverrides,
    onlyIds,
  ]);

  const inspectorData = useMemo(
    () => findInspectorData(sections, states, selectedKey, selectedSymbolId),
    [sections, states, selectedKey, selectedSymbolId],
  );
  const setLayerOverride = useRequirementsUi((s) => s.setLayerOverride);
  const effectiveNodeLayer =
    inspectorData?.node === null || inspectorData?.node === undefined
      ? null
      : effectiveLayer(inspectorData.node, layerOverrides);

  // Drop selections whose card left the view (hidden, filtered out).
  useEffect(() => {
    if (selectedKey !== null && inspectorData === null) {
      setSelectedKey(null);
      setSelectedSymbolId(null);
    }
  });

  const outsideModule =
    selectedOption !== null &&
    inspectorData !== null &&
    memberIds !== null &&
    onlyIds !== null &&
    (symbolMode
      ? selectedSymbolId !== null && !onlyIds.has(selectedSymbolId)
      : !inspectorData.file.symbols.some((symbol) => memberIds.has(symbol.id)));
  const inspectorMemberships =
    selectedSymbolId === null ? null : (moduleIndex.memberships.get(selectedSymbolId) ?? null);
  const inspectorReferenceNote =
    selectedOption !== null &&
    selectedSymbolId !== null &&
    references.ids.has(selectedSymbolId)
      ? `outside ${selectedOption.label}`
      : null;

  function handleSelect(key: string | null): void {
    setSelectedKey(key);
    setSelectedSymbolId(null);
  }

  function handleSelectSymbol(map: ArchMap | null, id: string | null): void {
    if (id === null) {
      handleSelect(null);
      return;
    }
    const node = map?.nodes.find((entry) => entry.id === id) ?? null;
    if (node === null) {
      handleSelect(null);
      return;
    }
    setSelectedKey(fileKey(node.rootId, node.rel));
    setSelectedSymbolId(id);
  }

  function handleSelectMember(map: ArchMap | null, symbolId: string, index: number): void {
    if (symbolId !== selectedSymbolId) {
      handleSelectSymbol(map, symbolId);
      setSelectedMember(index);
      return;
    }
    setSelectedMember((prev) => (prev === index ? null : index));
  }

  function handleSelectInspectorFile(rootId: string, rel: string): void {
    setSelectedKey(fileKey(rootId, rel));
  }

  function handleSetLayerOverride(id: string, layer: ArchLayer | null): void {
    if (layer === null) {
      setLayerOverride(id, null);
      return;
    }
    // The stored name guards the override: it only applies to the
    // symbol it was made for, never to a recycled id.
    const name = inspectorData?.node?.symbol.name ?? "";
    if (inspectorData?.node?.id !== id || name === "") return;
    setLayerOverride(id, { layer, name });
  }

  function handleZoomChange(next: number): void {
    setInnerZoom(next);
    onZoomChange?.(next);
  }

  function retrySection(key: string): void {
    setRetryNonce((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  }

  function continueSection(key: string): void {
    setBatchCount((prev) => ({ ...prev, [key]: (prev[key] ?? 1) + 1 }));
  }

  function loadMoreSection(key: string): void {
    setFileCaps((prev) => ({
      ...prev,
      [key]: (prev[key] ?? PROJECT_MAP_MAX_FILES) + MAP_LOAD_MORE_STEP,
    }));
  }

  function sectionPending(section: MapSection): number {
    const state = states[section.key];
    if (state === undefined || state.status !== "ready") return 0;
    const failed = state.map?.skipped.length ?? 0;
    return Math.max(0, state.collected - failed - state.rels.length);
  }

  function handleContinueAll(): void {
    for (const section of sections) {
      if (sectionPending(section) > 0) continueSection(section.key);
    }
  }

  function handleShowFlow(sectionKey: string, symbolId: string, member: string | null): void {
    setFlowStart({ projectKey: sectionKey, symbolId, member });
    setFlowSelected(null);
  }

  function handleLeaveFlow(): void {
    setFlowStart(null);
    setFlowSelected(null);
  }

  /** "Analyze all": every section with pending files gets the batches it needs. */
  function handleAnalyzeAll(): void {
    setBatchCount((prev) => {
      const next = { ...prev };
      for (const section of sections) {
        if (sectionPending(section) <= 0) continue;
        const state = states[section.key];
        const total = (state?.collected ?? 0) - (state?.map?.skipped.length ?? 0);
        const needed = Math.max(1, Math.ceil(total / MAP_ANALYZE_BATCH));
        next[section.key] = Math.max(prev[section.key] ?? 1, needed);
      }
      return next;
    });
  }

  function handleShowAllHidden(): void {
    onShowAllProjects();
    for (const root of projectRoots) {
      if (hidden[root.id] === true) onToggleRoot(root.id);
    }
  }

  function handleShowHidden(entry: ToolbarHiddenEntry): void {
    if (entry.kind === "root") onToggleRoot(entry.key);
    else onToggleProject?.(entry.key);
  }

  const totals = useMemo((): CoverageTotals => {
    let collected = 0;
    let analyzed = 0;
    let failed = 0;
    let pending = 0;
    let errors = 0;
    let busy = false;
    let truncated = false;
    for (const section of sections) {
      const state = states[section.key];
      if (state === undefined) continue;
      if (
        state.status === "collecting" ||
        state.status === "reading" ||
        state.status === "analyzing"
      ) {
        busy = true;
      }
      if (state.status === "error") errors += 1;
      collected += state.collected;
      analyzed += state.rels.length;
      failed += state.map?.skipped.length ?? 0;
      pending += Math.max(0, state.collected - (state.map?.skipped.length ?? 0) - state.rels.length);
      truncated =
        truncated ||
        state.collectTruncated ||
        (state.map?.filesTruncated ?? false) ||
        (state.map?.edgesTruncated ?? false) ||
        (state.map?.nodesTruncated ?? false) ||
        (state.map?.symbolEdgesTruncated ?? false) ||
        state.symbolsTruncated ||
        state.relationsTruncated;
    }
    return { collected, analyzed, failed, pending, busy, errors, truncated };
  }, [sections, states]);

  const flowMode = useMemo((): {
    graph: FlowGraph;
    layout: FlowLayout;
    name: string | null;
  } | null => {
    if (flowStart === null) return null;
    const projects = flowProjectsOf(sections, mergedRef.current);
    const graph = buildFlowGraph(projects, flowStart);
    let name: string | null = null;
    for (const project of projects) {
      const symbol = project.result.symbols.find((entry) => entry.id === flowStart.symbolId);
      if (symbol !== undefined) {
        name = symbol.name;
        break;
      }
    }
    return { graph, layout: layoutFlowBoard(graph), name };
    // Merged results accumulate in a ref; states change on every batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStart, sections, states]);

  const detailRows = useMemo((): ToolbarDetailRow[] => {
    const rows: ToolbarDetailRow[] = sections.map((section) =>
      buildDetailRow(section, states[section.key] ?? null, symbolMode),
    );
    if (dirtyAnalyzed.length > 0) {
      const names = dirtyAnalyzed.map((tab) => tab.rel.split("/").pop() ?? tab.rel).join(", ");
      rows.push({
        key: "__drafts",
        title: "Unsaved changes",
        status: "",
        notes: [
          `${dirtyAnalyzed.length} analyzed file(s) with unsaved changes: ` +
            `saved content is shown, not the draft (${names}).`,
        ],
        showRetry: false,
        showCancel: false,
        continueLabel: null,
        showLoadMore: false,
      });
    }
    if (manualState === "error") {
      rows.push({
        key: "__links",
        title: "Module links",
        status: "Unavailable",
        notes: ["Ruth module links could not be loaded; linked modules are missing."],
        showRetry: false,
        showCancel: false,
        continueLabel: null,
        showLoadMore: false,
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, states, symbolMode, dirtyAnalyzed, manualState]);

  const hiddenEntries = useMemo((): ToolbarHiddenEntry[] => {
    const out: ToolbarHiddenEntry[] = [];
    for (const root of projectRoots) {
      if (!root.missing && hidden[root.id] === true) {
        out.push({ key: root.id, label: root.name, kind: "root" });
      }
    }
    for (const project of detectedAll) {
      if (hiddenProjects[project.key] === true) {
        out.push({ key: project.key, label: project.name, kind: "project" });
      }
    }
    return out;
  }, [projectRoots, hidden, detectedAll, hiddenProjects]);

  const detailsBadge =
    totals.errors > 0
      ? String(totals.errors)
      : totals.failed > 0 ||
          totals.truncated ||
          totals.pending > 0 ||
          dirtyAnalyzed.length > 0 ||
          manualState === "error"
        ? "!"
        : null;

  const readyFiles = moduleSources.reduce((count, source) => count + source.map.files.length, 0);
  const moduleLine =
    selectedOption !== null
      ? selectedOption.criterion
      : settled && readyFiles > 0 && moduleIndex.options.length === 0
        ? "All modules: no @Module declarations, linked folders, or subfolders in this scope." +
          (manualState === "error" ? " Module links unavailable." : "")
        : null;
  const modulePartial =
    selectedOption === null
      ? null
      : !settled
        ? "Module results may be incomplete: analysis running"
        : totals.pending > 0
          ? `Module results may be incomplete: ${totals.pending} files pending`
          : totals.truncated
            ? "Module results may be incomplete: analysis truncated"
            : null;
  const externalInfo =
    selectedOption === null || !symbolMode || !showExternal
      ? null
      : references.total === 0
        ? "no external references"
        : references.total > references.ids.size
          ? `${references.ids.size} of ${references.total} references shown`
          : `${references.total} ${references.total === 1 ? "reference" : "references"}`;

  const hiddenCounts = useMemo(() => {
    let tests = 0;
    let configs = 0;
    for (const section of sections) {
      const filtered = filteredBySection.get(section.key);
      const part = symbolMode ? filtered?.symbols : filtered?.files;
      tests += part?.hiddenTests ?? 0;
      configs += part?.hiddenConfigs ?? 0;
    }
    return { tests, configs };
  }, [sections, filteredBySection, symbolMode]);
  const hiddenByFilters = hiddenCounts.tests + hiddenCounts.configs;
  const hiddenByFiltersTitle =
    hiddenByFilters === 0
      ? null
      : [
          hiddenCounts.tests > 0
            ? symbolMode
              ? `${hiddenCounts.tests} symbol${hiddenCounts.tests === 1 ? "" : "s"} in test files`
              : `${hiddenCounts.tests} test file${hiddenCounts.tests === 1 ? "" : "s"}`
            : null,
          hiddenCounts.configs > 0
            ? symbolMode
              ? `${hiddenCounts.configs} symbol${hiddenCounts.configs === 1 ? "" : "s"} in config files`
              : `${hiddenCounts.configs} config file${hiddenCounts.configs === 1 ? "" : "s"}`
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" and ");

  const scopeChip = scope.kind === "all" ? null : scopeChipLabel(scope, roots, discovered);

  const outsideModuleProp =
    outsideModule && selectedOption !== null
      ? { moduleLabel: selectedOption.label, onShowAll: () => setArchModule(null) }
      : null;

  return (
    <div className="project-map">
      <ArchitectureToolbar
        modules={moduleIndex.options}
        moduleKey={archModule}
        onModuleChange={setArchModule}
        moduleLine={moduleLine}
        modulePartial={modulePartial}
        showExternal={showExternal}
        onToggleExternal={() => setShowExternal(!showExternal)}
        externalInfo={externalInfo}
        groupBy={activeGroupBy}
        onGroupByChange={setInnerGroupBy}
        query={activeQuery}
        onQueryChange={setInnerQuery}
        layersOn={activeLayers}
        onToggleLayer={(layer) =>
          setInnerLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))
        }
        showTests={activeShowTests}
        onToggleTests={() => setInnerTests((prev) => !prev)}
        showConfig={activeShowConfig}
        onToggleConfig={() => setInnerConfig((prev) => !prev)}
        hiddenByFilters={hiddenByFilters}
        hiddenByFiltersTitle={hiddenByFiltersTitle}
        edgeOpts={activeEdgeOpts}
        onToggleIncoming={() => setInnerEdgeOpts((prev) => ({ ...prev, incoming: !prev.incoming }))}
        onToggleOutgoing={() => setInnerEdgeOpts((prev) => ({ ...prev, outgoing: !prev.outgoing }))}
        onDepthChange={(depth) => setInnerEdgeOpts((prev) => ({ ...prev, depth }))}
        detailsBadge={detailsBadge}
        detailsOpen={detailsOpen}
        onOpenDetails={() => setDetailsOpen(true)}
        onCloseDetails={() => setDetailsOpen(false)}
        detailRows={detailRows}
        hiddenEntries={hiddenEntries}
        onDetailRetry={retrySection}
        onDetailCancel={cancelSection}
        onDetailContinue={continueSection}
        onDetailLoadMore={loadMoreSection}
        onShowHidden={handleShowHidden}
        onShowAllHidden={handleShowAllHidden}
      />
      {projectRoots.length === 0 && (
        <p className="hint" role="note">
          No folders associated with this project yet. Associate them from the Code view (◈
          badge) and their diagrams will appear here.
        </p>
      )}
      {projectRoots.length > 0 && scopeIssue !== null && (
        <p className="hint" role="note">
          {scopeIssue}{" "}
          <button
            type="button"
            className="secondary small"
            onClick={() => onScopeChange({ kind: "all" })}
          >
            Show all projects
          </button>
        </p>
      )}
      {projectRoots.length > 0 && scopeIssue === null && detectionPending && sections.length === 0 && (
        <p className="hint" role="status">
          Detecting projects…
        </p>
      )}
      {projectRoots.length > 0 &&
        scopeIssue === null &&
        !detectionPending &&
        sections.length === 0 && (
          <p className="hint" role="note">
            Everything is hidden from view.{" "}
            <button type="button" className="secondary small" onClick={handleShowAllHidden}>
              Show all
            </button>
          </p>
        )}
      {sections.length > 0 && (
        <div className="project-map-boards">
          <div className="project-map-sections">
            {flowMode !== null && flowStart !== null ? (
              <section
                className="project-map-root"
                aria-label={
                  flowMode.name === null ? "Flow" : `Flow of ${flowMode.name}`
                }
              >
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary small"
                    aria-label="Leave flow"
                    onClick={handleLeaveFlow}
                  >
                    {flowMode.name === null
                      ? "Flow ×"
                      : flowStart.member === null
                        ? `Flow: ${flowMode.name} ×`
                        : `Flow: ${flowMode.name}.${flowStart.member}() ×`}
                  </button>
                  {totals.pending > 0 && (
                    <span className="hint" role="status">
                      {`Partial chain: ${countLabel(totals.pending, "file", "files")} not analyzed`}
                    </span>
                  )}
                  {totals.pending > 0 && (
                    <button type="button" className="secondary small" onClick={handleAnalyzeAll}>
                      Analyze all
                    </button>
                  )}
                </div>
                {flowMode.graph.nodes.length === 0 && (
                  <p className="hint" role="note">
                    This symbol is no longer in the analysis. Leave the flow and pick it again.
                  </p>
                )}
                <BoardViewport
                  zoom={activeZoom}
                  onZoomChange={handleZoomChange}
                  label={flowMode.name === null ? "Flow" : `Flow of ${flowMode.name}`}
                  canvasWidth={flowMode.layout.width}
                  canvasHeight={flowMode.layout.height}
                >
                  <FlowBoard
                    graph={flowMode.graph}
                    layout={flowMode.layout}
                    selected={flowSelected}
                    onSelect={setFlowSelected}
                  />
                </BoardViewport>
              </section>
            ) : (
              sections.map((section) => (
                <ProjectMapSection
                  key={section.key}
                  section={section}
                  state={states[section.key] ?? null}
                  filteredFiles={
                    filteredBySection.get(section.key)?.files ?? EMPTY_FILTERED_MAP
                  }
                  filteredSymbols={
                    filteredBySection.get(section.key)?.symbols ?? EMPTY_FILTERED_SYMBOLS
                  }
                  referenceIds={symbolMode ? references.ids : EMPTY_SET}
                  referenceNote={
                    selectedOption === null ? null : `outside ${selectedOption.label}`
                  }
                  moduleLabel={selectedOption?.label ?? null}
                  showCaption={sections.length > 1 || section.analyzer === "none"}
                  edgeOpts={activeEdgeOpts}
                  expansion={expansion}
                  onToggleSymbols={(key) =>
                    setExpansion((prev) => ({
                      ...prev,
                      allSymbols: toggleSetValue(prev.allSymbols, key),
                    }))
                  }
                  onToggleMembers={(id) =>
                    setExpansion((prev) => ({
                      ...prev,
                      openMembers: toggleSetValue(prev.openMembers, id),
                    }))
                  }
                  selectedKey={selectedKey}
                  selectedSymbolId={selectedSymbolId}
                  onSelect={handleSelect}
                  onSelectSymbol={(map, id) => handleSelectSymbol(map, id)}
                  selectedMember={selectedMember}
                  onSelectMember={handleSelectMember}
                  groupBy={activeGroupBy}
                  collapsed={collapsed}
                  onToggleCollapsed={(id) => setCollapsed((prev) => toggleSetValue(prev, id))}
                  onRetry={() => retrySection(section.key)}
                  onCancel={() => cancelSection(section.key)}
                  onShowFlow={(symbolId, member) =>
                    handleShowFlow(section.key, symbolId, member)
                  }
                  zoom={activeZoom}
                  onZoomChange={handleZoomChange}
                />
              ))
            )}
          </div>
          <BoardInspector
            data={inspectorData}
            onSelectFile={handleSelectInspectorFile}
            selectedSymbolId={selectedSymbolId}
            onSelectSymbol={setSelectedSymbolId}
            selectedMember={selectedMember}
            onSelectMember={setSelectedMember}
            nodeLayer={effectiveNodeLayer}
            onSetLayerOverride={handleSetLayerOverride}
            outsideModule={outsideModuleProp}
            memberships={inspectorMemberships}
            referenceNote={inspectorReferenceNote}
            onShowFlow={
              inspectorData === null
                ? undefined
                : (symbolId, member) =>
                    handleShowFlow(inspectorData.sectionKey, symbolId, member)
            }
            flow={
              flowMode === null
                ? null
                : { graph: flowMode.graph, selected: flowSelected }
            }
          />
        </div>
      )}
      {sections.length > 0 && (
        <StatusBar
          totals={totals}
          scopeChip={scopeChip}
          onResetScope={() => onScopeChange({ kind: "all" })}
          canContinue={!totals.busy && totals.pending > 0}
          onContinue={handleContinueAll}
          unsaved={dirtyAnalyzed.length}
          onShowUnsaved={() => setDetailsOpen(true)}
        />
      )}
    </div>
  );
}

function fresh(nonce: number, cap: number): SectionMapState {
  return {
    status: "collecting",
    nonce,
    cap,
    batches: 0,
    map: null,
    relations: [],
    symbolIndex: new Map(),
    rels: [],
    collected: 0,
    collectTruncated: false,
    collectTruncatedBy: null,
    excludedSubtrees: 0,
    skippedDirs: 0,
    symbolsTruncated: false,
    relationsTruncated: false,
    error: null,
  };
}

function emptyMap(): ArchMap {
  return {
    files: [],
    filesTruncated: false,
    edges: [],
    edgesTruncated: false,
    nodes: [],
    nodesTruncated: false,
    symbolEdges: [],
    symbolEdgesTruncated: false,
    modules: [],
    externals: [],
    externalsTruncated: false,
    skipped: [],
  };
}

/** Read-only fallbacks (sections always carry their own results). */
const EMPTY_SET: Set<string> = new Set();
const EMPTY_FILTERED_MAP: FilteredMap = {
  columns: [],
  visibleKeys: new Set(),
  hiddenTests: 0,
  hiddenConfigs: 0,
};
const EMPTY_FILTERED_SYMBOLS: FilteredSymbols = {
  columns: [],
  visibleIds: new Set(),
  hiddenTests: 0,
  hiddenConfigs: 0,
};

interface CoverageTotals {
  collected: number;
  analyzed: number;
  failed: number;
  pending: number;
  busy: boolean;
  errors: number;
  truncated: boolean;
}

function buildDetailRow(
  section: MapSection,
  state: SectionMapState | null,
  symbolMode: boolean,
): ToolbarDetailRow {
  const idle: ToolbarDetailRow = {
    key: section.key,
    title: section.title,
    status: "",
    notes: [],
    showRetry: false,
    showCancel: false,
    continueLabel: null,
    showLoadMore: false,
  };
  if (section.analyzer === "none" && section.project !== null) {
    return {
      ...idle,
      status: `Detected ${kindLabel(section.project)} project`,
      notes: ["Maps analyze TypeScript only."],
    };
  }
  if (state === null || state.status === "collecting") {
    return { ...idle, status: "Collecting TypeScript files…", showCancel: state !== null };
  }
  if (state.status === "reading") {
    return { ...idle, status: `Reading ${state.collected} files…`, showCancel: true };
  }
  if (state.status === "analyzing") {
    return { ...idle, status: "Analyzing…", showCancel: true };
  }
  if (state.status === "error") {
    return {
      ...idle,
      status: "Analysis failed",
      notes: [state.error ?? "Analysis failed."],
      showRetry: true,
    };
  }
  if (state.status === "cancelled") {
    return { ...idle, status: "Cancelled", showRetry: true };
  }
  const map = state.map;
  if (map === null) return { ...idle, status: "Ready" };
  const edges = symbolMode ? map.symbolEdges.length : map.edges.length;
  const pending = Math.max(0, state.collected - map.skipped.length - state.rels.length);
  return {
    ...idle,
    status: `${map.nodes.length} symbols · ${map.files.length} files · ${edges} edges`,
    notes: sectionDetailNotes(state),
    continueLabel: pending > 0 ? `Analyze more (${pending} pending)` : null,
    showLoadMore: state.collectTruncatedBy === "files",
  };
}

function sectionDetailNotes(state: SectionMapState): string[] {
  const notes: string[] = [];
  const map = state.map;
  if (map === null) return notes;
  map.skipped.forEach((skipped, index) => {
    if (index < 6) notes.push(`Could not read ${skipped.rel}: ${skipped.reason}.`);
  });
  if (map.skipped.length > 6) {
    notes.push(`…and ${map.skipped.length - 6} more unreadable files.`);
  }
  if (state.excludedSubtrees > 0) {
    notes.push(`Excluded ${state.excludedSubtrees} nested project(s).`);
  }
  if (state.skippedDirs > 0) {
    notes.push(`Skipped ${state.skippedDirs} build/dependency folder(s).`);
  }
  if (map.externals.length > 0) {
    const shown = map.externals
      .slice(0, 8)
      .map((entry) => entry.raw)
      .join(", ");
    const more = map.externals.length > 8 || map.externalsTruncated ? ", …" : "";
    notes.push(
      `External packages (${map.externals.length}${map.externalsTruncated ? "+" : ""}): ${shown}${more}.`,
    );
  }
  const partial = [
    state.collectTruncated ? `first ${state.collected} files collected` : null,
    map.filesTruncated ? `first ${MAX_MAP_FILES} files drawn` : null,
    map.edgesTruncated ? `first ${MAX_MAP_EDGES} edges drawn` : null,
    map.nodesTruncated ? `first ${MAX_MAP_SYMBOLS} symbols drawn` : null,
    map.symbolEdgesTruncated ? `first ${MAX_MAP_SYMBOL_EDGES} symbol edges drawn` : null,
    state.symbolsTruncated ? "symbols capped" : null,
    state.relationsTruncated ? "relations capped" : null,
  ].filter((part): part is string => part !== null);
  if (partial.length > 0) notes.push(`Partial analysis: ${partial.join(" · ")}.`);
  return notes;
}

function scopeChipLabel(
  scope: ArchScope,
  roots: CodeRootDto[],
  discovered: Record<string, RootProjects>,
): string | null {
  if (scope.kind === "all") return null;
  const root = roots.find((candidate) => candidate.id === scope.rootId) ?? null;
  const rootName = root?.name ?? scope.rootId;
  const leaf =
    scope.kind === "project"
      ? ((discovered[scope.rootId]?.projects ?? []).find(
          (project) => project.rel === scope.rel,
        )?.name ?? baseName(scope.rel))
      : scope.rel === ""
        ? "Whole folder"
        : `${baseName(scope.rel)} (folder)`;
  return `${rootName} › ${leaf}`;
}

function StatusBar({
  totals,
  scopeChip,
  onResetScope,
  canContinue,
  onContinue,
  unsaved,
  onShowUnsaved,
}: {
  totals: CoverageTotals;
  scopeChip: string | null;
  onResetScope: () => void;
  canContinue: boolean;
  onContinue: () => void;
  unsaved: number;
  onShowUnsaved: () => void;
}) {
  const coverage =
    totals.collected === 0 && totals.busy
      ? "Analyzing…"
      : `${totals.analyzed}/${totals.collected} files analyzed` +
        (totals.pending > 0 ? ` · ${totals.pending} pending` : "") +
        (totals.failed > 0 ? ` · ${totals.failed} failed` : "") +
        (totals.errors > 0 ? ` · ${totals.errors} errors` : "") +
        (totals.truncated ? " · partial" : "");
  return (
    <footer className="archmap-statusbar" aria-label="Analysis status">
      {scopeChip !== null && (
        <button
          type="button"
          className="secondary small archmap-scope-chip"
          title="Back to the joint view"
          aria-label={`Scoped to ${scopeChip}. Show all projects.`}
          onClick={onResetScope}
        >
          {scopeChip} ×
        </button>
      )}
      <span className="hint" role="status">
        {coverage}
      </span>
      {canContinue && (
        <button type="button" className="secondary small" onClick={onContinue}>
          Analyze more
        </button>
      )}
      {unsaved > 0 && (
        <button
          type="button"
          className="secondary small"
          title="Saved content is shown, not the draft."
          onClick={onShowUnsaved}
        >
          {unsaved} unsaved
        </button>
      )}
    </footer>
  );
}

function kindLabel(project: DetectedCodeProject): string {
  switch (project.kind) {
    case "angular":
      return "Angular";
    case "nestjs":
      return "NestJS";
    case "typescript":
      return "TypeScript";
    case "java":
      return "Java";
    case "rust":
      return "Rust";
    case "python":
      return "Python";
  }
}

/** Compact scope readout; the tree selects, this only shows a way back. */
function clampInspectorWidth(width: number): number {
  return Math.min(MAX_ARCH_INSPECTOR_WIDTH, Math.max(MIN_ARCH_INSPECTOR_WIDTH, Math.round(width)));
}

/** Single shared inspector: collapsible, resizable, width persisted. */
function BoardInspector({
  data,
  onSelectFile,
  selectedSymbolId,
  onSelectSymbol,
  selectedMember,
  onSelectMember,
  nodeLayer,
  onSetLayerOverride,
  outsideModule,
  memberships,
  referenceNote,
  onShowFlow,
  flow,
}: {
  data: InspectorData | null;
  onSelectFile: (rootId: string, rel: string) => void;
  selectedSymbolId: string | null;
  onSelectSymbol: (id: string | null) => void;
  selectedMember: number | null;
  onSelectMember: (index: number | null) => void;
  nodeLayer: EffectiveLayer | null;
  onSetLayerOverride: (id: string, layer: ArchLayer | null) => void;
  outsideModule: { moduleLabel: string; onShowAll: () => void } | null;
  memberships: string[] | null;
  referenceNote: string | null;
  onShowFlow: ((symbolId: string, member: string | null) => void) | undefined;
  /** Flow mode detail (replaces the map inspector while set). */
  flow: {
    graph: FlowGraph;
    selected: { nodeId: string; member: string | null } | null;
  } | null;
}) {
  const width = useRequirementsUi((s) => s.archInspectorWidth);
  const collapsed = useRequirementsUi((s) => s.archInspectorCollapsed);
  const setWidth = useRequirementsUi((s) => s.setArchInspectorWidth);
  const setCollapsed = useRequirementsUi((s) => s.setArchInspectorCollapsed);

  if (collapsed) {
    return (
      <div className="project-map-inspector-rail">
        <button
          type="button"
          className="secondary small"
          aria-expanded={false}
          aria-label="Show inspector"
          title="Show inspector"
          onClick={() => setCollapsed(false)}
        >
          «
        </button>
      </div>
    );
  }
  return (
    <aside
      className="project-map-inspector"
      aria-label="Board inspector"
      style={width === null ? undefined : { width }}
    >
      <InspectorResize width={width} onResize={setWidth} />
      <div className="project-map-inspector-bar">
        <span className="hint">Inspector</span>
        <button
          type="button"
          className="secondary small"
          aria-expanded={true}
          aria-label="Hide inspector"
          title="Hide inspector"
          onClick={() => setCollapsed(true)}
        >
          »
        </button>
      </div>
      <div className="project-map-inspector-scroll">
        {flow !== null ? (
          <FlowInspector graph={flow.graph} selected={flow.selected} />
        ) : (
          <ArchMapInspector
            file={data?.file ?? null}
            edges={data?.edges ?? []}
            onSelectFile={onSelectFile}
            relations={data?.relations ?? []}
            symbolIndex={data?.symbolIndex}
            selectedSymbolId={selectedSymbolId}
            onSelectSymbol={onSelectSymbol}
            selectedMember={selectedMember}
            onSelectMember={onSelectMember}
            node={data?.node ?? null}
            nodeLayer={nodeLayer}
            onSetLayerOverride={onSetLayerOverride}
            outsideModule={outsideModule}
            memberships={memberships}
            referenceNote={referenceNote}
            onShowFlow={onShowFlow}
          />
        )}
      </div>
    </aside>
  );
}

function InspectorResize({
  width,
  onResize,
}: {
  width: number | null;
  onResize: (width: number) => void;
}) {
  const current = width ?? DEFAULT_ARCH_INSPECTOR_WIDTH;
  function nudge(delta: number): void {
    onResize(clampInspectorWidth(current + delta));
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Inspector width"
      aria-valuenow={current}
      aria-valuemin={MIN_ARCH_INSPECTOR_WIDTH}
      aria-valuemax={MAX_ARCH_INSPECTOR_WIDTH}
      tabIndex={0}
      className="project-map-inspector-resize"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") nudge(RESIZE_KEYBOARD_STEP_PX);
        else if (event.key === "ArrowRight") nudge(-RESIZE_KEYBOARD_STEP_PX);
        else if (event.key === "Home") onResize(MIN_ARCH_INSPECTOR_WIDTH);
        else if (event.key === "End") onResize(MAX_ARCH_INSPECTOR_WIDTH);
        else return;
        event.preventDefault();
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = current;
        const onMove = (move: MouseEvent) => {
          onResize(clampInspectorWidth(startWidth - (move.clientX - startX)));
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    />
  );
}

interface ProjectMapSectionProps {
  section: MapSection;
  state: SectionMapState | null;
  /** Filtered in the parent (the toolbar lives there too). */
  filteredFiles: FilteredMap;
  filteredSymbols: FilteredSymbols;
  /** External references: compact cards, symbols board only. */
  referenceIds: Set<string>;
  referenceNote: string | null;
  /** Selected module label, for honest empty notes. */
  moduleLabel: string | null;
  /** Names the board when several share the canvas. */
  showCaption: boolean;
  edgeOpts: BoardEdgeOpts;
  expansion: BoardExpansion;
  onToggleSymbols: (key: string) => void;
  onToggleMembers: (id: string) => void;
  selectedKey: string | null;
  selectedSymbolId: string | null;
  onSelect: (key: string | null) => void;
  onSelectSymbol: (map: ArchMap | null, id: string | null) => void;
  selectedMember: number | null;
  onSelectMember: (map: ArchMap | null, symbolId: string, index: number) => void;
  groupBy: "symbols" | "files";
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onRetry: () => void;
  onCancel: () => void;
  onShowFlow: (symbolId: string, member: string | null) => void;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
}

function ProjectMapSection({
  section,
  state,
  filteredFiles,
  filteredSymbols,
  referenceIds,
  referenceNote,
  moduleLabel,
  showCaption,
  edgeOpts,
  expansion,
  onToggleSymbols,
  onToggleMembers,
  selectedKey,
  selectedSymbolId,
  onSelect,
  onSelectSymbol,
  selectedMember,
  onSelectMember,
  groupBy,
  collapsed,
  onToggleCollapsed,
  onRetry,
  onCancel,
  onShowFlow,
  zoom,
  onZoomChange,
}: ProjectMapSectionProps) {
  const map = state?.map ?? null;
  const symbolMode = groupBy === "symbols";
  const fileLayout = useMemo(
    () => layoutBoard(filteredFiles.columns, expansion),
    [filteredFiles.columns, expansion],
  );
  const symbolLayout = useMemo(
    () => layoutSymbolBoard(filteredSymbols.columns, collapsed, referenceIds),
    [filteredSymbols.columns, collapsed, referenceIds],
  );
  const layout = symbolMode ? symbolLayout : fileLayout;
  const hasCards = symbolMode
    ? filteredSymbols.columns.length > 0
    : filteredFiles.columns.length > 0;
  const busy =
    state !== null &&
    (state.status === "collecting" ||
      state.status === "reading" ||
      state.status === "analyzing");
  const ready = state?.status === "ready" && map !== null;

  if (section.analyzer === "none" && section.project !== null) {
    return (
      <section className="project-map-root" aria-label={`Diagram of ${section.title}`}>
        {showCaption && <p className="archmap-caption">{section.title}</p>}
        <p className="hint" role="note">
          Detected {kindLabel(section.project)} project — maps analyze TypeScript only.
        </p>
      </section>
    );
  }

  const emptyNote =
    ready && map !== null
      ? map.files.length === 0
        ? "No supported source files."
        : symbolMode && map.nodes.length === 0
          ? "No symbols detected in the analyzed files."
          : !hasCards
            ? moduleLabel !== null
              ? `No symbols of ${moduleLabel} match the current filters.`
              : symbolMode
                ? "No symbols match the current filters."
                : "No files match the current filters."
            : null
      : null;

  return (
    <section className="project-map-root" aria-label={`Diagram of ${section.title}`}>
      {showCaption && <p className="archmap-caption">{section.title}</p>}
      {(state === null || busy) && (
        <p className="hint" role="status">
          {state === null || state.status === "collecting"
            ? "Collecting TypeScript files…"
            : state.status === "reading"
              ? `Reading ${state.collected} files…`
              : "Analyzing…"}{" "}
          {state !== null && (
            <button type="button" className="secondary small" onClick={onCancel}>
              Cancel
            </button>
          )}
        </p>
      )}
      {state?.status === "error" && (
        <p className="error" role="alert">
          Analysis failed.{" "}
          <button type="button" className="secondary small" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {state?.status === "cancelled" && (
        <p className="hint" role="note">
          Cancelled.{" "}
          <button type="button" className="secondary small" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {emptyNote !== null && (
        <p className="hint" role="note">
          {emptyNote}
        </p>
      )}
      {ready && map !== null && hasCards && (
        <BoardViewport
          zoom={zoom}
          onZoomChange={onZoomChange}
          label={`Board of ${section.title}`}
          canvasWidth={layout.width}
          canvasHeight={layout.height}
        >
          {symbolMode ? (
            <ArchSymbolBoard
              columns={filteredSymbols.columns}
              layout={symbolLayout}
              edges={map.symbolEdges}
              visibleIds={filteredSymbols.visibleIds}
              selectedId={selectedSymbolId}
              edgeOpts={edgeOpts}
              collapsed={collapsed}
              referenceIds={referenceIds}
              referenceNote={referenceNote}
              onToggleMembers={onToggleCollapsed}
              onSelect={(id) => onSelectSymbol(map, id)}
              projectLabel={section.title}
              selectedMember={selectedMember}
              onSelectMember={(id, index) => onSelectMember(map, id, index)}
              onShowFlow={onShowFlow}
            />
          ) : (
            <ArchMapBoard
              columns={filteredFiles.columns}
              layout={fileLayout}
              edges={map.edges}
              visibleKeys={filteredFiles.visibleKeys}
              selectedKey={selectedKey}
              edgeOpts={edgeOpts}
              expansion={expansion}
              onToggleSymbols={onToggleSymbols}
              onToggleMembers={onToggleMembers}
              onSelect={onSelect}
            />
          )}
        </BoardViewport>
      )}
    </section>
  );
}
