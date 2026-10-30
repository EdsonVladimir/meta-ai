// Presentational explorer tree: tree/treeitem/group roles with
// full keyboard (arrows, Home/End, type-ahead; Enter/Space activate
// as native buttons) and roving tabindex. No loading or Zustand: it receives
// the already-built forest and emits intents.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RuthDesignIcon,
  RuthFolderIcon,
  RuthMockupIcon,
  RuthModuleIcon,
  RuthOtherIcon,
  RuthProjectIcon,
  RuthRequirementIcon,
  RuthStatusIcon,
} from "../../components/icons";
import type { ArchiveAction } from "../requirements/archive";
import type { CodeLinkDto } from "../code/types";
import {
  findTypeahead,
  flattenVisible,
  isFocusable,
  type FlatNode,
} from "./explorerModel";

interface ExplorerTreeProps {
  /**
   * Forest with `selected` already marked per row (requirement and design
   * coexist; a design shows in the index and under each requirement).
   */
  forest: FlatNode[];
  /** Row that follows focus when the external selection changes. */
  followId: string | null;
  busy: boolean;
  onToggle: (nodeId: string) => void;
  onActivate: (node: FlatNode) => void;
  onRetryProject: (projectId: string) => void;
  onRetryModule: (projectId: string, moduleId: string) => void;
  onRetryGraph: (projectId: string, moduleId: string) => void;
  onCreateModule: (projectId: string) => void;
  onNewRequirement: (projectId: string, moduleId: string) => void;
  onPropose: (projectId: string, moduleId: string) => void;
  onNewMockup: (projectId: string, moduleId: string) => void;
  /** Archive, restore or delete a module or requirement. */
  onArchiveAction: (node: FlatNode, action: ArchiveAction) => void;
  /** Rename a project, module, requirement, design or mockup. */
  onRename: (node: FlatNode) => void;
  /** Module↔path links per module (selected project). */
  moduleLinks?: Record<string, CodeLinkDto[]>;
  /** Jump to a folder in the code tree. */
  onOpenInCode?: (rootId: string, rel: string) => void;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      className={expanded ? "chev open" : "chev"}
    >
      <path
        d="M4 2.5 8 6l-4 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KindIcon({ node }: { node: FlatNode }) {
  switch (node.kind) {
    case "project":
      return <RuthProjectIcon />;
    case "module":
      return <RuthModuleIcon />;
    case "requirement":
      return <RuthRequirementIcon />;
    case "design":
      return <RuthDesignIcon />;
    case "mockup":
    case "screen":
      return <RuthMockupIcon />;
    case "reqGroup":
    case "designGroup":
    case "mockupGroup":
      return <RuthFolderIcon open={node.expanded} />;
    default:
      return <RuthOtherIcon />;
  }
}

function designKindLabel(kind: string | null): string {
  if (kind === "flow") return "flow";
  if (kind === "data_model") return "data";
  if (kind === "mockup") return "mockup";
  return kind ?? "";
}

/**
 * Full row title: on shortcuts it includes the link, so the tooltip
 * shows it without redundant space-stealing badges.
 */
function rowTitle(node: FlatNode): string {
  if (node.linkKind === null) return node.title;
  const link = node.linkKind === "direct" ? "direct" : "transitive";
  return `${node.title} · ${link} link${node.staleLink ? ", stale" : ""}`;
}

export function ExplorerTree({
  forest,
  followId,
  busy,
  onToggle,
  onActivate,
  onRetryProject,
  onRetryModule,
  onRetryGraph,
  onCreateModule,
  onNewRequirement,
  onPropose,
  onNewMockup,
  onArchiveAction,
  onRename,
  moduleLinks,
  onOpenInCode,
}: ExplorerTreeProps) {
  const rows = useMemo(() => flattenVisible(forest), [forest]);
  const focusable = useMemo(() => rows.filter(isFocusable), [rows]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // A single open context menu (row id or null).
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const typeRef = useRef({ buffer: "", timer: 0 });

  // Focus follows the external selection only when it changes (without
  // stealing keyboard focus); when the active row vanishes through a
  // collapse, it falls to the first visible one.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const selectionChanged = prevSelectedRef.current !== followId;
    prevSelectedRef.current = followId;
    if (selectionChanged && followId !== null && focusable.some((n) => n.id === followId)) {
      setActiveId(followId);
      return;
    }
    if (activeId === null || !focusable.some((n) => n.id === activeId)) {
      setActiveId(focusable[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest, followId]);

  useEffect(() => {
    return () => window.clearTimeout(typeRef.current.timer);
  }, []);

  function focusRow(id: string) {
    setActiveId(id);
    buttonsRef.current.get(id)?.focus();
  }

  function rowIndex(id: string): number {
    return focusable.findIndex((n) => n.id === id);
  }

  function onTreeKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement;
    const id = target.closest("[data-row]")?.getAttribute("data-row");
    if (id === null || id === undefined) return;
    const index = rowIndex(id);
    if (index < 0) return;
    const node = focusable[index];
    const move = (next: number) => {
      event.preventDefault();
      focusRow(focusable[next].id);
    };
    switch (event.key) {
      case "ArrowDown":
        if (index + 1 < focusable.length) move(index + 1);
        return;
      case "ArrowUp":
        if (index > 0) move(index - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(focusable.length - 1);
        return;
      case "ArrowRight":
        event.preventDefault();
        if (!node.expandable) return;
        if (!node.expanded) {
          onToggle(node.id);
          return;
        }
        if (index + 1 < focusable.length && focusable[index + 1].depth > node.depth) {
          focusRow(focusable[index + 1].id);
        }
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (node.expandable && node.expanded) {
          onToggle(node.id);
          return;
        }
        for (let i = index - 1; i >= 0; i -= 1) {
          if (focusable[i].depth < node.depth) {
            focusRow(focusable[i].id);
            return;
          }
        }
        return;
      default:
        break;
    }
    // Type-ahead: one character jumps to the next visible match.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const state = typeRef.current;
      window.clearTimeout(state.timer);
      state.buffer += event.key;
      state.timer = window.setTimeout(() => {
        state.buffer = "";
      }, 500);
      const rowsAll = rows;
      const from = rowsAll.findIndex((n) => n.id === id);
      const found = findTypeahead(rowsAll, from, state.buffer);
      if (rowsAll[found]?.id !== id && isFocusable(rowsAll[found])) {
        event.preventDefault();
        focusRow(rowsAll[found].id);
      }
    }
  }

  function renderNodes(nodes: FlatNode[], grouped: boolean) {
    return (
      <ul role={grouped ? "group" : "tree"} aria-label={grouped ? undefined : "Projects"}>
        {nodes.map((node) => {
          // Module↔path links of the selected project (chip + jump).
          const codeLinks =
            node.kind === "module" && node.moduleId !== null
              ? (moduleLinks?.[node.moduleId] ?? [])
              : [];
          return (
          <li
            key={node.id}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-expanded={node.expandable ? node.expanded : undefined}
            aria-selected={node.kind === "status" ? undefined : node.selected}
            aria-disabled={node.kind === "status" ? true : undefined}
            className={
              node.selected
                ? "tree-row selected"
                : node.archived
                  ? "tree-row archived"
                  : "tree-row"
            }
          >
            {node.kind === "status" ? (
              <StatusRow
                node={node}
                onRetryProject={onRetryProject}
                onRetryModule={onRetryModule}
                onRetryGraph={onRetryGraph}
              />
            ) : (
              <>
                <span className="tree-main">
                  {node.expandable ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="chev-btn"
                      aria-label={`${node.expanded ? "Collapse" : "Expand"} ${node.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(node.id);
                      }}
                    >
                      <Chevron expanded={node.expanded} />
                    </button>
                  ) : (
                    <span className="chev-spacer" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    data-row={node.id}
                    ref={(el) => {
                      if (el) buttonsRef.current.set(node.id, el);
                      else buttonsRef.current.delete(node.id);
                    }}
                    tabIndex={node.id === activeId ? 0 : -1}
                    className="tree-label"
                    title={rowTitle(node)}
                    onClick={() => {
                      setActiveId(node.id);
                      onActivate(node);
                    }}
                  >
                    <KindIcon node={node} />
                    <span className="tree-text">
                      <span className="tree-primary">
                        {node.kind === "reqGroup" || node.kind === "designGroup" || node.kind === "mockupGroup" ? (
                          <span className="group-name">
                            {node.label.toUpperCase()}
                            {node.count !== null && (
                              <span className="group-count"> {node.count}</span>
                            )}
                          </span>
                        ) : (
                          <code>{node.label}</code>
                        )}
                      </span>
                      {node.secondary !== null && (
                        <span className="tree-secondary">
                          <code>{node.secondary}</code>
                        </span>
                      )}
                    </span>
                    {node.artifactKind !== null && (
                      <span className="kind-badge">{designKindLabel(node.artifactKind)}</span>
                    )}
                    {node.linkKind === "transitive" && (
                      <span className="link-badge" title="The design arrives via other designs">
                        transitive
                      </span>
                    )}
                    {node.linkKind !== null && (
                      <span className="sr-only">
                        {node.linkKind === "direct" ? "Direct" : "Transitive"} link
                        {node.staleLink ? ", stale" : ""}
                      </span>
                    )}
                    {node.staleLink && (
                      <span
                        className="stale-badge"
                        title="Pins versions that are no longer current"
                      >
                        stale
                      </span>
                    )}
                    {node.approved !== null && (
                      <span
                        className={node.approved ? "review-badge ok" : "review-badge draft"}
                        title={
                          node.approved
                            ? "Current version reviewed (optional)"
                            : "Not reviewed: informational, never blocks"
                        }
                      >
                        {node.approved ? "reviewed" : "not reviewed"}
                      </span>
                    )}
                    {node.archived && (
                      <span className="archived-badge" title="Archived: read-only">
                        archived
                      </span>
                    )}
                    {codeLinks.length > 0 && (
                      <span
                        className="code-badge"
                        title={`Linked folder: ${codeLinks[0].rootId}/${codeLinks[0].rel}`}
                      >
                        {codeLinks[0].rel}
                        {codeLinks.length > 1 && ` +${codeLinks.length - 1}`}
                      </span>
                    )}
                  </button>
                  {codeLinks.length > 0 && onOpenInCode !== undefined && (
                    <RowAction
                      label={`Open in code: ${codeLinks[0].rel}`}
                      symbol="↗"
                      busy={busy}
                      onClick={() => onOpenInCode(codeLinks[0].rootId, codeLinks[0].rel)}
                    />
                  )}
                  {node.kind === "project" && node.projectId !== null && (
                    <RowAction
                      label={`Create module in ${node.projectId}`}
                      symbol="+"
                      busy={busy}
                      onClick={() => onCreateModule(node.projectId as string)}
                    />
                  )}
                  {node.kind === "reqGroup" &&
                    node.projectId !== null &&
                    node.moduleId !== null && (
                      <>
                        <RowAction
                          label={
                            node.archived
                              ? `Archived module: restore ${node.moduleId} to create`
                              : `Create requirement in ${node.moduleId}`
                          }
                          symbol="+"
                          busy={busy}
                          disabled={node.archived}
                          onClick={() =>
                            onNewRequirement(node.projectId as string, node.moduleId as string)
                          }
                        />
                        <RowAction
                          label={
                            node.archived
                              ? `Archived module: restore ${node.moduleId} to propose`
                              : `Propose requirements with AI in ${node.moduleId}`
                          }
                          symbol="AI"
                          busy={busy}
                          disabled={node.archived}
                          onClick={() =>
                            onPropose(node.projectId as string, node.moduleId as string)
                          }
                        />
                      </>
                    )}
                  {node.kind === "mockupGroup" &&
                    node.projectId !== null &&
                    node.moduleId !== null && (
                      <RowAction
                        label={
                          node.archived
                            ? `Archived module: restore ${node.moduleId} to create`
                            : `Create mockup in ${node.moduleId}`
                        }
                        symbol="+"
                        busy={busy}
                        disabled={node.archived}
                        onClick={() =>
                          onNewMockup(node.projectId as string, node.moduleId as string)
                        }
                      />
                    )}
                  {(node.kind === "project" ||
                    node.kind === "module" ||
                    node.kind === "requirement" ||
                    node.kind === "design" ||
                    node.kind === "mockup") && (
                    <RowMenu
                      node={node}
                      open={openMenu === node.id}
                      busy={busy}
                      onToggle={() => setOpenMenu((prev) => (prev === node.id ? null : node.id))}
                      onClose={() => setOpenMenu(null)}
                      onAction={(action) => {
                        setOpenMenu(null);
                        onArchiveAction(node, action);
                      }}
                      onRename={() => {
                        setOpenMenu(null);
                        onRename(node);
                      }}
                    />
                  )}
                </span>
                {node.expanded && node.children.length > 0 && renderNodes(node.children, true)}
              </>
            )}
          </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="tree-scroll" onKeyDown={onTreeKeyDown}>
      {renderNodes(forest, false)}
    </div>
  );
}

function StatusRow({
  node,
  onRetryProject,
  onRetryModule,
  onRetryGraph,
}: {
  node: FlatNode;
  onRetryProject: (projectId: string) => void;
  onRetryModule: (projectId: string, moduleId: string) => void;
  onRetryGraph: (projectId: string, moduleId: string) => void;
}) {
  if (node.loadState === "error") {
    // Retrying needs its context: derived from the parent id.
    const parentId = node.id.slice(0, node.id.lastIndexOf("#"));
    const projectMatch = /^p:(.+)$/.exec(parentId);
    const moduleMatch = /^g:([^/]+)\/(.+)\/(req|design|mockup)$/.exec(parentId);
    const linkMatch = /^ls:(.+)$/.exec(parentId);
    return (
      <span className="tree-status error">
        <RuthStatusIcon />
        <span className="tree-text">{node.label}</span>
        {(projectMatch ?? moduleMatch ?? linkMatch) && (
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              if (projectMatch) onRetryProject(projectMatch[1]);
              else if (moduleMatch) onRetryModule(moduleMatch[1], moduleMatch[2]);
              else if (linkMatch && node.projectId !== null && node.moduleId !== null) {
                onRetryGraph(node.projectId, node.moduleId);
              }
            }}
          >
            Retry
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="tree-status hint">
      <RuthStatusIcon />
      <span className="tree-text">{node.label}</span>
    </span>
  );
}

function RowAction({
  label,
  symbol,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  symbol: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="tree-action"
      aria-label={label}
      title={label}
      disabled={busy || disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {symbol}
    </button>
  );
}

/**
 * A row's context menu (project, module, requirement or design): rename,
 * archive or restore per its state, and delete permanently (the preview
 * summary decides whether it is safe). Projects are never archived: only
 * renamed or deleted (empty and loose). Closes with Escape, on pick or
 * when clicking outside.
 */
function RowMenu({
  node,
  open,
  busy,
  onToggle,
  onClose,
  onAction,
  onRename,
}: {
  node: FlatNode;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onClose: () => void;
  onAction: (action: ArchiveAction) => void;
  onRename: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  const what =
    node.kind === "module"
      ? "module"
      : node.kind === "design"
        ? "design"
        : node.kind === "mockup"
          ? "mockup"
          : node.kind === "project"
            ? "project"
            : "requirement";
  const name = node.artifactId ?? node.moduleId ?? node.label;
  return (
    <div className="tree-menu-wrap" ref={menuRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tree-action"
        aria-label={`Actions for ${name}`}
        title={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        …
      </button>
      {open && (
        <div className="tree-menu" role="menu" aria-label={`Actions for ${name}`}>
          <button
            type="button"
            role="menuitem"
            disabled={node.archivedOwn}
            title={node.archivedOwn ? "Restore the item before renaming it" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          >
            Rename {what}
          </button>
          {(node.kind === "module" || node.kind === "requirement") &&
            (node.archivedOwn ? (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction("restore");
                }}
              >
                Restore {what}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction("archive");
                }}
              >
                Archive {what}
              </button>
            ))}
          {(node.kind === "project" ||
            node.kind === "module" ||
            node.kind === "requirement") && (
            <button
              type="button"
              role="menuitem"
              className="danger-item"
              onClick={(e) => {
                e.stopPropagation();
                onAction("delete");
              }}
            >
              Delete permanently…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
