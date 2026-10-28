// Editor visual de mockups (carga diferida con el lienzo). Compone
// paleta, lienzo de la pantalla activa, inspector y guardado.
//
// El borrador vive elevado en el workspace (sobrevive a cambios de
// pestaña); aquí solo se interpreta y se despachan acciones. La versión
// histórica o el montaje no canónico muestran el lienzo en lectura.
// Guardar crea una versión nueva con procedencia humana; mover o
// redimensionar sin cambiar semántica solo guarda disposición.
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
  autoMockupLayout,
  canonicalMockup,
  componentIds,
  defaultComponentSize,
  detectMockupRename,
  newComponent,
  parseMockupSpec,
  removeComponent,
  screenIds,
  suggestMockupId,
  validateMockupOrientative,
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
  /** Versión mostrada (puede ser histórica). */
  versionId: string;
  currentVersionId: string;
  /** Contenido JSON de la versión mostrada. */
  content: string;
  /** Fuentes de la versión ACTUAL (fijación inicial al guardar). */
  currentPins: string[];
  /** Solo el montaje canónico edita; el resto es lectura. */
  editable: boolean;
  draft: MockupDraftState | null;
  onAction: (action: MockupDraftAction) => void;
  save: MockupSaveState;
  onSave: (author: string) => void;
  onSaveLayoutOnly: () => void;
  onAdoptPins: (pins: string[]) => void;
  onDeclareSources: (pins: string[], allowed: string[]) => void;
}

const PALETTE: { kind: MockupComponentKind; label: string }[] = [
  { kind: "text", label: "+ Texto" },
  { kind: "field", label: "+ Campo" },
  { kind: "selector", label: "+ Selector" },
  { kind: "button", label: "+ Botón" },
  { kind: "table", label: "+ Tabla" },
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

  // Frescura de fuentes para citas y adopción explícita (solo al editar).
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

  // Candidatas a declarar: versiones actuales del módulo (solo al editar).
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

  // La selección y la pantalla no sobreviven a un cambio de versión.
  useEffect(() => {
    setSelection(null);
    setActiveScreen(null);
  }, [key]);

  const activeDraft = editing && draft?.key === key ? draft : null;
  const detachedDraft =
    editing && draft !== null && draft.key !== key && draft.key.startsWith(`${artifactId}:`)
      ? draft
      : null;

  // Inicio único del borrador cuando hay disposición (las citas derivan
  // de las fijaciones). Un borrador separado no se pisa.
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

  // Pantalla activa: la conservada si existe, si no la primera.
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
    return screen.components.map((component) => {
      const entry = layout[component.id] ?? auto[component.id] ?? { x: 0, y: 0 };
      const size = defaultComponentSize(component.kind);
      return {
        id: component.id,
        type: "mockupNode",
        position: { x: entry.x, y: entry.y },
        style: { width: entry.w ?? size.w, height: entry.h ?? size.h },
        data: {
          componentKind: component.kind,
          text: component.text,
          label: component.label,
          fieldType: component.fieldType,
          required: component.required,
          options: component.options,
          columns: component.columns,
          action: component.action,
          target: component.target,
          origin: component.origin,
          readOnly: !editing,
        },
        selected: effectiveSelection?.kind === "component" && effectiveSelection.id === component.id,
      };
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
    const id = suggestMockupId(kind === "field" ? "campo" : kind, componentIds(parsed));
    commit(addComponent(parsed, screenId, newComponent(kind, id)));
    // Posición inicial en la rejilla automática: es disposición, no
    // semántica, y la persona la ajusta arrastrando.
    const count = screen?.components.length ?? 0;
    onAction({ type: "move", id, x: (count % 3) * 220 + 20, y: Math.floor(count / 3) * 110 + 20 });
    setSelection({ kind: "component", id });
  }

  function handleAddScreen(): void {
    if (parsed === null) return;
    const name = screenName.trim() === "" ? "Pantalla" : screenName.trim();
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "pantalla";
    const id = suggestMockupId(base, screenIds(parsed));
    commit(addScreen(parsed, id, name));
    setActiveScreen(id);
    setSelection({ kind: "screen" });
    setScreenName("");
  }

  if (parsed === null) {
    return (
      <p className="error" role="alert">
        El contenido guardado no es un mockup válido.
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
        <ScreenTabs
          spec={parsed}
          screenId={screenId}
          onPick={(id) => {
            setActiveScreen(id);
            setSelection(null);
          }}
        />
        <Suspense fallback={<p className="hint">Cargando lienzo…</p>}>
          <MockupCanvas
            nodes={nodes}
            readOnly
            fitSignal={0}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "component", id })}
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
          El mockup avanzó a otra versión mientras editabas. Tu borrador se conserva íntegro
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
      <div className="editor-toolbar" role="toolbar" aria-label="Edición del mockup">
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
        <div className="editor-toolbar-group" role="group" aria-label="Paleta de componentes">
          {screenId === null ? (
            <span className="hint">Crea una pantalla para dibujar.</span>
          ) : (
            PALETTE.map((item) => (
              <button
                key={item.kind}
                type="button"
                className="secondary small"
                onClick={() => handleAddComponent(item.kind)}
                title={`Añadir ${MOCKUP_COMPONENT_LABELS[item.kind].toLowerCase()} a ${screenId}`}
              >
                {item.label}
              </button>
            ))
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
              disabled={save.busy || validation.length > 0 || author.trim() === ""}
              onClick={() => onSave(author.trim())}
              title={
                validation.length > 0
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

      <div className="mockup-screens-bar">
        <ScreenTabs
          spec={parsed}
          screenId={screenId}
          onPick={(id) => {
            setActiveScreen(id);
            setSelection(null);
          }}
        />
        <div className="add-row">
          <input
            type="text"
            value={screenName}
            placeholder="Nueva pantalla"
            maxLength={200}
            aria-label="Nombre de la pantalla nueva"
            onChange={(e) => setScreenName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddScreen();
            }}
          />
          <button type="button" className="secondary small" onClick={handleAddScreen}>
            + Pantalla
          </button>
        </div>
      </div>

      <div className="editor-main">
        <Suspense fallback={<p className="hint">Cargando lienzo…</p>}>
          <MockupCanvas
            nodes={nodes}
            readOnly={false}
            fitSignal={0}
            onMoveNode={(id, x, y) => onAction({ type: "move", id, x, y })}
            onResizeNode={(id, w, h) => onAction({ type: "resize", id, w, h })}
            onSelectNode={(id) => setSelection(id === null ? null : { kind: "component", id })}
            ariaLabel={`Editor de ${artifactId}`}
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
          {unreviewedCurrents.length > 0 && (
            <p className="hint">
              La versión actual de {unreviewedCurrents.map((s) => s.artifactId).join(", ")} está sin
              revisar (informativo): puedes guardar y seguir diseñando.
            </p>
          )}
          {sourcesFailed && (
            <p className="hint">No se pudo comprobar la frescura de las fuentes.</p>
          )}

          {validation.length > 0 && (
            <section aria-label="Errores del borrador">
              <h4>Errores ({validation.length})</h4>
              <ul className="issue-list errors">
                {validation.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
              <p className="hint">La validación autoritativa es Rust al guardar.</p>
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

          <section className="inspector-meta" aria-label="Datos del mockup">
            <h4>Mockup</h4>
            <CommitInput
              key={`t:${parsed.title}`}
              label="Título"
              value={parsed.title}
              onCommit={(title) => commit({ ...parsed, title })}
              maxLength={200}
            />
          </section>

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
    <section aria-label="Fuentes declaradas">
      <h4>Fuentes ({pins.length})</h4>
      <p className="hint">
        Solo se puede citar lo declarado. Añadir fija la versión actual; quitar una citada
        bloqueará el guardado hasta descitarla.
      </p>
      {pins.length > 0 && (
        <ul className="question-list">
          {[...pins].sort().map((pin) => (
            <li key={pin}>
              <code>{pin}</code>
              <button
                type="button"
                className="secondary small"
                aria-label={`Quitar fuente ${pin}`}
                onClick={() => declare(pins.filter((p) => p !== pin))}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates === null ? (
        <p className="hint">Cargando candidatas…</p>
      ) : available.length === 0 ? (
        <p className="hint">Sin más candidatas en el módulo.</p>
      ) : (
        <div className="add-row">
          <select value={pick} aria-label="Fuente a declarar" onChange={(e) => onPick(e.target.value)}>
            <option value="">Declarar fuente…</option>
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
            Añadir
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
    return <p className="hint">Sin pantallas: crea la primera para dibujar.</p>;
  }
  return (
    <div className="mockup-tabs" role="tablist" aria-label="Pantallas">
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
