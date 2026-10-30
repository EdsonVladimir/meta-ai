// Visual design editor (lazy loaded with the canvas). Composes canvas
// navigation, inspectors, orientative validation and saving. The draft
// lives lifted in the workspace (survives tab switches); here it is only
// interpreted and actions are dispatched. A historic version or a
// non-canonical mount shows the canvas read-only. Saving creates a new
// version with human provenance; reordering without semantic changes
// only saves layout (no empty versions).
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
  /** Shown version (may be historic). */
  versionId: string;
  currentVersionId: string;
  /** JSON content of the shown version. */
  content: string;
  /** CURRENT version sources (initial pins on save). */
  currentPins: string[];
  kind: DesignKind;
  /** Only the canonical mount edits; the rest is read-only. */
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
  { kind: "start", label: "+ Start" },
  { kind: "step", label: "+ Step" },
  { kind: "decision", label: "+ Decision" },
  { kind: "end", label: "+ End" },
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

  // Saved layout (all views) with an obsolescence guard.
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
        setLayoutNote(`No saved layout (${normalizeCoreError(raw).message}).`);
      }
    })();
    return () => {
      fresh = false;
    };
  }, [artifactId, versionId]);

  // Source context for citations and freshness (editing the current one only).
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

  // Selection does not survive a shown-version change.
  useEffect(() => {
    setSelection(null);
  }, [key]);

  const activeDraft = editing && draft?.key === key ? draft : null;
  // Detached draft: the current version moved under the draft
  // (already-reloaded conflict). It does not reset itself: the person
  // decides.
  const detachedDraft =
    editing && draft !== null && draft.key !== key && draft.key.startsWith(`${artifactId}:`)
      ? draft
      : null;

  // Single draft start once there is layout and context (or a declared
  // failure: citations derive from pins as a fallback). A detached
  // draft is not overwritten: it awaits an explicit decision.
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
    // Changing the connection list invalidates the edge selection.
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
        The saved content is not a valid {kind === "flow" ? "flow" : "ER"} design.
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="editor-readonly">
        {!isCurrent && (
          <p className="hint">Historic version, read-only: go back to the current one to edit it.</p>
        )}
        {layoutNote !== null && <p className="hint">{layoutNote}</p>}
        <Suspense fallback={<p className="hint">Loading canvas…</p>}>
          <DesignCanvas
            nodes={nodes}
            edges={edges}
            readOnly
            fitSignal={0}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "node", id })}
            onSelectEdge={(id) =>
              setSelection(id === null ? null : { kind: "edge", index: Number(id.slice(1)) })
            }
            ariaLabel={`Read-only canvas of ${artifactId}`}
          />
        </Suspense>
      </div>
    );
  }

  if (detachedDraft !== null) {
    return (
      <div className="draft-conflict" role="alert">
        <p>
          The design moved to another version while you edited. Your draft is kept intact
          below; to continue, discard it and edit the current version.
        </p>
        <button type="button" className="secondary small" onClick={() => onAction({ type: "reset" })}>
          Discard draft and edit the current one
        </button>
        <details>
          <summary>Kept draft JSON (read-only)</summary>
          <pre className="readonly-box">{detachedDraft.history.present}</pre>
        </details>
      </div>
    );
  }

  if (activeDraft === null || validation === null) {
    return <p className="hint">Preparing the editor…</p>;
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
      <div className="editor-toolbar" role="toolbar" aria-label="Design editing">
        <div className="editor-toolbar-group">
          <button
            type="button"
            className="secondary small"
            disabled={!canUndo(activeDraft.history)}
            onClick={() => onAction({ type: "undo" })}
            aria-label="Undo change"
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!canRedo(activeDraft.history)}
            onClick={() => onAction({ type: "redo" })}
            aria-label="Redo change"
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>
          <span
            className={`draft-badge${semanticDirty ? " dirty" : layoutDirty ? " layout" : ""}`}
            aria-live="polite"
          >
            {semanticDirty ? "Unsaved changes" : layoutDirty ? "Layout only" : "No changes"}
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
                + Entity
              </button>
            )}
        </div>
        <div className="editor-toolbar-group">
          <label className="inline-field">
            <span>Authorship</span>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name"
              autoComplete="off"
              disabled={save.busy || (!semanticDirty && !layoutDirty)}
              aria-label="Review authorship"
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
                  ? "Fix the errors before saving"
                  : "Save as a new version"
              }
            >
              {save.busy ? "Saving…" : "Save version"}
            </button>
          ) : (
            <button
              type="button"
              className="secondary small"
              disabled={save.busy || !layoutDirty}
              onClick={onSaveLayoutOnly}
              title="Save only the layout, no new version"
            >
              {save.busy ? "Saving…" : "Save layout"}
            </button>
          )}
        </div>
      </div>

      {save.error !== null && (
        <p className="error" role="alert">
          {save.error} The draft is kept.
        </p>
      )}

      <div className="editor-main">
        <Suspense fallback={<p className="hint">Loading canvas…</p>}>
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
            ariaLabel={`Editor of ${artifactId}`}
          />
        </Suspense>

        <aside className="editor-inspector" aria-label="Inspector">
          {stalePins.length > 0 && (
            <section className="stale-panel" aria-label="Stale sources">
              <h4>Stale sources</h4>
              <p className="hint">
                These sources changed since the pinned version. Saving with the pinned ones
                will be blocked: explicitly adopt the current ones (this does not imply the
                content is correct; it still requires your review).
              </p>
              <ul>
                {stalePins.map((source) => (
                  <li key={source.artifactId}>
                    <code>{source.artifactId}</code>: {source.usedVersionId} →{" "}
                    {source.currentVersionId}
                    {!source.currentApproved && " (current unreviewed)"}
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
                Use current versions
              </button>
            </section>
          )}
          {unapprovedCurrents.length > 0 && (
            <p className="hint">
              The current version of {unapprovedCurrents.map((s) => s.artifactId).join(", ")} is
              unreviewed (informational): you can save and keep designing.
            </p>
          )}

          {validation.errors.length > 0 && (
            <section aria-label="Draft errors">
              <h4>Errors ({validation.errors.length})</h4>
              <ul className="issue-list errors">
                {validation.errors.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
              <p className="hint">The authoritative validation is Rust on save.</p>
            </section>
          )}
          {validation.warnings.length > 0 && (
            <section aria-label="Draft warnings">
              <h4>Warnings ({validation.warnings.length})</h4>
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
            <summary>Draft JSON (read-only)</summary>
            <pre className="readonly-box">{draftText}</pre>
          </details>
        </aside>
      </div>
      {layoutNote !== null && <p className="hint">{layoutNote}</p>}
    </div>
  );
}
