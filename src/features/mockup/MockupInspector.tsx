// Inspector del mockup: pantalla activa (identidad, título, citas,
// borrado con limpieza de destinos) y componente seleccionado según su
// tipo (propiedades semánticas + citas). Reutiliza las piezas del
// inspector de diseños (confirmación, citas, borrado).
import { useState } from "react";
import { CommitInput, DeleteConfirm, RefsPicker } from "../design/editing/inspector";
import {
  FIELD_TYPES,
  MAX_MOCKUP_COLUMNS,
  MAX_MOCKUP_LABEL,
  MAX_MOCKUP_OPTIONS,
  MAX_MOCKUP_TEXT,
  MAX_MOCKUP_TITLE,
  MAX_MOCKUP_VALIDATION,
  ORIGINS,
  removeScreenClean,
  renameComponentId,
  renameScreenId,
  setScreenRefs,
  updateComponent,
  type MockupComponent,
  type MockupFieldType,
  type MockupOrigin,
  type MockupSpec,
} from "./mockupModel";
import {
  MOCKUP_COMPONENT_LABELS,
  MOCKUP_FIELD_TYPE_LABELS,
  MOCKUP_ORIGIN_LABELS,
} from "./types";

export type MockupSelection =
  | { kind: "screen" }
  | { kind: "component"; id: string }
  | null;

interface MockupInspectorProps {
  spec: MockupSpec;
  screenId: string;
  /** Artefactos citables (fuentes declaradas del borrador). */
  allowed: string[];
  selection: MockupSelection;
  onSpec: (spec: MockupSpec) => void;
  onSelect: (selection: MockupSelection) => void;
  /** Borrar el componente (el editor limpia su disposición). */
  onRemoveComponent: (screenId: string, componentId: string) => void;
}

function StringListEditor({
  label,
  values,
  max,
  maxLength,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  max: number;
  maxLength: number;
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="field">
      <span>
        {label} ({values.length}/{max})
      </span>
      {values.length > 0 && (
        <ul className="question-list">
          {values.map((value, i) => (
            <li key={`${i}:${value}`}>
              <CommitInput
                label={`${label} ${i + 1}`}
                value={value}
                maxLength={maxLength}
                onCommit={(next) => {
                  const list = [...values];
                  list[i] = next;
                  onChange(list);
                }}
              />
              <button
                type="button"
                className="secondary small"
                aria-label={`Quitar ${label.toLowerCase()} ${i + 1}`}
                onClick={() => onChange(values.filter((_, j) => j !== i))}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {values.length < max && (
        <div className="add-row">
          <input
            type="text"
            value={draft}
            placeholder={placeholder}
            maxLength={maxLength}
            aria-label={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() !== "") {
                onChange([...values, draft.trim()]);
                setDraft("");
              }
            }}
          />
          <button
            type="button"
            className="secondary small"
            disabled={draft.trim() === ""}
            onClick={() => {
              onChange([...values, draft.trim()]);
              setDraft("");
            }}
          >
            Añadir
          </button>
        </div>
      )}
    </div>
  );
}

/** Referencias a elementos de diseño (`artefacto/elemento`). */
function DesignRefsEditor({
  allowed,
  selected,
  onChange,
}: {
  allowed: string[];
  selected: string[];
  onChange: (refs: string[]) => void;
}) {
  const [artifact, setArtifact] = useState("");
  const [element, setElement] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (allowed.length === 0) return null;
  function add() {
    setError(null);
    const ref = `${artifact.trim()}/${element.trim()}`;
    if (artifact.trim() === "" || element.trim() === "") {
      setError("Indica artefacto y elemento.");
      return;
    }
    if (!allowed.includes(artifact.trim())) {
      setError("El artefacto no está entre las fuentes.");
      return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(element.trim())) {
      setError("El elemento usa letras, dígitos y subrayado.");
      return;
    }
    if (selected.includes(ref)) {
      setError("Esa referencia ya está citada.");
      return;
    }
    onChange([...selected, ref].sort());
    setArtifact("");
    setElement("");
  }
  return (
    <div className="field">
      <span>Elementos de diseño citados ({selected.length}/8)</span>
      {selected.length > 0 && (
        <ul className="question-list">
          {selected.map((ref) => (
            <li key={ref}>
              <code>{ref}</code>
              <button
                type="button"
                className="secondary small"
                aria-label={`Quitar referencia ${ref}`}
                onClick={() => onChange(selected.filter((r) => r !== ref))}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length < 8 && (
        <div className="add-row">
          <select
            value={artifact}
            aria-label="Artefacto de diseño"
            onChange={(e) => setArtifact(e.target.value)}
          >
            <option value="">Artefacto…</option>
            {allowed.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={element}
            placeholder="elemento"
            maxLength={64}
            aria-label="Elemento del diseño"
            onChange={(e) => setElement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button type="button" className="secondary small" onClick={add}>
            Añadir
          </button>
        </div>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">Enlaces informativos, no dependencias del núcleo.</p>
    </div>
  );
}

export function MockupInspector({
  spec,
  screenId,
  allowed,
  selection,
  onSpec,
  onSelect,
  onRemoveComponent,
}: MockupInspectorProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const screen = spec.screens.find((s) => s.id === screenId);
  const component: MockupComponent | undefined =
    selection?.kind === "component"
      ? screen?.components.find((c) => c.id === selection.id)
      : undefined;

  function patchComponent(patch: Partial<MockupComponent>): void {
    if (screen === undefined || component === undefined) return;
    onSpec(updateComponent(spec, screen.id, component.id, patch));
  }

  return (
    <div className="inspector-body">
      {screen !== undefined && (selection === null || selection.kind === "screen") && (
        <section aria-label={`Pantalla ${screen.id}`}>
          <h4>
            Pantalla <code>{screen.id}</code>
          </h4>
          <CommitInput
            key={`sid:${screen.id}`}
            label="Identificador"
            value={screen.id}
            maxLength={64}
            onCommit={(next) => {
              if (next.trim() === screen.id) return;
              const renamed = renameScreenId(spec, screen.id, next);
              if (!renamed.ok) {
                setRenameError(renamed.reason);
                return;
              }
              setRenameError(null);
              onSpec(renamed.spec);
            }}
          />
          <CommitInput
            key={`st:${screen.id}:${screen.title}`}
            label="Título"
            value={screen.title}
            maxLength={MAX_MOCKUP_TITLE}
            onCommit={(next) => {
              if (next === screen.title) return;
              onSpec({
                ...spec,
                screens: spec.screens.map((s) => (s.id === screen.id ? { ...s, title: next } : s)),
              });
            }}
          />
          {renameError !== null && (
            <p className="error" role="alert">
              {renameError}
            </p>
          )}
          <RefsPicker
            allowed={allowed}
            selected={screen.requirements}
            onChange={(requirements) => onSpec(setScreenRefs(spec, screen.id, { requirements }))}
          />
          <DesignRefsEditor
            allowed={allowed}
            selected={screen.designs}
            onChange={(designs) => onSpec(setScreenRefs(spec, screen.id, { designs }))}
          />
          {confirming === `screen:${screen.id}` ? (
            <DeleteConfirm
              what={`pantalla ${screen.id}`}
              consequences={screenDeleteConsequences(spec, screen.id)}
              onConfirm={() => {
                setConfirming(null);
                onSpec(removeScreenClean(spec, screen.id).spec);
                onSelect(null);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <button
              type="button"
              className="danger small"
              onClick={() => setConfirming(`screen:${screen.id}`)}
            >
              Eliminar pantalla
            </button>
          )}
        </section>
      )}

      {component !== undefined && (
        <section aria-label={`Componente ${component.id}`}>
          <h4>
            {MOCKUP_COMPONENT_LABELS[component.kind]} <code>{component.id}</code>
          </h4>
          <CommitInput
            key={`cid:${component.id}`}
            label="Identificador"
            value={component.id}
            maxLength={64}
            onCommit={(next) => {
              if (screen === undefined || next.trim() === component.id) return;
              const renamed = renameComponentId(spec, screen.id, component.id, next);
              if (!renamed.ok) {
                setRenameError(renamed.reason);
                return;
              }
              setRenameError(null);
              onSpec(renamed.spec);
              onSelect({ kind: "component", id: next.trim() });
            }}
          />
          {renameError !== null && (
            <p className="error" role="alert">
              {renameError}
            </p>
          )}
          {component.kind === "text" && (
            <CommitInput
              key={`text:${component.id}:${component.text ?? ""}`}
              label="Texto"
              value={component.text ?? ""}
              maxLength={MAX_MOCKUP_TEXT}
              multiline
              onCommit={(text) => patchComponent({ text })}
            />
          )}
          {component.kind !== "text" && (
            <CommitInput
              key={`label:${component.id}:${component.label ?? ""}`}
              label="Etiqueta"
              value={component.label ?? ""}
              maxLength={MAX_MOCKUP_LABEL}
              onCommit={(label) => patchComponent({ label })}
            />
          )}
          {component.kind === "field" && (
            <>
              <label className="field">
                <span>Tipo de campo</span>
                <select
                  value={component.fieldType ?? ""}
                  onChange={(e) => patchComponent({ fieldType: e.target.value as MockupFieldType })}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MOCKUP_FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={component.required}
                  onChange={(e) => patchComponent({ required: e.target.checked })}
                />
                Obligatorio
              </label>
              <CommitInput
                key={`val:${component.id}:${component.validation ?? ""}`}
                label="Validación (opcional)"
                value={component.validation ?? ""}
                maxLength={MAX_MOCKUP_VALIDATION}
                placeholder="p. ej. solo letras"
                onCommit={(next) =>
                  patchComponent({ validation: next.trim() === "" ? undefined : next })
                }
              />
            </>
          )}
          {component.kind === "selector" && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={component.required}
                  onChange={(e) => patchComponent({ required: e.target.checked })}
                />
                Obligatorio
              </label>
              <StringListEditor
                label="Opciones"
                values={component.options}
                max={MAX_MOCKUP_OPTIONS}
                maxLength={MAX_MOCKUP_LABEL}
                placeholder="Nueva opción"
                onChange={(options) => patchComponent({ options })}
              />
            </>
          )}
          {component.kind === "button" && (
            <>
              <CommitInput
                key={`act:${component.id}:${component.action ?? ""}`}
                label="Acción (opcional)"
                value={component.action ?? ""}
                maxLength={MAX_MOCKUP_LABEL}
                placeholder="p. ej. confirmar_reserva"
                onCommit={(next) =>
                  patchComponent({ action: next.trim() === "" ? undefined : next })
                }
              />
              <label className="field">
                <span>Navega a (opcional)</span>
                <select
                  value={component.target ?? ""}
                  onChange={(e) =>
                    patchComponent({ target: e.target.value === "" ? undefined : e.target.value })
                  }
                >
                  <option value="">Sin destino</option>
                  {spec.screens.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} ({s.id})
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {component.kind === "table" && (
            <StringListEditor
              label="Columnas"
              values={component.columns}
              max={MAX_MOCKUP_COLUMNS}
              maxLength={MAX_MOCKUP_LABEL}
              placeholder="Nueva columna"
              onChange={(columns) => patchComponent({ columns })}
            />
          )}
          {(component.kind === "field" ||
            component.kind === "selector" ||
            component.kind === "table") && (
            <label className="field">
              <span>Origen del dato</span>
              <select
                value={component.origin ?? ""}
                onChange={(e) => patchComponent({ origin: e.target.value as MockupOrigin })}
              >
                <option value="">Sin declarar…</option>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {MOCKUP_ORIGIN_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(component.kind === "field" ||
            component.kind === "selector" ||
            component.kind === "table") &&
            component.origin === "persisted" && (
              <p className="hint">
                Declarado como guardado: aun así, nada crea tablas ni columnas por sí solo.
              </p>
            )}
          <RefsPicker
            allowed={allowed}
            selected={component.requirements}
            onChange={(requirements) => patchComponent({ requirements })}
          />
          <DesignRefsEditor
            allowed={allowed}
            selected={component.designs}
            onChange={(designs) => patchComponent({ designs })}
          />
          {confirming === `component:${component.id}` ? (
            <DeleteConfirm
              what={`${MOCKUP_COMPONENT_LABELS[component.kind].toLowerCase()} ${component.id}`}
              consequences={[`Se quitará de la pantalla ${screen?.id ?? ""}.`]}
              onConfirm={() => {
                if (screen === undefined) return;
                setConfirming(null);
                onSelect(null);
                onRemoveComponent(screen.id, component.id);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <button
              type="button"
              className="danger small"
              onClick={() => setConfirming(`component:${component.id}`)}
            >
              Eliminar componente
            </button>
          )}
        </section>
      )}

      {selection !== null && screen === undefined && (
        <p className="hint">Pantalla inexistente: elige otra en el selector.</p>
      )}
    </div>
  );
}

function screenDeleteConsequences(spec: MockupSpec, screenId: string): string[] {
  const screen = spec.screens.find((s) => s.id === screenId);
  const lines = [
    `Se borrará la pantalla con sus ${screen?.components.length ?? 0} componentes.`,
  ];
  const pointing: string[] = [];
  for (const s of spec.screens) {
    for (const c of s.components) {
      if (c.target === screenId) pointing.push(`${s.id}/${c.id}`);
    }
  }
  if (pointing.length > 0) {
    lines.push(`Se quitará el destino de: ${pointing.join(", ")}.`);
  }
  return lines;
}
