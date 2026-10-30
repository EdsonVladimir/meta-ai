// Visual mockup editor (lazy loaded with the canvas). Composes the
// palette, the active-screen canvas, the inspector and saving. The
// draft lives lifted in the workspace (survives tab switches); here it
// is only interpreted and actions are dispatched. A historic version or
// a non-canonical mount shows the canvas read-only. Saving creates a
// new version with human provenance; moving or resizing without
// semantic changes only saves layout.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import type { UpdateSourceDto } from "../design/types";
import { designLayout } from "../design/client";
import { artifactOfVersion, parseLayout, type Layout } from "../design/editing/specModel";
import { canRedo, canUndo } from "../design/editing/specHistory";
import { normalizeCoreError } from "../requirements/types";
import { mockupContext, mockupSources } from "./client";
import { MockupInspector, type MockupSelection } from "./MockupInspector";
import {
  addComponent,
  addScreen,
  alignMoves,
  autoMockupLayout,
  canonicalMockup,
  componentIds,
  defaultComponentSize,
  detectMockupRename,
  duplicateComponent,
  newComponent,
  parseMockupSpec,
  removeComponent,
  screenIds,
  suggestMockupId,
  validateMockupOrientative,
  type MockupAlign,
  type MockupBox,
  type MockupComponentKind,
  type MockupSpec,
} from "./mockupModel";
import {
  mockupLayoutDirty,
  mockupSemanticDirty,
  type MockupDraftAction,
  type MockupDraftState,
} from "./mockupDraft";
import { CommitInput } from "../design/editing/inspector";
import { buildScreenNodes } from "./screenNodes";
import { MOCKUP_COMPONENT_LABELS } from "./types";

const MockupCanvas = lazy(() =>
  import("./MockupCanvas").then((module) => ({ default: module.MockupCanvas })),
);

export interface MockupSaveState {
  busy: boolean;
  error: string | null;
}

interface ModuleCandidate {
  artifactId: string;
  versionId: string;
}

interface MockupEditorProps {
  projectId: string;
  moduleId: string;
  artifactId: string;
  /** Shown version (may be historic). */
  versionId: string;
  currentVersionId: string;
  /** JSON content of the shown version. */
  content: string;
  /** CURRENT version sources (initial pins on save). */
  currentPins: string[];
  /** Only the canonical mount edits; the rest is read-only. */
  editable: boolean;
  draft: MockupDraftState | null;
  onAction: (action: MockupDraftAction) => void;
  save: MockupSaveState;
  onSave: (author: string) => void;
  onSaveLayoutOnly: () => void;
  onAdoptPins: (pins: string[]) => void;
  onDeclareSources: (pins: string[], allowed: string[]) => void;
  /** Screen requested from outside (tree). Null = the kept or first one. */
  screenId: string | null;
  onScreenChange: (id: string | null) => void;
}

const PALETTE: { kind: MockupComponentKind; label: string }[] = [
  { kind: "text", label: "+ Text" },
  { kind: "field", label: "+ Field" },
  { kind: "selector", label: "+ Selector" },
  { kind: "button", label: "+ Button" },
  { kind: "table", label: "+ Table" },
  { kind: "container", label: "+ Container" },
  { kind: "icon", label: "+ Icon" },
];

function parseDraft(text: string): MockupSpec | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return parseMockupSpec(value);
}

export function MockupEditor({
  projectId,
  moduleId,
  artifactId,
  versionId,
  currentVersionId,
  content,
  currentPins,
  editable,
  draft,
  onAction,
  save,
  onSave,
  onSaveLayoutOnly,
  onAdoptPins,
  onDeclareSources,
  screenId: externalScreenId,
  onScreenChange,
}: MockupEditorProps) {
  const isCurrent = versionId === currentVersionId;
  const editing = editable && isCurrent;
  const key = `${artifactId}:${versionId}`;
  const [savedLayout, setSavedLayout] = useState<Layout | null>(null);
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  const [sources, setSources] = useState<UpdateSourceDto[] | null>(null);
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [selection, setSelection] = useState<MockupSelection>(null);
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  const [author, setAuthor] = useState("");
  const [screenName, setScreenName] = useState("");
  const [grid, setGrid] = useState(true);

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

  // Source freshness for citations and explicit adoption (editing only).
  useEffect(() => {
    if (!editing) return;
    let fresh = true;
    setSources(null);
    setSourcesFailed(false);
    void (async () => {
      try {
        const rows = await mockupSources(projectId, artifactId);
        if (fresh) setSources(rows);
      } catch {
        if (fresh) setSourcesFailed(true);
      }
    })();
    return () => {
      fresh = false;
    };
  }, [editing, projectId, artifactId]);

  // Candidates to declare: current module versions (editing only).
  const [candidates, setCandidates] = useState<ModuleCandidate[] | null>(null);
  const [candidatePick, setCandidatePick] = useState("");
  useEffect(() => {
    if (!editing) return;
    let fresh = true;
    setCandidates(null);
    setCandidatePick("");
    void (async () => {
      try {
        const preview = await mockupContext(projectId, moduleId);
        if (!fresh) return;
        const rows = [...preview.requirements, ...preview.designs, ...preview.mockups]
          .filter((item) => item.artifactId !== artifactId)
          .map((item) => ({ artifactId: item.artifactId, versionId: item.versionId }))
          .sort((a, b) => a.artifactId.localeCompare(b.artifactId));
        setCandidates(rows);
      } catch {
        if (fresh) setCandidates([]);
      }
    })();
    return () => {
      fresh = false;
    };
  }, [editing, projectId, moduleId, artifactId]);

  // Selection and screen do not survive a version change.
  useEffect(() => {
    setSelection(null);
    setActiveScreen(null);
  }, [key]);

  // The tree may request a screen: adopted when it exists (otherwise
  // the first-screen fallback ignores it without breaking anything).
  useEffect(() => {
    if (externalScreenId !== null) setActiveScreen(externalScreenId);
  }, [externalScreenId, key]);

  function pickScreen(id: string): void {
    setActiveScreen(id);
    setSelection(null);
    onScreenChange(id);
  }

  const activeDraft = editing && draft?.key === key ? draft : null;
  const detachedDraft =
    editing && draft !== null && draft.key !== key && draft.key.startsWith(`${artifactId}:`)
      ? draft
      : null;

  // Single draft start once there is layout (citations derive from
  // pins). A detached draft is not overwritten.
  useEffect(() => {
    if (!editing || savedLayout === null) return;
    if (draft !== null && (draft.key === key || draft.key.startsWith(`${artifactId}:`))) return;
    const allowed = [
      ...new Set(currentPins.map(artifactOfVersion).filter((id): id is string => id !== null)),
    ].sort();
    onAction({ type: "init", key, base: content, layout: savedLayout, allowed, pins: currentPins });
  }, [editing, savedLayout, draft, key, content, currentPins, onAction, artifactId]);

  const draftText = activeDraft?.history.present ?? content;
  const parsed = useMemo(() => parseDraft(draftText), [draftText]);
  const layout = activeDraft?.layout ?? savedLayout ?? {};

  // Active screen: the kept one when it exists, else the first.
  const screenId =
    parsed !== null && activeScreen !== null && parsed.screens.some((s) => s.id === activeScreen)
      ? activeScreen
      : (parsed?.screens[0]?.id ?? null);

  const effectiveSelection: MockupSelection = useMemo(() => {
    if (parsed === null || selection === null || screenId === null) return null;
    if (selection.kind === "screen") return selection;
    const screen = parsed.screens.find((s) => s.id === screenId);
    return screen?.components.some((c) => c.id === selection.id) ? selection : null;
  }, [parsed, selection, screenId]);

  const screen = parsed?.screens.find((s) => s.id === screenId) ?? null;
  const auto = useMemo(
    () => (parsed === null || screenId === null ? {} : autoMockupLayout(parsed, screenId)),
    [parsed, screenId],
  );

  const nodes: Node[] = useMemo(() => {
    if (screen === null) return [];
    const positions: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
    for (const component of screen.components) {
      const entry = layout[component.id] ?? auto[component.id];
      if (entry) positions[component.id] = entry;
    }
    return buildScreenNodes(screen, positions, {
      readOnly: !editing,
      selectedId: effectiveSelection?.kind === "component" ? effectiveSelection.id : undefined,
    });
  }, [screen, layout, auto, editing, effectiveSelection]);

  const validation = useMemo(() => {
    if (parsed === null || activeDraft === null) return null;
    return validateMockupOrientative(parsed, activeDraft.allowed);
  }, [parsed, activeDraft]);

  function commit(next: MockupSpec): void {
    if (parsed === null) return;
    const renamed = detectMockupRename(parsed, next);
    if (renamed !== null && activeDraft !== null) {
      onAction({ type: "remap", oldId: renamed[0], newId: renamed[1] });
    }
    onAction({ type: "apply", spec: canonicalMockup(next) });
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

  function handleAddComponent(kind: MockupComponentKind): void {
    if (parsed === null || screenId === null) return;
    const id = suggestMockupId(kind === "field" ? "field" : kind, componentIds(parsed));
    commit(addComponent(parsed, screenId, newComponent(kind, id)));
    // Initial position on the automatic grid: it is layout, not
    // semantics, and the person adjusts it by dragging.
    const count = screen?.components.length ?? 0;
    onAction({ type: "move", id, x: (count % 3) * 220 + 20, y: Math.floor(count / 3) * 110 + 20 });
    setSelection({ kind: "component", id });
  }

  function handleDuplicate(): void {
    if (parsed === null || screenId === null || effectiveSelection?.kind !== "component") return;
    const dup = duplicateComponent(parsed, screenId, effectiveSelection.id);
    if (!dup) return;
    commit(dup.spec);
    // Clones appear offset next to their original.
    for (const clone of dup.clones) {
      const entry = layout[clone.from];
      onAction({ type: "move", id: clone.id, x: (entry?.x ?? 0) + 24, y: (entry?.y ?? 0) + 24 });
    }
    setSelection({ kind: "component", id: dup.cloneId });
  }

  function handleAlign(mode: MockupAlign): void {
    if (screen === null) return;
    // With a container selected its children align; otherwise the whole
    // screen. Layout only: semantics untouched.
    const selected =
      effectiveSelection?.kind === "component"
        ? screen.components.find((c) => c.id === effectiveSelection.id)
        : undefined;
    const ids =
      selected?.kind === "container" && selected.children.length > 0
        ? selected.children
        : screen.components.map((c) => c.id);
    const boxes: MockupBox[] = [];
    for (const id of ids) {
      const component = screen.components.find((c) => c.id === id);
      if (!component) continue;
      const entry = layout[id] ?? auto[id] ?? { x: 0, y: 0 };
      const size = defaultComponentSize(component.kind);
      boxes.push({ id, x: entry.x, y: entry.y, w: entry.w ?? size.w, h: entry.h ?? size.h });
    }
    for (const move of alignMoves(boxes, mode)) {
      onAction({ type: "move", id: move.id, x: move.x, y: move.y });
    }
  }

  function handleAddScreen(): void {
    if (parsed === null) return;
    const name = screenName.trim() === "" ? "Screen" : screenName.trim();
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "screen";
    const id = suggestMockupId(base, screenIds(parsed));
    commit(addScreen(parsed, id, name));
    setActiveScreen(id);
    setSelection({ kind: "screen" });
    setScreenName("");
    onScreenChange(id);
  }

  if (parsed === null) {
    return (
      <p className="error" role="alert">
        The saved content is not a valid mockup.
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
        <ScreenTabs
          spec={parsed}
          screenId={screenId}
          onPick={pickScreen}
        />
        <Suspense fallback={<p className="hint">Loading canvas…</p>}>
          <MockupCanvas
            nodes={nodes}
            readOnly
            fitSignal={0}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "component", id })}
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
          The mockup moved to another version while you edited. Your draft is kept intact
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

  const semanticDirty = mockupSemanticDirty(activeDraft);
  const layoutDirty = mockupLayoutDirty(activeDraft);
  const stalePins =
    sources !== null
      ? sources.filter(
          (source) => source.changed && activeDraft.pins.includes(source.usedVersionId),
        )
      : [];
  const unreviewedCurrents =
    sources !== null
      ? sources.filter(
          (source) =>
            activeDraft.pins.includes(source.currentVersionId) && !source.currentApproved,
        )
      : [];

  return (
    <div className="design-editor mockup-editor" onKeyDown={handleKeyDown}>
      <div className="editor-toolbar" role="toolbar" aria-label="Mockup editing">
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
        <div className="editor-toolbar-group" role="group" aria-label="Component palette">
          {screenId === null ? (
            <span className="hint">Create a screen to draw.</span>
          ) : (
            PALETTE.map((item) => (
              <button
                key={item.kind}
                type="button"
                className="secondary small"
                onClick={() => handleAddComponent(item.kind)}
                title={`Add ${MOCKUP_COMPONENT_LABELS[item.kind].toLowerCase()} to ${screenId}`}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
        <div className="editor-toolbar-group" role="group" aria-label="Duplicate and align">
          <button
            type="button"
            className="secondary small"
            disabled={effectiveSelection?.kind !== "component"}
            onClick={handleDuplicate}
            title="Duplicate the selected component with new IDs"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => handleAlign("left")}
            title="Align left (container children or whole screen)"
            aria-label="Align left"
          >
            ⬅│
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => handleAlign("top")}
            title="Align top (container children or whole screen)"
            aria-label="Align top"
          >
            ⬆‾
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => handleAlign("distributeH")}
            title="Distribute horizontally (3 or more)"
            aria-label="Distribute horizontally"
          >
            ⇄
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => handleAlign("distributeV")}
            title="Distribute vertically (3 or more)"
            aria-label="Distribute vertically"
          >
            ⇅
          </button>
          <button
            type="button"
            className="secondary small"
            aria-pressed={grid}
            onClick={() => setGrid((v) => !v)}
            title="Show or hide the grid"
          >
            Grid
          </button>
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
              disabled={save.busy || validation.length > 0 || author.trim() === ""}
              onClick={() => onSave(author.trim())}
              title={
                validation.length > 0
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

      <div className="mockup-screens-bar">
        <ScreenTabs
          spec={parsed}
          screenId={screenId}
          onPick={pickScreen}
        />
        <div className="add-row">
          <input
            type="text"
            value={screenName}
            placeholder="New screen"
            maxLength={200}
            aria-label="New screen name"
            onChange={(e) => setScreenName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddScreen();
            }}
          />
          <button type="button" className="secondary small" onClick={handleAddScreen}>
            + Screen
          </button>
        </div>
      </div>

      <div className="editor-main">
        <Suspense fallback={<p className="hint">Loading canvas…</p>}>
          <MockupCanvas
            nodes={nodes}
            readOnly={false}
            fitSignal={0}
            grid={grid}
            onMoveNode={(id, x, y) => onAction({ type: "move", id, x, y })}
            onResizeNode={(id, w, h) => onAction({ type: "resize", id, w, h })}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "component", id })}
            ariaLabel={`Editor of ${artifactId}`}
          />
        </Suspense>

        <aside className="editor-inspector" aria-label="Inspector">
          <SourcesSection
            pins={activeDraft.pins}
            candidates={candidates}
            pick={candidatePick}
            onPick={setCandidatePick}
            onDeclare={(pins, allowed) => onDeclareSources(pins, allowed)}
          />
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
          {unreviewedCurrents.length > 0 && (
            <p className="hint">
              The current version of {unreviewedCurrents.map((s) => s.artifactId).join(", ")} is
              unreviewed (informational): you can save and keep designing.
            </p>
          )}
          {sourcesFailed && (
            <p className="hint">Source freshness could not be checked.</p>
          )}

          {validation.length > 0 && (
            <section aria-label="Draft errors">
              <h4>Errors ({validation.length})</h4>
              <ul className="issue-list errors">
                {validation.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
              <p className="hint">The authoritative validation is Rust on save.</p>
            </section>
          )}

          <MockupInspector
            spec={parsed}
            screenId={screenId ?? ""}
            allowed={activeDraft.allowed}
            selection={effectiveSelection}
            onSpec={commit}
            onSelect={setSelection}
            onRemoveComponent={(sid, cid) => commit(removeComponent(parsed, sid, cid))}
          />

          <section className="inspector-meta" aria-label="Mockup data">
            <h4>Mockup</h4>
            <CommitInput
              key={`t:${parsed.title}`}
              label="Title"
              value={parsed.title}
              onCommit={(title) => commit({ ...parsed, title })}
              maxLength={200}
            />
          </section>

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

function SourcesSection({
  pins,
  candidates,
  pick,
  onPick,
  onDeclare,
}: {
  pins: string[];
  candidates: ModuleCandidate[] | null;
  pick: string;
  onPick: (value: string) => void;
  onDeclare: (pins: string[], allowed: string[]) => void;
}) {
  const pinnedArtifacts = new Set(
    pins.map(artifactOfVersion).filter((id): id is string => id !== null),
  );
  const available = (candidates ?? []).filter((c) => !pinnedArtifacts.has(c.artifactId));
  function declare(next: string[]) {
    const allowed = [
      ...new Set(next.map(artifactOfVersion).filter((id): id is string => id !== null)),
    ].sort();
    onDeclare(next, allowed);
  }
  return (
    <section aria-label="Declared sources">
      <h4>Sources ({pins.length})</h4>
      <p className="hint">
        Only declared sources can be cited. Adding pins the current version; removing a
        cited one will block saving until it is uncited.
      </p>
      {pins.length > 0 && (
        <ul className="question-list">
          {[...pins].sort().map((pin) => (
            <li key={pin}>
              <code>{pin}</code>
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove source ${pin}`}
                onClick={() => declare(pins.filter((p) => p !== pin))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates === null ? (
        <p className="hint">Loading candidates…</p>
      ) : available.length === 0 ? (
        <p className="hint">No more candidates in the module.</p>
      ) : (
        <div className="add-row">
          <select value={pick} aria-label="Source to declare" onChange={(e) => onPick(e.target.value)}>
            <option value="">Declare source…</option>
            {available.map((c) => (
              <option key={c.artifactId} value={c.versionId}>
                {c.artifactId} ({c.versionId})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary small"
            disabled={pick === ""}
            onClick={() => {
              declare([...pins, pick]);
              onPick("");
            }}
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

function ScreenTabs({
  spec,
  screenId,
  onPick,
}: {
  spec: MockupSpec;
  screenId: string | null;
  onPick: (id: string) => void;
}) {
  if (spec.screens.length === 0) {
    return <p className="hint">No screens: create the first one to draw.</p>;
  }
  return (
    <div className="mockup-tabs" role="tablist" aria-label="Screens">
      {spec.screens.map((screen) => (
        <button
          key={screen.id}
          type="button"
          role="tab"
          aria-selected={screen.id === screenId}
          className={screen.id === screenId ? "active" : ""}
          onClick={() => onPick(screen.id)}
          title={screen.id}
        >
          {screen.title}
        </button>
      ))}
    </div>
  );
}
