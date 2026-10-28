// Editor visual de diseños (carga diferida con el lienzo). Compone
// navegación del lienzo, inspectores, validación orientativa y guardado.
//
// El borrador vive elevado en el workspace (sobrevive a cambios de
// pestaña); aquí solo se interpreta y se despachan acciones. La versión
// histórica o el montaje no canónico muestran el lienzo en lectura.
// Guardar crea una versión nueva con procedencia humana; reordenar sin
// cambiar semántica solo guarda disposición (sin versiones vacías).
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { designLayout, updateContext } from "../client";
import { normalizeCoreError } from "../../requirements/types";
import type { DesignKind, UpdateContextPreview } from "../types";
import { FlowInspector, type FlowSelection } from "./FlowInspector";
import { ErInspector, type ErSelection } from "./ErInspector";
import { DesignMetaForm } from "./inspector";
import {
  addEntity,
  addFlowEdge,
  addFlowNode,
  addRelation,
  artifactOfVersion,
  decisionBranchHandles,
  detectRename,
  erToGraph,
  flowToGraph,
  parseErSpec,
  parseFlowSpec,
  parseLayout,
  remapLayout,
  serializeErSpec,
  serializeFlowSpec,
  type DesignMeta,
  type ErSpec,
  type FlowNodeKind,
  type FlowSpec,
  type Layout,
} from "./specModel";
import { canRedo, canUndo } from "./specHistory";
import { validateDraft } from "./specValidation";
import {
  visualLayoutDirty,
  visualSemanticDirty,
  type VisualDraftAction,
  type VisualDraftState,
} from "./visualDraft";



const DesignCanvas = lazy(() =>
  import("./DesignCanvas").then((module) => ({ default: module.DesignCanvas })),
);

export type EditorSelection = FlowSelection | ErSelection;

export interface VisualSaveState {
  busy: boolean;
  error: string | null;
}

interface DesignEditorProps {
  projectId: string;
  artifactId: string;
  /** Versión mostrada (puede ser histórica). */
  versionId: string;
  currentVersionId: string;
  /** Contenido JSON de la versión mostrada. */
  content: string;
  /** Fuentes de la versión ACTUAL (fijación inicial al guardar). */
  currentPins: string[];
  kind: DesignKind;
  /** Solo el montaje canónico edita; el resto es lectura. */
  editable: boolean;
  draft: VisualDraftState | null;
  onAction: (action: VisualDraftAction) => void;
  save: VisualSaveState;
  onSave: (author: string) => void;
  onSaveLayoutOnly: () => void;
  onAdoptPins: (pins: string[]) => void;
}

interface Parsed {
  spec: FlowSpec | ErSpec;
  meta: DesignMeta;
}

function parseDraft(kind: DesignKind, text: string): Parsed | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return kind === "flow" ? parseFlowSpec(value) : parseErSpec(value);
}

const FLOW_ADD: { kind: FlowNodeKind; label: string }[] = [
  { kind: "start", label: "+ Inicio" },
  { kind: "step", label: "+ Paso" },
  { kind: "decision", label: "+ Decisión" },
  { kind: "end", label: "+ Fin" },
];

export function DesignEditor({
  projectId,
  artifactId,
  versionId,
  currentVersionId,
  content,
  currentPins,
  kind,
  editable,
  draft,
  onAction,
  save,
  onSave,
  onSaveLayoutOnly,
  onAdoptPins,
}: DesignEditorProps) {
  const isCurrent = versionId === currentVersionId;
  const editing = editable && isCurrent;
  const key = `${artifactId}:${versionId}`;
  const [savedLayout, setSavedLayout] = useState<Layout | null>(null);
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  const [ctx, setCtx] = useState<UpdateContextPreview | null>(null);
  const [ctxFailed, setCtxFailed] = useState(false);
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [author, setAuthor] = useState("");

  // Disposición guardada (todas las vistas) con guarda de obsolescencia.
  useEffect(() => {
    let fresh = true;
    setSavedLayout(null);
    setLayoutNote(null);
    void (async () => {
      try {
        const dto = await designLayout(artifactId, versionId);
        if (!fresh) return;
        setSavedLayout(parseLayout(dto.layout));
      } catch (raw) {
        if (!fresh) return;
        setSavedLayout({});
        setLayoutNote(`Sin disposición guardada (${normalizeCoreError(raw).message}).`);
      }
    })();
    return () => {
      fresh = false;
    };
  }, [artifactId, versionId]);

  // Contexto de fuentes para citas y frescura (solo al editar la actual).
  useEffect(() => {
    if (!editing) return;
    let fresh = true;
    setCtx(null);
    setCtxFailed(false);
    void (async () => {
      try {
        const preview = await updateContext({ projectId, artifactId });
        if (fresh) setCtx(preview);
      } catch {
        if (fresh) setCtxFailed(true);
      }
    })();
    return () => {
      fresh = false;
    };
  }, [editing, projectId, artifactId]);

  // La selección no sobrevive a un cambio de versión mostrada.
  useEffect(() => {
    setSelection(null);
  }, [key]);

  const activeDraft = editing && draft?.key === key ? draft : null;
  // Borrador separado: la versión actual avanzó bajo el borrador (conflicto
  // ya recargado). No se reinicia solo: la persona decide.
  const detachedDraft =
    editing && draft !== null && draft.key !== key && draft.key.startsWith(`${artifactId}:`)
      ? draft
      : null;

  // Inicio único del borrador cuando hay disposición y contexto (o fallo
  // declarado: las citas derivan de las fijaciones como alternativa).
  // Un borrador separado no se pisa: espera decisión explícita.
  useEffect(() => {
    if (!editing || savedLayout === null || (ctx === null && !ctxFailed)) return;
    if (draft !== null && (draft.key === key || draft.key.startsWith(`${artifactId}:`))) return;
    const allowed =
      ctx !== null
        ? [...new Set(ctx.sources.map((source) => source.artifactId))].sort()
        : currentPins
            .map(artifactOfVersion)
            .filter((id): id is string => id !== null);
    onAction({ type: "init", key, kind, base: content, layout: savedLayout, allowed, pins: currentPins });
  }, [editing, savedLayout, ctx, ctxFailed, draft, key, kind, content, currentPins, onAction, artifactId]);

  const draftText = activeDraft?.history.present ?? content;
  const parsed = useMemo(() => parseDraft(kind, draftText), [kind, draftText]);
  const layout = activeDraft?.layout ?? savedLayout ?? {};

  const effectiveSelection: EditorSelection = useMemo(() => {
    if (parsed === null || selection === null) return null;
    if (selection.kind === "node") {
      const ids =
        kind === "flow"
          ? (parsed.spec as FlowSpec).nodes.map((n) => n.id)
          : (parsed.spec as ErSpec).entities.map((e) => e.name);
      return ids.includes(selection.id) ? selection : null;
    }
    const count =
      kind === "flow"
        ? (parsed.spec as FlowSpec).edges.length
        : (parsed.spec as ErSpec).relations.length;
    return Number.isInteger(selection.index) && selection.index < count ? selection : null;
  }, [parsed, selection, kind]);

  const nodes: Node[] = useMemo(() => {
    if (parsed === null) return [];
    const graph =
      kind === "flow"
        ? flowToGraph(parsed.spec as FlowSpec, layout)
        : erToGraph(parsed.spec as ErSpec, layout);
    return graph.nodes.map((node) => ({
      id: node.id,
      type:
        kind === "flow"
          ? (node.data as FlowSpec["nodes"][number]).kind === "decision"
            ? "decisionNode"
            : "flowNode"
          : "erNode",
      position: { x: node.x, y: node.y },
      data:
        kind === "flow"
          ? {
              nodeKind: (node.data as FlowSpec["nodes"][number]).kind,
              label: (node.data as FlowSpec["nodes"][number]).label,
              requirements: (node.data as FlowSpec["nodes"][number]).requirements,
            }
          : {
              name: node.id,
              attributes: (node.data as ErSpec["entities"][number]).attributes,
              requirements: (node.data as ErSpec["entities"][number]).requirements,
            },
      selected: effectiveSelection?.kind === "node" && effectiveSelection.id === node.id,
    }));
  }, [parsed, kind, layout, effectiveSelection]);

  const edges: Edge[] = useMemo(() => {
    if (parsed === null) return [];
    if (kind === "flow") {
      const spec = parsed.spec as FlowSpec;
      const handles = decisionBranchHandles(spec);
      return spec.edges.map((edge, index) => {
        const handle = handles[index];
        return {
          id: `e${index}`,
          source: edge.from,
          target: edge.to,
          ...(handle === null ? {} : { sourceHandle: handle }),
          label: edge.label,
          selected: effectiveSelection?.kind === "edge" && effectiveSelection.index === index,
        };
      });
    }
    const spec = parsed.spec as ErSpec;
    return spec.relations.map((relation, index) => ({
      id: `e${index}`,
      source: relation.from,
      target: relation.to,
      label: relation.label ?? `${relation.fromCard} : ${relation.toCard}`,
      selected: effectiveSelection?.kind === "edge" && effectiveSelection.index === index,
    }));
  }, [parsed, kind, effectiveSelection]);

  const validation = useMemo(() => {
    if (parsed === null || activeDraft === null) return null;
    return validateDraft(kind, parsed.spec, parsed.meta, activeDraft.allowed);
  }, [parsed, kind, activeDraft]);

  function commit(nextSpec: FlowSpec | ErSpec, nextMeta?: DesignMeta): void {
    if (parsed === null) return;
    const meta = nextMeta ?? parsed.meta;
    const text =
      kind === "flow"
        ? serializeFlowSpec(nextSpec as FlowSpec, meta)
        : serializeErSpec(nextSpec as ErSpec, meta);
    const renamed = detectRename(kind, parsed.spec, nextSpec);
    if (renamed !== null && activeDraft !== null) {
      onAction({ type: "layout", layout: remapLayout(activeDraft.layout, renamed[0], renamed[1]) });
    }
    onAction({ type: "apply", spec: text });
    // Cambiar la lista de conexiones invalida la selección de arista.
    setSelection((current) => {
      if (current?.kind !== "edge") return current;
      const before =
        kind === "flow"
          ? (parsed.spec as FlowSpec).edges.length
          : (parsed.spec as ErSpec).relations.length;
      const after =
        kind === "flow" ? (nextSpec as FlowSpec).edges.length : (nextSpec as ErSpec).relations.length;
      return before === after ? current : null;
    });
  }

  function handleConnectElements(from: string, to: string): void {
    if (parsed === null) return;
    if (kind === "flow") {
      const { spec, index } = addFlowEdge(parsed.spec as FlowSpec, from, to);
      commit(spec);
      setSelection({ kind: "edge", index });
    } else {
      const { spec, index } = addRelation(parsed.spec as ErSpec, from, to);
      commit(spec);
      setSelection({ kind: "edge", index });
    }
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (activeDraft === null) return;
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    ) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      onAction({ type: "undo" });
    } else if ((mod && event.key.toLowerCase() === "y") || (mod && event.shiftKey && event.key.toLowerCase() === "z")) {
      event.preventDefault();
      onAction({ type: "redo" });
    }
  }

  if (parsed === null) {
    return (
      <p className="error" role="alert">
        El contenido guardado no es un diseño {kind === "flow" ? "de flujo" : "ER"} válido.
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="editor-readonly">
        {!isCurrent && (
          <p className="hint">Versión histórica en lectura: vuelve a la actual para editarla.</p>
        )}
        {layoutNote !== null && <p className="hint">{layoutNote}</p>}
        <Suspense fallback={<p className="hint">Cargando lienzo…</p>}>
          <DesignCanvas
            nodes={nodes}
            edges={edges}
            readOnly
            fitSignal={0}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "node", id })}
            onSelectEdge={(id) =>
              setSelection(id === null ? null : { kind: "edge", index: Number(id.slice(1)) })
            }
            ariaLabel={`Lienzo de ${artifactId} en lectura`}
          />
        </Suspense>
      </div>
    );
  }

  if (detachedDraft !== null) {
    return (
      <div className="draft-conflict" role="alert">
        <p>
          El diseño avanzó a otra versión mientras editabas. Tu borrador se conserva íntegro
          abajo; para seguir, descártalo y edita la versión actual.
        </p>
        <button type="button" className="secondary small" onClick={() => onAction({ type: "reset" })}>
          Descartar borrador y editar la actual
        </button>
        <details>
          <summary>JSON del borrador conservado (solo lectura)</summary>
          <pre className="readonly-box">{detachedDraft.history.present}</pre>
        </details>
      </div>
    );
  }

  if (activeDraft === null || validation === null) {
    return <p className="hint">Preparando el editor…</p>;
  }

  const semanticDirty = visualSemanticDirty(activeDraft);
  const layoutDirty = visualLayoutDirty(activeDraft);
  const stalePins =
    ctx !== null
      ? ctx.sources.filter(
          (source) => source.changed && activeDraft.pins.includes(source.usedVersionId),
        )
      : [];
  const unapprovedCurrents =
    ctx !== null
      ? ctx.sources.filter(
          (source) =>
            activeDraft.pins.includes(source.currentVersionId) && !source.currentApproved,
        )
      : [];

  return (
    <div className="design-editor" onKeyDown={handleKeyDown}>
      <div className="editor-toolbar" role="toolbar" aria-label="Edición del diseño">
        <div className="editor-toolbar-group">
          <button
            type="button"
            className="secondary small"
            disabled={!canUndo(activeDraft.history)}
            onClick={() => onAction({ type: "undo" })}
            aria-label="Deshacer cambio"
            title="Deshacer (Ctrl+Z)"
          >
            Deshacer
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!canRedo(activeDraft.history)}
            onClick={() => onAction({ type: "redo" })}
            aria-label="Rehacer cambio"
            title="Rehacer (Ctrl+Y)"
          >
            Rehacer
          </button>
          <span
            className={`draft-badge${semanticDirty ? " dirty" : layoutDirty ? " layout" : ""}`}
            aria-live="polite"
          >
            {semanticDirty ? "Cambios sin guardar" : layoutDirty ? "Solo disposición" : "Sin cambios"}
          </span>
        </div>
        <div className="editor-toolbar-group">
          {kind === "flow"
            ? FLOW_ADD.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    const { spec, id } = addFlowNode(parsed.spec as FlowSpec, item.kind);
                    commit(spec);
                    setSelection({ kind: "node", id });
                  }}
                >
                  {item.label}
                </button>
              ))
            : (
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  const { spec, name } = addEntity(parsed.spec as ErSpec);
                  commit(spec);
                  setSelection({ kind: "node", id: name });
                }}
              >
                + Entidad
              </button>
            )}
        </div>
        <div className="editor-toolbar-group">
          <label className="inline-field">
            <span>Autoría</span>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="off"
              disabled={save.busy || (!semanticDirty && !layoutDirty)}
              aria-label="Autoría de la revisión"
            />
          </label>
          {semanticDirty ? (
            <button
              type="button"
              className="primary small"
              disabled={save.busy || validation.errors.length > 0 || author.trim() === ""}
              onClick={() => onSave(author.trim())}
              title={
                validation.errors.length > 0
                  ? "Corrige los errores antes de guardar"
                  : "Guardar como versión nueva"
              }
            >
              {save.busy ? "Guardando…" : "Guardar versión"}
            </button>
          ) : (
            <button
              type="button"
              className="secondary small"
              disabled={save.busy || !layoutDirty}
              onClick={onSaveLayoutOnly}
              title="Guardar solo la disposición, sin versión nueva"
            >
              {save.busy ? "Guardando…" : "Guardar disposición"}
            </button>
          )}
        </div>
      </div>

      {save.error !== null && (
        <p className="error" role="alert">
          {save.error} El borrador se conserva.
        </p>
      )}

      <div className="editor-main">
        <Suspense fallback={<p className="hint">Cargando lienzo…</p>}>
          <DesignCanvas
            nodes={nodes}
            edges={edges}
            readOnly={false}
            fitSignal={0}
            onMoveNode={(id, x, y) => onAction({ type: "move", id, x, y })}
            onConnectElements={handleConnectElements}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "node", id })}
            onSelectEdge={(id) =>
              setSelection(id === null ? null : { kind: "edge", index: Number(id.slice(1)) })
            }
            ariaLabel={`Editor de ${artifactId}`}
          />
        </Suspense>

        <aside className="editor-inspector" aria-label="Inspector">
          {stalePins.length > 0 && (
            <section className="stale-panel" aria-label="Fuentes obsoletas">
              <h4>Fuentes obsoletas</h4>
              <p className="hint">
                Estas fuentes cambiaron desde la versión fijada. Guardar con las fijadas se
                bloqueará: adopta explícitamente las actuales (no implica que el contenido sea
                correcto; sigue requiriendo tu revisión).
              </p>
              <ul>
                {stalePins.map((source) => (
                  <li key={source.artifactId}>
                    <code>{source.artifactId}</code>: {source.usedVersionId} →{" "}
                    {source.currentVersionId}
                    {!source.currentApproved && " (actual sin revisar)"}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  const currents = new Map(
                    stalePins.map((source) => [source.usedVersionId, source.currentVersionId]),
                  );
                  onAdoptPins(activeDraft.pins.map((pin) => currents.get(pin) ?? pin));
                }}
              >
                Usar versiones actuales
              </button>
            </section>
          )}
          {unapprovedCurrents.length > 0 && (
            <p className="hint">
              La versión actual de {unapprovedCurrents.map((s) => s.artifactId).join(", ")} está sin
              revisar (informativo): puedes guardar y seguir diseñando.
            </p>
          )}

          {validation.errors.length > 0 && (
            <section aria-label="Errores del borrador">
              <h4>Errores ({validation.errors.length})</h4>
              <ul className="issue-list errors">
                {validation.errors.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
              <p className="hint">La validación autoritativa es Rust al guardar.</p>
            </section>
          )}
          {validation.warnings.length > 0 && (
            <section aria-label="Avisos del borrador">
              <h4>Avisos ({validation.warnings.length})</h4>
              <ul className="issue-list warnings">
                {validation.warnings.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            </section>
          )}

          {kind === "flow" ? (
            <FlowInspector
              spec={parsed.spec as FlowSpec}
              allowed={activeDraft.allowed}
              selection={effectiveSelection as FlowSelection}
              onSpec={(spec) => commit(spec)}
              onSelect={setSelection}
              onConnectRequest={handleConnectElements}
            />
          ) : (
            <ErInspector
              spec={parsed.spec as ErSpec}
              allowed={activeDraft.allowed}
              selection={effectiveSelection as ErSelection}
              onSpec={(spec) => commit(spec)}
              onSelect={setSelection}
              onConnectRequest={handleConnectElements}
            />
          )}

          <DesignMetaForm
            title={parsed.meta.title}
            explanation={parsed.meta.explanation}
            questions={parsed.meta.questions}
            onTitle={(title) => commit(parsed.spec, { ...parsed.meta, title })}
            onExplanation={(explanation) => commit(parsed.spec, { ...parsed.meta, explanation })}
            onQuestions={(questions) => commit(parsed.spec, { ...parsed.meta, questions })}
          />

          <details>
            <summary>JSON del borrador (solo lectura)</summary>
            <pre className="readonly-box">{draftText}</pre>
          </details>
        </aside>
      </div>
      {layoutNote !== null && <p className="hint">{layoutNote}</p>}
    </div>
  );
}
