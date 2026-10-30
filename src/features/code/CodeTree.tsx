// Code workspace tree: separate roots, on-demand loading. Each root is
// independent (they may be different repositories). Directories list on
// expand, never everything at startup. Exclusion policy (also in Rust):
// .git, node_modules, target and dist.
import { useEffect, useRef, useState } from "react";
import { RuthEyeIcon, RuthEyeOffIcon } from "../../components/icons";
import { listCodeDir, normalizeCodeError, readCodeFile } from "./client";
import { CodeFileIcon, CodeFolderIcon, CodeOtherIcon } from "./CodeFileIcon";
import { discoverRootProjects, type DetectedCodeProject } from "./detectProjects";
import type { ArchScope } from "../requirements/uiStore";
import type { CodeEntryDto, CodeError, CodeRootDto } from "./types";

interface DirState {
  status: "loading" | "ready" | "error";
  entries: CodeEntryDto[];
  truncated: boolean;
  error: CodeError | null;
}

type MenuTarget =
  | { kind: "root"; root: CodeRootDto }
  | { kind: "dir"; root: CodeRootDto; entry: CodeEntryDto }
  | { kind: "file"; root: CodeRootDto; entry: CodeEntryDto };

/** Root of a `rootId::rel` key (IDs never contain `::`). */
function rootOfKey(key: string): string {
  const index = key.indexOf("::");
  return index < 0 ? key : key.slice(0, index);
}

/** Keeps only current-root entries. */
function pruneRootKeys(prev: Record<string, DirState>, ids: Set<string>): Record<string, DirState> {
  let changed = false;
  const next: Record<string, DirState> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (ids.has(rootOfKey(key))) next[key] = value;
    else changed = true;
  }
  return changed ? next : prev;
}

/** Keeps only current-root expansions. */
function pruneExpandedKeys(prev: Set<string>, ids: Set<string>): Set<string> {
  let changed = false;
  const next = new Set<string>();
  for (const key of prev) {
    if (ids.has(rootOfKey(key))) next.add(key);
    else changed = true;
  }
  return changed ? next : prev;
}

/** Joins a root absolute path + a relative one with the right separator. */
export function joinRootPath(rootPath: string, rel: string): string {
  if (rel === "") return rootPath;
  const sep = rootPath.includes("\\") ? "\\" : "/";
  const clean = rel.replace(/\//g, sep);
  return rootPath.endsWith(sep) ? `${rootPath}${clean}` : `${rootPath}${sep}${clean}`;
}

interface CodeTreeProps {
  roots: CodeRootDto[];
  loading: boolean;
  error: CodeError | null;
  onRetry: () => void;
  onAddRoot: () => void;
  adding: boolean;
  onRemoveRoot: (root: CodeRootDto) => void;
  onOpenFile: (root: CodeRootDto, entry: CodeEntryDto) => void;
  onTerminalAt: (cwd: string) => void;
  onAddToScope?: (root: CodeRootDto, entry: CodeEntryDto) => void;
  /** Breadcrumb reveal: expands ancestors without selecting. */
  reveal?: { rootId: string; rel: string; nonce: number } | null;
  /** Refresh after accepting code: reloads the given folder. */
  refresh?: { rootId: string; dir: string; nonce: number } | null;
  /** Project names for the link badge (id → name). */
  projectNames?: Record<string, string>;
  /** Selected project ("link" target); null when none. */
  currentProjectId?: string | null;
  currentProjectName?: string | null;
  /** Link/unlink a root (`null` = loose folder). */
  onSetRootProject?: (root: CodeRootDto, projectId: string | null) => void;
  /** Root with a link in progress (disables its menu). */
  associatingRootId?: string | null;
  /** Open the structure-replication dialog for a root. */
  onReplicateRoot?: (root: CodeRootDto) => void;
  /** Roots hidden from the project maps (eye closed). */
  mapHidden?: Record<string, boolean>;
  /** Toggle a root diagram in the Map perspective. */
  onToggleMapRoot?: (rootId: string) => void;
  /** Active Architecture scope (marks the project row, never expands). */
  archScope?: ArchScope;
  onArchScope?: (scope: ArchScope) => void;
  /** Folder picked for exploring (highlight only, never a scope). */
  folderSelection?: { rootId: string; rel: string } | null;
  onSelectFolder?: (rootId: string, rel: string) => void;
  /** Explicit folder analysis from the row menu. */
  onAnalyzeFolder?: (rootId: string, rel: string) => void;
  /** Detected projects hidden from Architecture, by `rootId::rel`. */
  hiddenProjects?: Record<string, boolean>;
  onToggleMapProject?: (key: string) => void;
}

export function CodeTree({
  roots,
  loading,
  error,
  onRetry,
  onAddRoot,
  adding,
  onRemoveRoot,
  onOpenFile,
  onTerminalAt,
  onAddToScope,
  reveal,
  refresh,
  projectNames,
  currentProjectId,
  currentProjectName,
  onSetRootProject,
  associatingRootId,
  onReplicateRoot,
  mapHidden,
  onToggleMapRoot,
  archScope,
  onArchScope,
  folderSelection,
  onSelectFolder,
  onAnalyzeFolder,
  hiddenProjects,
  onToggleMapProject,
}: CodeTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  /** Per-root epoch: only invalidates pending work of removed roots. */
  const epochRef = useRef<Record<string, number>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** Detected code projects per root (session cache, badges + scope). */
  const [detected, setDetected] = useState<Record<string, DetectedCodeProject[]>>({});

  // When roots change, prune only the removed ones: a total reset
  // would arrive late and cancel expansions already made (besides
  // dropping their loads). Late responses from removed roots are
  // discarded by epoch.
  const rootIdsKey = roots.map((root) => root.id).join(",");
  useEffect(() => {
    const ids = new Set(roots.map((root) => root.id));
    for (const id of Object.keys(epochRef.current)) {
      if (!ids.has(id)) delete epochRef.current[id];
    }
    setDirs((prev) => pruneRootKeys(prev, ids));
    setExpanded((prev) => pruneExpandedKeys(prev, ids));
    setDetected((prev) => {
      let changed = false;
      const next: Record<string, DetectedCodeProject[]> = {};
      for (const [id, projects] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = projects;
        else changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIdsKey]);

  // Nested project discovery per root (manifest names + small reads
  // only; never runs project code). Cached per session; badges and
  // scope activation appear when ready, rows work without them.
  useEffect(() => {
    let stale = false;
    const deps = {
      listDir: (rootId: string, rel: string) => listCodeDir(rootId, rel),
      readFile: (rootId: string, rel: string) => readCodeFile(rootId, rel),
    };
    for (const root of roots) {
      if (root.missing) continue;
      void discoverRootProjects(root.id, root.name, deps).then((found) => {
        if (stale) return;
        setDetected((prev) => {
          if (prev[root.id] === found.projects) return prev;
          return { ...prev, [root.id]: found.projects };
        });
      });
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIdsKey]);

  function projectAt(rootId: string, rel: string): DetectedCodeProject | null {
    return (detected[rootId] ?? []).find((project) => project.rel === rel) ?? null;
  }

  function scopeKeyOf(rootId: string, rel: string): string {
    return `${rootId}::${rel}`;
  }

  function isScopeActive(rootId: string, rel: string): boolean {
    return (
      archScope !== undefined &&
      archScope.kind !== "all" &&
      archScope.rootId === rootId &&
      archScope.rel === rel
    );
  }

  function isFolderSelected(rootId: string, rel: string): boolean {
    return (
      folderSelection !== undefined &&
      folderSelection !== null &&
      folderSelection.rootId === rootId &&
      folderSelection.rel === rel
    );
  }

  /** Name click: projects activate the scope, plain folders just select. */
  function activateName(root: CodeRootDto, rel: string): void {
    if (projectAt(root.id, rel) !== null) {
      onArchScope?.({ kind: "project", rootId: root.id, rel });
    } else {
      onSelectFolder?.(root.id, rel);
    }
  }

  useEffect(() => {
    if (menu === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onClick = (event: MouseEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [menu]);

  function nodeKey(rootId: string, rel: string): string {
    return `${rootId}::${rel}`;
  }

  async function ensureLoaded(root: CodeRootDto, rel: string, force = false) {
    const key = nodeKey(root.id, rel);
    if (!force && dirs[key] !== undefined) return;
    const epoch = (epochRef.current[root.id] ?? 0) + 1;
    epochRef.current[root.id] = epoch;
    setDirs((prev) => ({
      ...prev,
      [key]: { status: "loading", entries: [], truncated: false, error: null },
    }));
    try {
      const listing = await listCodeDir(root.id, rel);
      if (epochRef.current[root.id] !== epoch) return;
      setDirs((prev) => ({
        ...prev,
        [key]: { status: "ready", entries: listing.entries, truncated: listing.truncated, error: null },
      }));
    } catch (raw) {
      if (epochRef.current[root.id] !== epoch) return;
      setDirs((prev) => ({
        ...prev,
        [key]: { status: "error", entries: [], truncated: false, error: normalizeCodeError(raw) },
      }));
    }
  }

  function toggleDir(root: CodeRootDto, rel: string) {
    const key = nodeKey(root.id, rel);
    // Pure updaters: loading leaves the updater (effects inside the
    // updater may be lost or duplicated depending on the scheduler).
    if (expanded.has(key)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    setExpanded((prev) => new Set(prev).add(key));
    void ensureLoaded(root, rel);
  }

  function retryDir(root: CodeRootDto, rel: string) {
    const key = nodeKey(root.id, rel);
    setDirs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    void ensureLoaded(root, rel);
  }

  // Breadcrumb reveal: expands and loads ancestors.
  useEffect(() => {
    if (reveal === null || reveal === undefined) return;
    const root = roots.find((candidate) => candidate.id === reveal.rootId);
    if (root === undefined || root.missing) return;
    const parts = reveal.rel === "" ? [] : reveal.rel.split("/");
    const prefixes = [""];
    for (let index = 0; index < parts.length; index += 1) {
      prefixes.push(parts.slice(0, index + 1).join("/"));
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const prefix of prefixes) next.add(nodeKey(root.id, prefix));
      return next;
    });
    for (const prefix of prefixes) void ensureLoaded(root, prefix);
    const key = nodeKey(root.id, reveal.rel);
    const timer = window.setTimeout(() => {
      const node = document.querySelector(`[data-code-node="${key}"]`);
      if (
        node !== null &&
        typeof (node as HTMLElement).scrollIntoView === "function"
      ) {
        (node as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  // Refresh after accepting code: invalidates the folder cache and
  // reloads it when expanded (it will see new files). With `force` the
  // load does not stop at the stale close cache.
  useEffect(() => {
    if (refresh === null || refresh === undefined) return;
    const root = roots.find((candidate) => candidate.id === refresh.rootId);
    if (root === undefined || root.missing) return;
    const key = nodeKey(root.id, refresh.dir);
    setDirs((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (expanded.has(key)) void ensureLoaded(root, refresh.dir, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  function openMenu(event: React.MouseEvent, target: MenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, target });
  }

  function renderEntries(root: CodeRootDto, rel: string, depth: number): React.ReactNode {
    const key = nodeKey(root.id, rel);
    const state = dirs[key];
    if (state === undefined || state.status === "loading") {
      return (
        <li className="code-node hint" style={{ "--code-depth": depth } as React.CSSProperties}>
          Loading…
        </li>
      );
    }
    if (state.status === "error") {
      return (
        <li className="code-node" style={{ "--code-depth": depth } as React.CSSProperties}>
          <span className="error-text" role="alert">
            {state.error?.message ?? "Could not list."}
          </span>{" "}
          <button type="button" className="secondary small" onClick={() => retryDir(root, rel)}>
            Retry
          </button>
        </li>
      );
    }
    if (state.entries.length === 0) {
      return (
        <li className="code-node hint" style={{ "--code-depth": depth } as React.CSSProperties}>
          Empty folder
        </li>
      );
    }
    return (
      <>
        {state.entries.map((entry) => {
          const isOpenDir = entry.kind === "dir" && expanded.has(nodeKey(root.id, entry.rel));
          return (
            <DirRow
              key={`${key}/${entry.name}`}
              nodeId={nodeKey(root.id, entry.rel)}
              entry={entry}
              depth={depth}
              expanded={expanded.has(nodeKey(root.id, entry.rel))}
              onToggle={() => toggleDir(root, entry.rel)}
              onOpen={() => onOpenFile(root, entry)}
              onNameClick={entry.kind === "dir" ? () => activateName(root, entry.rel) : undefined}
              project={entry.kind === "dir" ? projectAt(root.id, entry.rel) : null}
              scopeActive={isScopeActive(root.id, entry.rel)}
              folderSelected={isFolderSelected(root.id, entry.rel)}
              projectHidden={hiddenProjects?.[scopeKeyOf(root.id, entry.rel)] === true}
              onToggleProject={
                onToggleMapProject === undefined || entry.kind !== "dir"
                  ? undefined
                  : () => onToggleMapProject(scopeKeyOf(root.id, entry.rel))
              }
              onMenu={(event) =>
                openMenu(event, {
                  kind: entry.kind === "dir" ? "dir" : "file",
                  root,
                  entry,
                })
              }
              kids={
                isOpenDir ? (
                  <ul className="code-kids" aria-label={`Contents of ${entry.rel}`}>
                    {renderEntries(root, entry.rel, depth + 1)}
                  </ul>
                ) : null
              }
            />
          );
        })}
        {state.truncated && (
          <li className="code-node hint" style={{ "--code-depth": depth } as React.CSSProperties}>
            …and more (500-entry limit)
          </li>
        )}
      </>
    );
  }

  return (
    <div className="code-tree">
      <div className="panel-head">
        <h2>Folders</h2>
        <button
          type="button"
          className="secondary small"
          onClick={onAddRoot}
          disabled={adding}
          title="Pick a local folder and add it to the workspace"
        >
          {adding ? "Adding…" : roots.length === 0 ? "Open folder" : "+ Add folder"}
        </button>
      </div>
      {loading && <p className="hint">Loading workspace…</p>}
      {error !== null && !loading && (
        <p className="error" role="alert">
          {error.message}{" "}
          <button type="button" className="secondary small" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {!loading && error === null && roots.length === 0 && (
        <p className="hint">
          No folders. Open the frontend and the backend as separate roots of the same workspace.
        </p>
      )}
      <ul className="code-roots" aria-label="Workspace folders">
        {roots.map((root) => (
          <li key={root.id} className="code-root">
            <div
              className="code-row"
              onContextMenu={(event) => openMenu(event, { kind: "root", root })}
            >
              {root.missing ? (
                <span className="code-name warn-text" title={root.path}>
                  <span className="code-chevron" aria-hidden="true">
                    ▸
                  </span>
                  <CodeFolderIcon open={false} />
                  <span className="code-label">{root.name} (no longer exists)</span>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="code-chevron-button"
                    onClick={() => toggleDir(root, "")}
                    aria-expanded={expanded.has(nodeKey(root.id, ""))}
                    aria-label={`${expanded.has(nodeKey(root.id, "")) ? "Collapse" : "Expand"} ${root.name}`}
                    title={expanded.has(nodeKey(root.id, "")) ? "Collapse" : "Expand"}
                  >
                    <span className="code-chevron" aria-hidden="true">
                      {expanded.has(nodeKey(root.id, "")) ? "▾" : "▸"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`code-name${isScopeActive(root.id, "") ? " code-scope-active" : ""}${isFolderSelected(root.id, "") ? " code-folder-selected" : ""}`}
                    data-code-node={nodeKey(root.id, "")}
                    onClick={() => activateName(root, "")}
                    aria-current={isScopeActive(root.id, "") ? "true" : undefined}
                    title={(() => {
                      const found = projectAt(root.id, "");
                      return found === null
                        ? root.path
                        : `Detected ${projectKindLabel(found)} project: ${found.manifests.join(", ")}`;
                    })()}
                  >
                    <CodeFolderIcon open={expanded.has(nodeKey(root.id, ""))} />
                    <span className="code-label">{root.name}</span>
                  </button>
                  {projectAt(root.id, "") !== null && (
                    <span className="code-project-badge" aria-hidden="true">
                      {projectKindLabel(projectAt(root.id, "") as DetectedCodeProject)}
                    </span>
                  )}
                </>
              )}
              {root.projectId !== null && (
                <span
                  className="code-root-project"
                  title={
                    projectNames?.[root.projectId] !== undefined
                      ? `Project: ${projectNames[root.projectId]}`
                      : `Project: ${root.projectId}`
                  }
                >
                  ◈ {projectNames?.[root.projectId] ?? root.projectId}
                </span>
              )}
              {onToggleMapRoot !== undefined && (
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={mapHidden?.[root.id] !== true}
                  aria-label={`${mapHidden?.[root.id] === true ? "Show" : "Hide"} the ${root.name} diagram in Map`}
                  title="Show/hide in Map"
                  onClick={() => onToggleMapRoot(root.id)}
                >
                  {mapHidden?.[root.id] === true ? <RuthEyeOffIcon /> : <RuthEyeIcon />}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={`Options for ${root.name}`}
                title="Options"
                onClick={(event) => openMenu(event, { kind: "root", root })}
              >
                ⋯
              </button>
            </div>
            {root.missing ? (
              <div className="code-missing">
                <span className="hint">Folder "{root.path}" is no longer on disk.</span>{" "}
                <button type="button" className="secondary small" onClick={onRetry}>
                  Retry
                </button>{" "}
                <button type="button" className="secondary small" onClick={() => onRemoveRoot(root)}>
                  Remove
                </button>
              </div>
            ) : (
              expanded.has(nodeKey(root.id, "")) && (
                <ul className="code-kids" aria-label={`Contents of ${root.name}`}>
                  {renderEntries(root, "", 1)}
                </ul>
              )
            )}
          </li>
        ))}
      </ul>
      <p className="hint code-policy">.git, node_modules, target and dist are hidden.</p>
      {menu !== null && (
        <div
          ref={menuRef}
          className="menu-popover code-menu"
          role="menu"
          style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 60 }}
        >
          {menu.target.kind === "file" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onOpenFile(menu.target.root, (menu.target as { entry: CodeEntryDto }).entry);
              }}
            >
              Open file
            </button>
          )}
          {menu.target.kind !== "root" && onAddToScope !== undefined && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = menu.target as { root: CodeRootDto; entry: CodeEntryDto };
                setMenu(null);
                onAddToScope(target.root, target.entry);
              }}
            >
              {menu.target.kind === "dir" ? "Add folder to the analysis" : "Add to the analysis"}
            </button>
          )}
          {menu.target.kind !== "file" && onAnalyzeFolder !== undefined && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = menu.target;
                const rel = target.kind === "root" ? "" : target.entry.rel;
                setMenu(null);
                onAnalyzeFolder(target.root.id, rel);
              }}
            >
              Analyze this folder
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const cwd =
                menu.target.kind === "root"
                  ? menu.target.root.path
                  : joinRootPath(
                      menu.target.root.path,
                      menu.target.kind === "dir"
                        ? (menu.target as { entry: CodeEntryDto }).entry.rel
                        : parentRel((menu.target as { entry: CodeEntryDto }).entry.rel),
                    );
              setMenu(null);
              onTerminalAt(cwd);
            }}
          >
            Open terminal here
          </button>
          {menu.target.kind === "root" && onSetRootProject !== undefined && (
            <>
              {menu.target.root.projectId === null ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    currentProjectId === undefined ||
                    currentProjectId === null ||
                    associatingRootId === menu.target.root.id
                  }
                  title={
                    currentProjectId === undefined || currentProjectId === null
                      ? "Select a project first"
                      : `Link this folder to project ${currentProjectName ?? currentProjectId}`
                  }
                  onClick={() => {
                    const root = menu.target.root;
                    const projectId = currentProjectId ?? null;
                    if (projectId === null) return;
                    setMenu(null);
                    onSetRootProject(root, projectId);
                  }}
                >
                  {associatingRootId === menu.target.root.id
                    ? "Linking…"
                    : `Link to project${currentProjectName !== undefined && currentProjectName !== null ? `: ${currentProjectName}` : ""}`}
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={associatingRootId === menu.target.root.id}
                  title="The folder stays in the workspace, but loose (files are untouched)"
                  onClick={() => {
                    const root = menu.target.root;
                    setMenu(null);
                    onSetRootProject(root, null);
                  }}
                >
                  {associatingRootId === menu.target.root.id
                    ? "Unlinking…"
                    : "Unlink from project"}
                </button>
              )}
            </>
          )}
          {menu.target.kind === "root" && onReplicateRoot !== undefined && (
            <button
              type="button"
              role="menuitem"
              disabled={associatingRootId === menu.target.root.id}
              title="Creates the project with empty modules replicating the folders (nothing is written until confirmed)"
              onClick={() => {
                const root = menu.target.root;
                setMenu(null);
                onReplicateRoot(root);
              }}
            >
              Replicate structure as modules
            </button>
          )}
          {menu.target.kind === "root" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onRemoveRoot(menu.target.root);
              }}
            >
              Remove folder from the workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function parentRel(rel: string): string {
  const index = rel.lastIndexOf("/");
  return index < 0 ? "" : rel.slice(0, index);
}

function projectKindLabel(project: DetectedCodeProject): string {
  switch (project.kind) {
    case "angular":
      return "Angular";
    case "nestjs":
      return "NestJS";
    case "typescript":
      return "TS";
    case "java":
      return "Java";
    case "rust":
      return "Rust";
    case "python":
      return "Python";
  }
}

function DirRow({
  nodeId,
  entry,
  depth,
  expanded,
  onToggle,
  onOpen,
  onMenu,
  kids,
  project,
  scopeActive,
  folderSelected,
  projectHidden,
  onNameClick,
  onToggleProject,
}: {
  nodeId: string;
  entry: CodeEntryDto;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMenu: (event: React.MouseEvent) => void;
  kids: React.ReactNode;
  /** Detected project at this row (null for plain folders). */
  project?: DetectedCodeProject | null;
  scopeActive?: boolean;
  folderSelected?: boolean;
  projectHidden?: boolean;
  onNameClick?: () => void;
  onToggleProject?: () => void;
}) {
  const style = { "--code-depth": depth } as React.CSSProperties;
  if (entry.kind === "other") {
    return (
      <li className="code-node" style={style} title="Link or special object: not opened in this version">
        <span className="code-name hint" aria-disabled="true">
          <CodeOtherIcon />
          <span className="code-label">{entry.name}</span>
        </span>
      </li>
    );
  }
  if (entry.kind === "dir") {
    const eyeLabel =
      project === undefined || project === null
        ? null
        : projectHidden === true
          ? `Show ${project.name} in architecture`
          : `Hide ${project.name} from architecture`;
    return (
      <li className="code-node" style={style} onContextMenu={onMenu}>
        <div className="code-row">
          <button
            type="button"
            className="code-chevron-button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.name}`}
            title={expanded ? "Collapse" : "Expand"}
          >
            <span className="code-chevron" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          </button>
          <button
            type="button"
            className={`code-name${scopeActive === true ? " code-scope-active" : ""}${folderSelected === true ? " code-folder-selected" : ""}`}
            data-code-node={nodeId}
            onClick={onNameClick}
            aria-current={scopeActive === true ? "true" : undefined}
            title={
              project !== undefined && project !== null
                ? `Detected ${projectKindLabel(project)} project: ${project.manifests.join(", ")}`
                : entry.rel
            }
          >
            <CodeFolderIcon open={expanded} />
            <span className="code-label">{entry.name}</span>
          </button>
          {project !== undefined && project !== null && (
            <span className="code-project-badge" aria-hidden="true">
              {projectKindLabel(project)}
            </span>
          )}
          {project !== undefined && project !== null && onToggleProject !== undefined && eyeLabel !== null && (
            <button
              type="button"
              className="icon-button"
              aria-pressed={projectHidden !== true}
              aria-label={eyeLabel}
              title={projectHidden === true ? "Show in architecture" : "Hide from architecture"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleProject();
              }}
            >
              {projectHidden === true ? <RuthEyeOffIcon /> : <RuthEyeIcon />}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Options for ${entry.rel}`}
            title="Options"
            onClick={onMenu}
          >
            ⋯
          </button>
        </div>
        {kids}
      </li>
    );
  }
  return (
    <li className="code-node" style={style} onContextMenu={onMenu}>
      <div className="code-row">
        <button
          type="button"
          className="code-name code-file"
          data-code-node={nodeId}
          onClick={onOpen}
          title={entry.rel}
        >
          <CodeFileIcon name={entry.name} />
          <span className="code-label">{entry.name}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Options for ${entry.rel}`}
          title="Options"
          onClick={onMenu}
        >
          ⋯
        </button>
      </div>
    </li>
  );
}
