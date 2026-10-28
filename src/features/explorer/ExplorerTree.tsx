// Árbol presentacional del explorador: roles tree/treeitem/group con
// teclado completo (flechas, Inicio/Fin, type-ahead; Enter/Espacio activan
// por ser botones nativos) y roving tabindex. Sin carga ni Zustand: recibe
// el bosque ya construido y emite intenciones.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArchiveAction } from "../requirements/archive";
import {
  findTypeahead,
  flattenVisible,
  isFocusable,
  type FlatNode,
} from "./explorerModel";

interface ExplorerTreeProps {
  /**
   * Bosque con `selected` ya marcado por fila (requisito y diseño
   * coexisten; un diseño aparece en el índice y bajo cada requisito).
   */
  forest: FlatNode[];
  /** Fila que sigue el foco al cambiar la selección externa. */
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
  /** Archivar, restaurar o eliminar un módulo o requisito. */
  onArchiveAction: (node: FlatNode, action: ArchiveAction) => void;
  /** Renombrar un proyecto, módulo, requisito, diseño o mockup. */
  onRename: (node: FlatNode) => void;
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
  const d =
    node.kind === "project"
      ? "M1 3.5A1.5 1.5 0 0 1 2.5 2h3l1.5 2h3.5A1.5 1.5 0 0 1 12 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 1 9.5v-6Z"
      : node.kind === "module"
        ? "M6 1 11 3.5v5L6 11 1 8.5v-5L6 1Z M1 3.5 6 6l5-2.5 M6 6v5"
        : node.kind === "design"
          ? "M2 2h8v8H2z M2 5h8 M5 5v5"
          : node.kind === "mockup"
            ? "M2 1.5h8v9H2z M2 3.5h8 M4 6.5h4"
            : "M3 1.5h4.5L10 4v6.5H3V1.5Z M7.5 1.5V4H10";
  return (
    <svg viewBox="0 0 12 12" width="13" height="13" aria-hidden="true" className="node-icon">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function designKindLabel(kind: string | null): string {
  if (kind === "flow") return "flujo";
  if (kind === "data_model") return "datos";
  if (kind === "mockup") return "mockup";
  return kind ?? "";
}

/**
 * Título completo de la fila: en accesos incluye el vínculo para
 * consultarlo en el tooltip sin badges redundantes que roben espacio.
 */
function rowTitle(node: FlatNode): string {
  if (node.linkKind === null) return node.title;
  const link = node.linkKind === "direct" ? "directo" : "transitivo";
  return `${node.title} · vínculo ${link}${node.staleLink ? " desactualizado" : ""}`;
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
}: ExplorerTreeProps) {
  const rows = useMemo(() => flattenVisible(forest), [forest]);
  const focusable = useMemo(() => rows.filter(isFocusable), [rows]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Un solo menú contextual abierto (id de fila o null).
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const typeRef = useRef({ buffer: "", timer: 0 });

  // El foco sigue a la selección externa solo cuando esta cambia (sin
  // robar el foco del teclado); si la fila activa desaparece por una
  // contracción, cae a la primera visible.
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
    // Type-ahead: un carácter salta a la siguiente coincidencia visible.
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
      <ul role={grouped ? "group" : "tree"} aria-label={grouped ? undefined : "Proyectos"}>
        {nodes.map((node) => (
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
                      aria-label={`${node.expanded ? "Contraer" : "Expandir"} ${node.label}`}
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
                    {node.kind !== "reqGroup" && node.kind !== "designGroup" && node.kind !== "mockupGroup" && (
                      <KindIcon node={node} />
                    )}
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
                      <span className="link-badge" title="El diseño llega vía otros diseños">
                        transitivo
                      </span>
                    )}
                    {node.linkKind !== null && (
                      <span className="sr-only">
                        Vínculo {node.linkKind === "direct" ? "directo" : "transitivo"}
                        {node.staleLink ? ", desactualizado" : ""}
                      </span>
                    )}
                    {node.staleLink && (
                      <span
                        className="stale-badge"
                        title="Fija versiones que ya no son las actuales"
                      >
                        desactualizado
                      </span>
                    )}
                    {node.approved !== null && (
                      <span
                        className={node.approved ? "review-badge ok" : "review-badge draft"}
                        title={
                          node.approved
                            ? "Versión actual revisada (opcional)"
                            : "Sin revisar: informativo, no bloquea"
                        }
                      >
                        {node.approved ? "revisado" : "sin revisar"}
                      </span>
                    )}
                    {node.archived && (
                      <span className="archived-badge" title="Archivado: solo lectura">
                        archivado
                      </span>
                    )}
                  </button>
                  {node.kind === "project" && node.projectId !== null && (
                    <RowAction
                      label={`Crear módulo en ${node.projectId}`}
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
                              ? `Módulo archivado: restaura ${node.moduleId} para crear`
                              : `Crear requisito en ${node.moduleId}`
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
                              ? `Módulo archivado: restaura ${node.moduleId} para proponer`
                              : `Proponer requisitos con IA en ${node.moduleId}`
                          }
                          symbol="IA"
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
                            ? `Módulo archivado: restaura ${node.moduleId} para crear`
                            : `Crear mockup en ${node.moduleId}`
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
        ))}
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
    // El reintento necesita su contexto: se deduce del id del padre.
    const parentId = node.id.slice(0, node.id.lastIndexOf("#"));
    const projectMatch = /^p:(.+)$/.exec(parentId);
    const moduleMatch = /^g:([^/]+)\/(.+)\/(req|design|mockup)$/.exec(parentId);
    const linkMatch = /^ls:(.+)$/.exec(parentId);
    return (
      <span className="tree-status error">
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
            Reintentar
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="tree-status hint">
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
 * Menú contextual de una fila (proyecto, módulo, requisito o diseño):
 * renombrar, archivar o restaurar según su estado, y eliminar
 * definitivamente (el resumen previo decide si es seguro). Los proyectos no
 * se archivan ni eliminan: solo se renombran. Se cierra con Escape, al
 * elegir o al pulsar fuera.
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
      ? "módulo"
      : node.kind === "design"
        ? "diagrama"
        : node.kind === "mockup"
          ? "mockup"
          : node.kind === "project"
            ? "proyecto"
            : "requisito";
  const name = node.artifactId ?? node.moduleId ?? node.label;
  return (
    <div className="tree-menu-wrap" ref={menuRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tree-action"
        aria-label={`Acciones para ${name}`}
        title={`Acciones para ${name}`}
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
        <div className="tree-menu" role="menu" aria-label={`Acciones para ${name}`}>
          <button
            type="button"
            role="menuitem"
            disabled={node.archivedOwn}
            title={node.archivedOwn ? "Restaura el elemento antes de renombrarlo" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          >
            Renombrar {what}
          </button>
          {node.kind === "project" ? null : node.archivedOwn ? (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                onAction("restore");
              }}
            >
              Restaurar {what}
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
              Archivar {what}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="danger-item"
            onClick={(e) => {
              e.stopPropagation();
              onAction("delete");
            }}
          >
            Eliminar definitivamente…
          </button>
        </div>
      )}
    </div>
  );
}
