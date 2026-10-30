// Code workspace state, shared by its two panes. The folder tree
// (contextual left) and the editor (center) live in different slots
// but are ONE session: roots, tabs, drafts, scope and conflicts. The
// live text is held by Monaco (or the fallback); React only keeps the
// last save and the draft flag. No content is persisted in SQLite.
// The provider stays mounted: switching perspectives preserves tabs
// and drafts.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useRequirementsUi, type DocSaveState } from "../requirements/uiStore";
import {
  addCodeRoot,
  isTauriEnvironment,
  listCodeDir,
  listCodeRoots,
  normalizeCodeError,
  readCodeFile,
  removeCodeRoot,
  setRootProject,
  writeCodeFile,
} from "./client";
import { listProjects } from "../requirements/client";
import {
  analyzableLanguage,
  closeTab,
  folderScopeOutcome,
  openTab,
  parentDir,
  tabKey,
  tabKeyOf,
  tabsOfRoot,
} from "./model";
import type { MonacoApi } from "./monacoLoader";
import type {
  CodeConflict,
  CodeEntryDto,
  CodeError,
  CodeRootDto,
  CodeTab,
  ReplicateResultDto,
} from "./types";
import {
  DEFAULT_CODE_EDITOR_PREFS,
  loadCodeEditorPrefs,
  normalizeCodeEditorPrefs,
  saveCodeEditorPrefs,
  type CodeEditorPrefs,
} from "./editorPrefs";
import { STRUCTURE_LIMITS } from "./structure/structureTypes";
import type {
  StructureInput,
  StructureRange,
  StructureResult,
} from "./structure/structureTypes";
import { scopeKey, type ScopeFile } from "./structure/StructureView";

/** Save API invoked by the parent (Ctrl+S / save-all). */
export interface CodeSaveApi {
  /** Saves the active tab; false on failure or conflict. */
  saveActive: () => Promise<boolean>;
  /** Saves every draft; labels of the failed ones. */
  saveAll: () => Promise<string[]>;
}

export interface CodeWorkspaceStateArgs {
  saveApiRef?: React.MutableRefObject<CodeSaveApi | null>;
  onDocStatus?: (next: Record<string, DocSaveState>) => void;
  visible?: boolean;
  loader?: () => Promise<MonacoApi>;
  analyzeTs?: (files: StructureInput[]) => Promise<StructureResult>;
}

const noopDocStatus = (_next: Record<string, DocSaveState>) => {};

export function useCodeWorkspaceState({ saveApiRef, onDocStatus, visible, loader, analyzeTs }: CodeWorkspaceStateArgs) {
  const desktop = isTauriEnvironment();
  const show = visible ?? true;
  const reportDocStatus = onDocStatus ?? noopDocStatus;
  const [roots, setRoots] = useState<CodeRootDto[]>([]);
  const [rootsLoading, setRootsLoading] = useState(false);
  const [rootsError, setRootsError] = useState<CodeError | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<CodeTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<CodeRootDto | null>(null);
  const [replicateRoot, setReplicateRoot] = useState<CodeRootDto | null>(null);
  const [removing, setRemoving] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [associatingRootId, setAssociatingRootId] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFile[]>([]);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [reveal, setReveal] = useState<
    { key: string; range: StructureRange; nonce: number } | null
  >(null);
  const revealNonce = useRef(0);
  const [conflict, setConflictState] = useState<CodeConflict | null>(null);
  const [comparing, setComparing] = useState(false);
  const conflictRef = useRef<CodeConflict | null>(null);
  const [prefs, setPrefs] = useState<CodeEditorPrefs>(() => loadCodeEditorPrefs());
  const [treeReveal, setTreeReveal] = useState<{
    rootId: string;
    rel: string;
    nonce: number;
  } | null>(null);
  const treeNonce = useRef(0);
  /** Tree refresh after accepting code: reloads the parent folder. */
  const [treeRefresh, setTreeRefresh] = useState<{
    rootId: string;
    dir: string;
    nonce: number;
  } | null>(null);
  const refreshNonce = useRef(0);
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());

  function setConflict(next: CodeConflict | null) {
    conflictRef.current = next;
    setConflictState(next);
  }
  const rootsEpoch = useRef(0);
  const tabEpoch = useRef<Record<string, number>>({});
  /** Live text per tab (written by Monaco; not React state). */
  const liveText = useRef(new Map<string, string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;
  const reportRef = useRef(reportDocStatus);
  reportRef.current = reportDocStatus;

  const reloadRoots = useCallback(async () => {
    if (!desktop) return;
    const epoch = ++rootsEpoch.current;
    setRootsLoading(true);
    setRootsError(null);
    try {
      const next = await listCodeRoots();
      if (rootsEpoch.current !== epoch) return;
      setRoots(next);
    } catch (raw) {
      if (rootsEpoch.current !== epoch) return;
      setRootsError(normalizeCodeError(raw));
    } finally {
      if (rootsEpoch.current === epoch) setRootsLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    void reloadRoots();
  }, [reloadRoots]);

  // Project names for the badges (best-effort: without names, the
  // badges show the id and linking keeps working).
  const libraryToken = useRequirementsUi((s) => s.codeLibraryToken);
  const projectsEpoch = useRef(0);
  useEffect(() => {
    if (!desktop) return;
    const epoch = ++projectsEpoch.current;
    void (async () => {
      try {
        const projects = await listProjects();
        if (projectsEpoch.current !== epoch) return;
        setProjectNames(Object.fromEntries(projects.map((p) => [p.id, p.name])));
      } catch {
        if (projectsEpoch.current !== epoch) return;
        setProjectNames({});
      }
    })();
  }, [desktop, libraryToken]);

  // Active tab + per-document state for the header.
  useEffect(() => {
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === active);
    useRequirementsUi.getState().setCodeActiveFile(
      tab === undefined ? null : { rootId: tab.rootId, rootName: tab.rootName, rel: tab.rel },
    );
  }, [active, tabs]);
  useEffect(() => {
    const next: Record<string, DocSaveState> = {};
    for (const tab of tabs) {
      next[`code:${tabKeyOf(tab)}`] = {
        label: `code ${tab.rootName}/${tab.rel}`,
        dirty: tab.dirty,
        saving: tab.saving,
        error: tab.saveError,
      };
    }
    reportRef.current(next);
  }, [tabs]);

  function closeKeys(doomed: Set<string>) {
    setTabs((prev) => prev.filter((tab) => !doomed.has(tabKeyOf(tab))));
    for (const key of doomed) liveText.current.delete(key);
    setActive((prev) => {
      if (prev === null || !doomed.has(prev)) return prev;
      const rest = tabsRef.current.filter((tab) => !doomed.has(tabKeyOf(tab)));
      return rest.length === 0 ? null : tabKeyOf(rest[rest.length - 1]);
    });
  }

  async function handleAddRoot() {
    if (adding) return;
    setAddError(null);
    let chosen: string | string[] | null;
    try {
      chosen = await open({ directory: true, multiple: false, title: "Open code folder" });
    } catch (raw) {
      setAddError(normalizeCodeError(raw).message);
      return;
    }
    // Cancelling the dialog is not an error: it does nothing.
    if (typeof chosen !== "string") return;
    setAdding(true);
    try {
      const root = await addCodeRoot(chosen);
      setRoots((prev) => [...prev, root]);
    } catch (raw) {
      setAddError(normalizeCodeError(raw).message);
    } finally {
      setAdding(false);
    }
  }

  async function doRemoveRoot(root: CodeRootDto) {
    setRemoving(true);
    try {
      await removeCodeRoot(root.id);
      setRoots((prev) => prev.filter((candidate) => candidate.id !== root.id));
      closeKeys(new Set(tabsOfRoot(tabsRef.current, root.id)));
      setConfirmRemove(null);
    } catch (raw) {
      setAddError(normalizeCodeError(raw).message);
    } finally {
      setRemoving(false);
    }
  }

  /** Link/unlink a root to a project (without touching files). */
  async function handleSetRootProject(root: CodeRootDto, projectId: string | null) {
    if (associatingRootId !== null) return;
    setAssociatingRootId(root.id);
    setAddError(null);
    try {
      const updated = await setRootProject(root.id, projectId);
      setRoots((prev) =>
        prev.map((candidate) => (candidate.id === root.id ? updated : candidate)),
      );
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setAddError(normalizeCodeError(raw).message);
    } finally {
      setAssociatingRootId(null);
    }
  }

  /**
   * Replica created: updates the root (link), notifies the project
   * tree and opens the project with its first module so perspectives
   * enable. It touches no drafts or files.
   */
  function handleReplicated(result: ReplicateResultDto): void {
    setRoots((prev) =>
      prev.map((candidate) => (candidate.id === result.root.id ? result.root : candidate)),
    );
    setReplicateRoot(null);
    const ui = useRequirementsUi.getState();
    ui.bumpExplorer();
    ui.bumpCodeLibrary();
    const first = result.modules.length > 0 ? result.modules[0].moduleId : null;
    ui.setSelection({
      projectId: result.projectId,
      moduleId: first,
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    });
    ui.setCenterView("requirements");
  }

  /** Remove with drafts: saves everything first; on failure, no removal. */
  async function handleRemoveRootSaveFirst(root: CodeRootDto) {
    const keys = tabsOfRoot(tabsRef.current, root.id);
    for (const key of keys) {
      const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === key);
      if (tab !== undefined && tab.dirty && !(await saveTab(key, false))) return;
    }
    await doRemoveRoot(root);
  }

  async function loadTabContent(rootId: string, rel: string) {
    const key = tabKey(rootId, rel);
    const epoch = (tabEpoch.current[key] ?? 0) + 1;
    tabEpoch.current[key] = epoch;
    setTabs((prev) =>
      prev.map((tab) =>
        tabKeyOf(tab) === key ? { ...tab, loading: true, error: null } : tab,
      ),
    );
    try {
      const content = await readCodeFile(rootId, rel);
      if (tabEpoch.current[key] !== epoch) return;
      liveText.current.set(key, content.text);
      setTabs((prev) =>
        prev.map((tab) =>
          tabKeyOf(tab) === key
            ? {
                ...tab,
                loading: false,
                content,
                savedText: content.text,
                dirty: false,
                saveError: null,
                error: null,
              }
            : tab,
        ),
      );
    } catch (raw) {
      if (tabEpoch.current[key] !== epoch) return;
      setTabs((prev) =>
        prev.map((tab) =>
          tabKeyOf(tab) === key
            ? { ...tab, loading: false, error: normalizeCodeError(raw) }
            : tab,
        ),
      );
    }
  }

  /**
   * An accept wrote to disk: reloads the tab when open and CLEAN (with
   * a draft it is untouched: the save conflict will warn) and refreshes
   * the parent folder in the tree (it will see new files).
   */
  function notifyFileChanged(rootId: string, rel: string) {
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === tabKey(rootId, rel));
    if (tab !== undefined && !tab.dirty) void loadTabContent(rootId, rel);
    refreshNonce.current += 1;
    setTreeRefresh({ rootId, dir: parentDir(rel), nonce: refreshNonce.current });
  }

  function handleOpenFile(root: CodeRootDto, entry: CodeEntryDto) {
    if (entry.kind !== "file") return;
    const key = tabKey(root.id, entry.rel);
    const existing = tabs.some((tab) => tabKeyOf(tab) === key);
    const next = openTab(tabs, {
      rootId: root.id,
      rootName: root.name,
      rel: entry.rel,
      name: entry.name,
    });
    setTabs(next.tabs);
    setActive(next.active);
    if (!existing) void loadTabContent(root.id, entry.rel);
  }

  function handleEditorChange(key: string, value: string) {
    liveText.current.set(key, value);
    setTabs((prev) =>
      prev.map((tab) => {
        if (tabKeyOf(tab) !== key || tab.savedText === null) return tab;
        const dirty = value !== tab.savedText;
        // Only re-renders when the flag changes, not per keystroke.
        if (dirty === tab.dirty) return tab;
        return { ...tab, dirty, saveError: dirty ? tab.saveError : null };
      }),
    );
  }

  /**
   * Saves a tab. On conflict it opens the dialog (draft intact) and
   * returns false; with `force` it replaces after comparing.
   */
  async function saveTab(key: string, force: boolean): Promise<boolean> {
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === key);
    if (tab === undefined || tab.content === null || tab.savedText === null) return true;
    if (!force && !tab.dirty) return true;
    if (tab.saving) return false;
    const value = liveText.current.get(key) ?? tab.savedText;
    const epoch = (tabEpoch.current[key] ?? 0) + 1;
    tabEpoch.current[key] = epoch;
    setTabs((prev) =>
      prev.map((candidate) =>
        tabKeyOf(candidate) === key
          ? { ...candidate, saving: true, saveError: null }
          : candidate,
      ),
    );
    try {
      const outcome = await writeCodeFile(
        tab.rootId,
        tab.rel,
        tab.content.fingerprint,
        value,
        force,
      );
      if (tabEpoch.current[key] !== epoch) return false;
      liveText.current.set(key, value);
      setTabs((prev) =>
        prev.map((candidate) =>
          tabKeyOf(candidate) === key
            ? {
                ...candidate,
                saving: false,
                dirty: false,
                saveError: null,
                savedText: value,
                content:
                  candidate.content === null
                    ? candidate.content
                    : { ...candidate.content, fingerprint: outcome.fingerprint, size: outcome.size },
              }
            : candidate,
        ),
      );
      useRequirementsUi.getState().setLastSave({
        message: `File saved: ${tab.rel}.`,
        kind: "ok",
        at: Date.now(),
      });
      return true;
    } catch (raw) {
      if (tabEpoch.current[key] !== epoch) return false;
      const err = normalizeCodeError(raw);
      if (!force && err.kind === "code_conflict") {
        // The draft stays intact; compare/reload/replace is offered.
        try {
          const disk = await readCodeFile(tab.rootId, tab.rel);
          setConflict({ key, diskText: disk.text, diskFingerprint: disk.fingerprint });
        } catch (inner) {
          setTabs((prev) =>
            prev.map((candidate) =>
              tabKeyOf(candidate) === key
                ? { ...candidate, saving: false, saveError: normalizeCodeError(inner).message }
                : candidate,
            ),
          );
          return false;
        }
        setTabs((prev) =>
          prev.map((candidate) =>
            tabKeyOf(candidate) === key ? { ...candidate, saving: false } : candidate,
          ),
        );
        return false;
      }
      setTabs((prev) =>
        prev.map((candidate) =>
          tabKeyOf(candidate) === key
            ? { ...candidate, saving: false, saveError: err.message }
            : candidate,
        ),
      );
      return false;
    }
  }

  async function saveActive(): Promise<boolean> {
    const key = activeRef.current;
    if (key === null) {
      useRequirementsUi.getState().setLastSave({
        message: "No file open.",
        kind: "info",
        at: Date.now(),
      });
      return true;
    }
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === key);
    if (tab !== undefined && !tab.dirty) {
      useRequirementsUi.getState().setLastSave({
        message: "No changes to save.",
        kind: "info",
        at: Date.now(),
      });
      return true;
    }
    return saveTab(key, false);
  }

  async function saveAllTabs(): Promise<string[]> {
    const failures: string[] = [];
    for (const tab of tabsRef.current) {
      if (!tab.dirty) continue;
      const ok = await saveTab(tabKeyOf(tab), false);
      if (!ok) {
        const conflicted = tabKeyOf(tab) === conflictRef.current?.key;
        failures.push(
          `code ${tab.rootName}/${tab.rel}${conflicted ? " (conflict: review)" : ""}`,
        );
      }
    }
    return failures;
  }

  if (saveApiRef !== undefined) {
    saveApiRef.current = { saveActive, saveAll: saveAllTabs };
  }

  /** Reload: discards the draft and adopts the disk (explicit). */
  function resolveConflictReload() {
    if (conflict === null) return;
    const { key, diskText, diskFingerprint } = conflict;
    liveText.current.set(key, diskText);
    setTabs((prev) =>
      prev.map((tab) =>
        tabKeyOf(tab) === key
          ? {
              ...tab,
              dirty: false,
              saveError: null,
              savedText: diskText,
              content:
                tab.content === null
                  ? tab.content
                  : { ...tab.content, text: diskText, fingerprint: diskFingerprint, size: diskText.length },
            }
          : tab,
      ),
    );
    setConflict(null);
    setComparing(false);
  }

  async function resolveConflictReplace() {
    if (conflict === null) return;
    const ok = await saveTab(conflict.key, true);
    if (ok) {
      setConflict(null);
      setComparing(false);
    }
  }

  function requestCloseTab(key: string) {
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === key);
    if (tab !== undefined && tab.dirty) {
      setCloseConfirm(key);
      return;
    }
    const next = closeTab(tabs, key, active);
    setTabs(next.tabs);
    setActive(next.active);
    liveText.current.delete(key);
  }

  async function closeConfirmSave() {
    if (closeConfirm === null) return;
    const ok = await saveTab(closeConfirm, false);
    // On conflict, the conflict dialog takes over.
    if (conflictRef.current?.key === closeConfirm) {
      setCloseConfirm(null);
      return;
    }
    if (ok) {
      closeKeys(new Set([closeConfirm]));
      setCloseConfirm(null);
    }
  }

  function handleTerminalAt(cwd: string) {
    const ui = useRequirementsUi.getState();
    ui.setPanel("terminal", true);
    ui.requestTerminalAt(cwd);
  }

  function handlePrefsChange(next: CodeEditorPrefs) {
    const normalized = normalizeCodeEditorPrefs(next);
    setPrefs(normalized);
    saveCodeEditorPrefs(normalized);
  }

  function handlePrefsReset() {
    setPrefs({ ...DEFAULT_CODE_EDITOR_PREFS });
    saveCodeEditorPrefs(DEFAULT_CODE_EDITOR_PREFS);
  }

  function handleRevealDir(rootId: string, rel: string) {
    treeNonce.current += 1;
    setTreeReveal({ rootId, rel, nonce: treeNonce.current });
  }

  function handleTabsKey(event: React.KeyboardEvent) {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const order = tabsRef.current.map((tab) => tabKeyOf(tab));
    const index = order.indexOf(activeRef.current ?? "");
    if (index < 0 || order.length === 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % order.length;
    if (event.key === "ArrowLeft") next = (index - 1 + order.length) % order.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = order.length - 1;
    const key = order[next] ?? order[index] ?? "";
    if (key === "") return;
    showDocument(key);
    tabButtonsRef.current.get(key)?.focus();
  }

  // The active tab always stays visible in the scrolling strip.
  useEffect(() => {
    if (active === null) return;
    const node = tabButtonsRef.current.get(active)?.closest('[role="tab"]');
    if (node !== null && node !== undefined && typeof (node as HTMLElement).scrollIntoView === "function") {
      (node as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);

  // "Open in code" requests from links: open the tab as the central
  // document (without switching perspectives or drafts).
  const codeOpenRequest = useRequirementsUi((s) => s.codeOpenRequest);
  const openNonce = useRef(0);
  useEffect(() => {
    if (codeOpenRequest === null || codeOpenRequest.nonce === openNonce.current) return;
    openNonce.current = codeOpenRequest.nonce;
    openFileByRef(codeOpenRequest.rootId, codeOpenRequest.rel, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeOpenRequest]);

  /** Shows an open tab as the central document (without switching views). */
  function showDocument(key: string) {
    setActive(key);
    useRequirementsUi.getState().setCenterDoc(key);
  }

  // The central document follows the tabs: when closed (or its root
  // removed), the center returns to the active view instead of hanging.
  const centerDoc = useRequirementsUi((s) => s.centerDoc);
  useEffect(() => {
    if (centerDoc === null) return;
    if (!tabs.some((tab) => tabKeyOf(tab) === centerDoc)) {
      useRequirementsUi.getState().setCenterDoc(null);
    }
  }, [tabs, centerDoc]);

  // Total discard (workspace close): reverts drafts to the last save
  // without closing tabs; the dialog already confirmed.
  const discardSignal = useRequirementsUi((s) => s.discardSignal);
  const discardNonce = useRef(0);
  useEffect(() => {
    if (discardSignal === discardNonce.current) return;
    discardNonce.current = discardSignal;
    setTabs((prev) =>
      prev.map((tab) => {
        if (!tab.dirty || tab.savedText === null || tab.content === null) return tab;
        liveText.current.set(tabKeyOf(tab), tab.savedText);
        return {
          ...tab,
          dirty: false,
          saveError: null,
          content: { ...tab.content, text: tab.savedText },
        };
      }),
    );
    setCloseConfirm(null);
    setConflict(null);
    setComparing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardSignal]);

  /** Opens a tab from any view, jumping to the range when verified. */
  function openFileByRef(rootId: string, rel: string, range: StructureRange | null) {
    const root = roots.find((candidate) => candidate.id === rootId);
    if (root === undefined) return;
    const name = rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel;
    handleOpenFile(root, { name, rel, kind: "file", size: null });
    if (range !== null) {
      revealNonce.current += 1;
      setReveal({ key: tabKey(rootId, rel), range, nonce: revealNonce.current });
    }
    useRequirementsUi.getState().setCenterDoc(tabKey(rootId, rel));
  }

  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  function addFileToScope(rootId: string, rel: string): boolean {
    if (analyzableLanguage(rel) === null) return false;
    const key = `${rootId}::${rel}`;
    if (scopeRef.current.some((file) => scopeKey(file) === key)) return false;
    if (scopeRef.current.length >= STRUCTURE_LIMITS.maxFiles) return false;
    const next = [...scopeRef.current, { rootId, rel }];
    scopeRef.current = next;
    setScope(next);
    return true;
  }

  /** After adding to the scope, show it in the Architecture view. */
  function showScopeInArchitecture() {
    const ui = useRequirementsUi.getState();
    ui.setCenterDoc(null);
    ui.setCenterView("architecture");
  }

  function handleAddToScope(root: CodeRootDto, entry: CodeEntryDto | null) {
    setScopeNotice(null);
    if (entry === null) return;
    if (entry.kind === "file") {
      if (analyzableLanguage(entry.rel) === null) {
        setScopeNotice(`"${entry.rel}": no analysis for that extension.`);
        return;
      }
      addFileToScope(root.id, entry.rel);
      showScopeInArchitecture();
      return;
    }
    // Bounded folder: only direct analyzable children, up to the cap.
    void (async () => {
      try {
        const listing = await listCodeDir(root.id, entry.rel);
        let added = 0;
        for (const child of listing.entries) {
          if (child.kind !== "file" || analyzableLanguage(child.rel) === null) continue;
          if (addFileToScope(root.id, child.rel)) added += 1;
        }
        if (scopeRef.current.length >= STRUCTURE_LIMITS.maxFiles) {
          setScopeNotice(`Scope full (${STRUCTURE_LIMITS.maxFiles} files).`);
        } else if (added === 0) {
          setScopeNotice("The folder has no direct analyzable files.");
        }
      } catch (raw) {
        setScopeNotice(normalizeCodeError(raw).message);
      }
      showScopeInArchitecture();
    })();
  }

  function handleAddActiveFile() {
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === activeRef.current);
    if (tab === undefined) {
      setScopeNotice("No active tab to add.");
      return;
    }
    if (analyzableLanguage(tab.rel) === null) {
      setScopeNotice(`"${tab.rel}": no analysis for that extension.`);
      return;
    }
    setScopeNotice(null);
    addFileToScope(tab.rootId, tab.rel);
  }

  // Active-tab folder: only direct analyzable children, up to the cap
  // and without duplicating (same as from the tree).
  function handleAddActiveFolder() {
    const tab = tabsRef.current.find((candidate) => tabKeyOf(candidate) === activeRef.current);
    if (tab === undefined) {
      setScopeNotice("No active tab: open a file to use its folder.");
      return;
    }
    const dir = parentDir(tab.rel);
    void (async () => {
      try {
        const listing = await listCodeDir(tab.rootId, dir);
        let analyzable = 0;
        let added = 0;
        for (const child of listing.entries) {
          if (child.kind !== "file" || analyzableLanguage(child.rel) === null) continue;
          analyzable += 1;
          if (addFileToScope(tab.rootId, child.rel)) added += 1;
        }
        const outcome = folderScopeOutcome(
          analyzable,
          added,
          scopeRef.current.length,
          STRUCTURE_LIMITS.maxFiles,
        );
        if (outcome === "full") {
          setScopeNotice(`Scope full (${STRUCTURE_LIMITS.maxFiles} files).`);
        } else if (outcome === "none") {
          setScopeNotice("The folder has no direct analyzable files.");
        } else if (outcome === "dupes") {
          setScopeNotice("The analyzable files are already in the scope.");
        } else {
          setScopeNotice(null);
        }
      } catch (raw) {
        setScopeNotice(normalizeCodeError(raw).message);
      }
    })();
  }

  // Selected project/module: target of links and associations.
  const selectedProjectId = useRequirementsUi((s) => s.selection.projectId);
  const selectedModuleId = useRequirementsUi((s) => s.selection.moduleId);

  const activeTab = tabs.find((tab) => tabKeyOf(tab) === active) ?? null;
  const conflictTab =
    conflict === null
      ? null
      : (tabs.find((tab) => tabKeyOf(tab) === conflict.key) ?? null);
  const conflictDraft = conflict === null ? "" : (liveText.current.get(conflict.key) ?? "");
  const removeDirtyCount =
    confirmRemove === null
      ? 0
      : tabs.filter((tab) => tab.rootId === confirmRemove.id && tab.dirty).length;
  const closeTabLabel =
    closeConfirm === null
      ? ""
      : (() => {
          const tab = tabs.find((candidate) => tabKeyOf(candidate) === closeConfirm);
          return tab === undefined ? "" : `${tab.rootName}/${tab.rel}`;
        })();

  return {
    desktop,
    show,
    loader,
    analyzeTs,
    roots,
    rootsLoading,
    rootsError,
    reloadRoots,
    adding,
    addError,
    handleAddRoot,
    tabs,
    active,
    setActive,
    tabButtonsRef,
    activeTab,
    handleOpenFile,
    handleEditorChange,
    requestCloseTab,
    closeConfirm,
    setCloseConfirm,
    closeConfirmSave,
    closeConfirmDiscard: () => {
      if (closeConfirm !== null) closeKeys(new Set([closeConfirm]));
      setCloseConfirm(null);
    },
    closeTabLabel,
    confirmRemove,
    setConfirmRemove,
    removing,
    removeDirtyCount,
    doRemoveRoot,
    handleRemoveRootSaveFirst,
    conflict,
    setConflict,
    conflictTab,
    conflictDraft,
    comparing,
    setComparing,
    resolveConflictReload,
    resolveConflictReplace,
    prefs,
    handlePrefsChange,
    handlePrefsReset,
    reveal,
    treeReveal,
    treeRefresh,
    notifyFileChanged,
    handleRevealDir,
    handleTabsKey,
    handleTerminalAt,
    projectNames,
    selectedProjectId,
    selectedModuleId,
    associatingRootId,
    handleSetRootProject,
    replicateRoot,
    setReplicateRoot,
    handleReplicated,
    showDocument,
    scope,
    setScope,
    scopeNotice,
    handleAddToScope,
    handleAddActiveFile,
    handleAddActiveFolder,
    openFileByRef,
    loadTabContent,
    setTabs,
  };
}

export type CodeWorkspaceState = ReturnType<typeof useCodeWorkspaceState>;

const CodeWorkspaceContext = createContext<CodeWorkspaceState | null>(null);

/** Always-mounted provider: panes share ONE session. */
export function CodeWorkspaceProvider({
  children,
  ...args
}: CodeWorkspaceStateArgs & { children: ReactNode }) {
  const state = useCodeWorkspaceState(args);
  return <CodeWorkspaceContext.Provider value={state}>{children}</CodeWorkspaceContext.Provider>;
}

/** Shared state (tree and editor are the same workspace). */
export function useCodeWorkspace(): CodeWorkspaceState {
  const state = useContext(CodeWorkspaceContext);
  if (state === null) throw new Error("useCodeWorkspace outside the provider");
  return state;
}

