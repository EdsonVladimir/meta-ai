// Mockup inspector: active screen (identity, title, states, citations,
// deletion with target cleanup) and selected component per its type
// (semantic properties + citations). Reuses the design-inspector pieces
// (confirmation, citations, deletion).
import { useState } from "react";
import { CommitInput, DeleteConfirm, RefsPicker } from "../design/editing/inspector";
import {
  ACTION_KINDS,
  BUTTON_STATES,
  DIRECTIONS,
  FIELD_TYPES,
  ICON_ROLES,
  MAX_MOCKUP_COLUMNS,
  MAX_MOCKUP_LABEL,
  MAX_MOCKUP_OPTIONS,
  MAX_MOCKUP_PREVIEW_ROWS,
  MAX_MOCKUP_ROW_ACTIONS,
  MAX_MOCKUP_STATES,
  MAX_MOCKUP_TEXT,
  MAX_MOCKUP_TITLE,
  MAX_MOCKUP_VALIDATION,
  MAX_MOCKUP_VALIDATIONS,
  ORIGINS,
  parentOf,
  removeScreenClean,
  renameComponentId,
  renameScreenId,
  setScreenRefs,
  updateComponent,
  type MockupActionKind,
  type MockupButtonState,
  type MockupComponent,
  type MockupDirection,
  type MockupFieldType,
  type MockupIconRole,
  type MockupOrigin,
  type MockupSpec,
} from "./mockupModel";
import {
  MOCKUP_ACTION_LABELS,
  MOCKUP_BUTTON_STATE_LABELS,
  MOCKUP_COMPONENT_LABELS,
  MOCKUP_DIRECTION_LABELS,
  MOCKUP_FIELD_TYPE_LABELS,
  MOCKUP_ICON_ROLE_LABELS,
  MOCKUP_ORIGIN_LABELS,
} from "./types";
import { MOCKUP_ICON_CATALOG, searchMockupIcons } from "./mockupIcons";
import { MockupIcon } from "./MockupIcon";

export type MockupSelection =
  | { kind: "screen" }
  | { kind: "component"; id: string }
  | null;

interface MockupInspectorProps {
  spec: MockupSpec;
  screenId: string;
  /** Citable artifacts (draft declared sources). */
  allowed: string[];
  selection: MockupSelection;
  onSpec: (spec: MockupSpec) => void;
  onSelect: (selection: MockupSelection) => void;
  /** Delete the component (the editor clears its layout). */
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
                aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
                onClick={() => onChange(values.filter((_, j) => j !== i))}
              >
                Remove
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
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/** References to design elements (`artifact/element`). */
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
      setError("Enter artifact and element.");
      return;
    }
    if (!allowed.includes(artifact.trim())) {
      setError("The artifact is not among the sources.");
      return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(element.trim())) {
      setError("The element uses letters, digits and underscore.");
      return;
    }
    if (selected.includes(ref)) {
      setError("That reference is already cited.");
      return;
    }
    onChange([...selected, ref].sort());
    setArtifact("");
    setElement("");
  }
  return (
    <div className="field">
      <span>Cited design elements ({selected.length}/8)</span>
      {selected.length > 0 && (
        <ul className="question-list">
          {selected.map((ref) => (
            <li key={ref}>
              <code>{ref}</code>
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove reference ${ref}`}
                onClick={() => onChange(selected.filter((r) => r !== ref))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length < 8 && (
        <div className="add-row">
          <select
            value={artifact}
            aria-label="Design artifact"
            onChange={(e) => setArtifact(e.target.value)}
          >
            <option value="">Artifact…</option>
            {allowed.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={element}
            placeholder="element"
            maxLength={64}
            aria-label="Design element"
            onChange={(e) => setElement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button type="button" className="secondary small" onClick={add}>
            Add
          </button>
        </div>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">Informational links, not core dependencies.</p>
    </div>
  );
}

/** Declarative action shared by buttons and action icons. */
function ActionFields({
  component,
  screens,
  onPatch,
}: {
  component: MockupComponent;
  screens: MockupSpec["screens"];
  onPatch: (patch: Partial<MockupComponent>) => void;
}) {
  const navigates = component.actionKind === undefined || component.actionKind === "navigate";
  return (
    <>
      <label className="field">
        <span>Action</span>
        <select
          value={component.actionKind ?? ""}
          onChange={(e) =>
            onPatch({ actionKind: (e.target.value as MockupActionKind) || undefined })
          }
        >
          <option value="">No action…</option>
          {ACTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {MOCKUP_ACTION_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      <CommitInput
        key={`op:${component.id}:${component.operation ?? ""}`}
        label="Operation (optional)"
        value={component.operation ?? ""}
        maxLength={MAX_MOCKUP_LABEL}
        placeholder="e.g. confirm_booking"
        onCommit={(next) => onPatch({ operation: next.trim() === "" ? undefined : next })}
      />
      <label className="field">
        <span>{navigates ? "Navigates to (optional)" : "Target or reference (optional)"}</span>
        {navigates ? (
          <select
            value={component.target ?? ""}
            onChange={(e) =>
              onPatch({ target: e.target.value === "" ? undefined : e.target.value })
            }
          >
            <option value="">No target</option>
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.id})
              </option>
            ))}
          </select>
        ) : (
          <CommitInput
            key={`tgt:${component.id}:${component.target ?? ""}`}
            label="Target or reference"
            value={component.target ?? ""}
            maxLength={64}
            placeholder="e.g. dlg_help"
            onCommit={(next) => onPatch({ target: next.trim() === "" ? undefined : next.trim() })}
          />
        )}
      </label>
      <label className="field">
        <span>State</span>
        <select
          value={component.buttonState ?? "enabled"}
          onChange={(e) => {
            const next = e.target.value as MockupButtonState;
            onPatch({ buttonState: next === "enabled" ? undefined : next });
          }}
        >
          {BUTTON_STATES.map((state) => (
            <option key={state} value={state}>
              {MOCKUP_BUTTON_STATE_LABELS[state]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** One type per column; changing columns readjusts the list. */
function ColumnTypesEditor({
  columns,
  types,
  onChange,
}: {
  columns: string[];
  types: MockupFieldType[];
  onChange: (types: MockupFieldType[]) => void;
}) {
  if (columns.length === 0) return null;
  const effective: MockupFieldType[] = columns.map((_, i) => types[i] ?? "text");
  const customized = types.length > 0;
  return (
    <div className="field">
      <span>Column types</span>
      {effective.map((type, i) => (
        <label key={`${columns[i]}-${i}`} className="inline-field">
          <span>{columns[i]}</span>
          <select
            value={type}
            disabled={!customized}
            aria-label={`Type of ${columns[i]}`}
            onChange={(e) => {
              const next = [...effective];
              next[i] = e.target.value as MockupFieldType;
              onChange(next);
            }}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {MOCKUP_FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="add-row">
        {!customized ? (
          <button type="button" className="secondary small" onClick={() => onChange(effective)}>
            Define types
          </button>
        ) : (
          <button type="button" className="secondary small" onClick={() => onChange([])}>
            Back to all text
          </button>
        )}
      </div>
      <p className="hint">Undefined means all text. Preview types, not schema.</p>
    </div>
  );
}

/** Sample rows: declared fiction for the preview. */
function PreviewRowsEditor({
  columns,
  rows,
  onChange,
}: {
  columns: string[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
}) {
  if (columns.length === 0) return null;
  return (
    <div className="field">
      <span>
        Sample rows ({rows.length}/{MAX_MOCKUP_PREVIEW_ROWS})
      </span>
      {rows.map((row, r) => (
        <div key={r} className="preview-row">
          {columns.map((col, c) => (
            <input
              key={`${col}-${c}`}
              type="text"
              value={row[c] ?? ""}
              placeholder={col}
              maxLength={MAX_MOCKUP_LABEL}
              aria-label={`Row ${r + 1}, ${col}`}
              onChange={(e) => {
                const next = rows.map((cells, i) => (i === r ? [...cells] : cells));
                next[r][c] = e.target.value;
                onChange(next);
              }}
            />
          ))}
          <button
            type="button"
            className="secondary small"
            aria-label={`Remove row ${r + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== r))}
          >
            Quitar
          </button>
        </div>
      ))}
      {rows.length < MAX_MOCKUP_PREVIEW_ROWS && (
        <button
          type="button"
          className="secondary small"
          onClick={() => onChange([...rows, columns.map(() => "")])}
        >
          Add row
        </button>
      )}
      <p className="hint">Fictitious preview data, not real records.</p>
    </div>
  );
}

/** Ordered children of a container (same screen, no nesting). */
function ChildrenPicker({
  spec,
  screenId,
  container,
  onChange,
}: {
  spec: MockupSpec;
  screenId: string;
  container: MockupComponent;
  onChange: (children: string[]) => void;
}) {
  const screen = spec.screens.find((s) => s.id === screenId);
  const [pick, setPick] = useState("");
  if (!screen) return null;
  const eligible = screen.components.filter(
    (c) =>
      c.id !== container.id &&
      c.kind !== "container" &&
      !container.children.includes(c.id) &&
      parentOf(spec, screenId, c.id) === null,
  );
  function move(index: number, delta: -1 | 1): void {
    const next = [...container.children];
    const other = index + delta;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    onChange(next);
  }
  return (
    <div className="field">
      <span>Children ({container.children.length})</span>
      {container.children.length > 0 && (
        <ul className="question-list">
          {container.children.map((child, i) => (
            <li key={child}>
              <code>{child}</code>
              <button
                type="button"
                className="secondary small"
                disabled={i === 0}
                aria-label={`Move ${child} up`}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={i === container.children.length - 1}
                aria-label={`Move ${child} down`}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="secondary small"
                aria-label={`Release ${child}`}
                onClick={() => onChange(container.children.filter((id) => id !== child))}
              >
                Release
              </button>
            </li>
          ))}
        </ul>
      )}
      {eligible.length === 0 ? (
        <p className="hint">No candidates: each component has a single container.</p>
      ) : (
        <div className="add-row">
          <select value={pick} aria-label="Component to group" onChange={(e) => setPick(e.target.value)}>
            <option value="">Group…</option>
            {eligible.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary small"
            disabled={pick === ""}
            onClick={() => {
              onChange([...container.children, pick]);
              setPick("");
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/** Icon catalog with search; saves the id, not the drawing. */
function IconPicker({ iconId, onChange }: { iconId: string | undefined; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const current = MOCKUP_ICON_CATALOG.find((icon) => icon.id === iconId);
  const matches = searchMockupIcons(query).slice(0, 12);
  return (
    <div className="field">
      <span>Catalog icon</span>
      <button
        type="button"
        className="secondary small icon-pick"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <>
            <span className="mockup-glyph small" aria-hidden="true">
              <MockupIcon id={current.id} label={current.label} />
            </span>
            {current.label} ({current.id})
          </>
        ) : (
          "Choose icon…"
        )}
      </button>
      {open && (
        <div className="icon-catalog">
          <input
            type="text"
            value={query}
            placeholder="Search icon…"
            aria-label="Search icon"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="icon-grid">
            {matches.map((icon) => (
              <li key={icon.id}>
                <button
                  type="button"
                  className={icon.id === iconId ? "active" : ""}
                  title={`${icon.label} (${icon.id})`}
                  aria-pressed={icon.id === iconId}
                  onClick={() => {
                    onChange(icon.id);
                    setOpen(false);
                  }}
                >
                  <span className="mockup-glyph" aria-hidden="true">
                    <MockupIcon id={icon.id} label={icon.label} />
                  </span>
                  <span className="icon-name">{icon.id}</span>
                </button>
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p className="hint">No matches in the catalog.</p>}
        </div>
      )}
    </div>
  );
}

/** Screen interface states (informational, no variants). */
function StatesEditor({
  states,
  onChange,
}: {
  states: MockupSpec["screens"][number]["states"];
  onChange: (states: MockupSpec["screens"][number]["states"]) => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  function add(): void {
    setError(null);
    const cleanId = id.trim();
    if (!/^[A-Za-z0-9_]{1,64}$/.test(cleanId)) {
      setError("The identifier uses letters, digits and underscore.");
      return;
    }
    if (states.some((s) => s.id === cleanId)) {
      setError("That state already exists.");
      return;
    }
    if (label.trim() === "") {
      setError("Enter a label.");
      return;
    }
    onChange([...states, { id: cleanId, label: label.trim() }]);
    setId("");
    setLabel("");
  }
  return (
    <div className="field">
      <span>
        States ({states.length}/{MAX_MOCKUP_STATES})
      </span>
      {states.length > 0 && (
        <ul className="question-list">
          {states.map((state) => (
            <li key={state.id}>
              <code>{state.id}</code> {state.label}
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove state ${state.id}`}
                onClick={() => onChange(states.filter((s) => s.id !== state.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {states.length < MAX_MOCKUP_STATES && (
        <div className="add-row">
          <input
            type="text"
            value={id}
            placeholder="id"
            maxLength={64}
            aria-label="State identifier"
            autoComplete="off"
            onChange={(e) => setId(e.target.value)}
          />
          <input
            type="text"
            value={label}
            placeholder="Label"
            maxLength={MAX_MOCKUP_LABEL}
            aria-label="State label"
            autoComplete="off"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button type="button" className="secondary small" onClick={add}>
            Add
          </button>
        </div>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">Informational names; no per-state variants in this milestone.</p>
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
        <section aria-label={`Screen ${screen.id}`}>
          <h4>
            Screen <code>{screen.id}</code>
          </h4>
          <CommitInput
            key={`sid:${screen.id}`}
            label="Identifier"
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
            label="Title"
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
          <StatesEditor
            states={screen.states}
            onChange={(states) =>
              onSpec({
                ...spec,
                screens: spec.screens.map((s) => (s.id === screen.id ? { ...s, states } : s)),
              })
            }
          />
          {confirming === `screen:${screen.id}` ? (
            <DeleteConfirm
              what={`screen ${screen.id}`}
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
              Delete screen
            </button>
          )}
        </section>
      )}

      {component !== undefined && (
        <section aria-label={`Component ${component.id}`}>
          <h4>
            {MOCKUP_COMPONENT_LABELS[component.kind]} <code>{component.id}</code>
          </h4>
          <CommitInput
            key={`cid:${component.id}`}
            label="Identifier"
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
              label="Text"
              value={component.text ?? ""}
              maxLength={MAX_MOCKUP_TEXT}
              multiline
              onCommit={(text) => patchComponent({ text })}
            />
          )}
          {component.kind !== "text" && (
            <CommitInput
              key={`label:${component.id}:${component.label ?? ""}`}
              label="Label"
              value={component.label ?? ""}
              maxLength={MAX_MOCKUP_LABEL}
              onCommit={(label) => patchComponent({ label })}
            />
          )}
          {component.kind === "field" && (
            <>
              <CommitInput
                key={`name:${component.id}:${component.name ?? ""}`}
                label="Logical name (optional)"
                value={component.name ?? ""}
                maxLength={64}
                placeholder="e.g. customer_id"
                onCommit={(next) =>
                  patchComponent({ name: next.trim() === "" ? undefined : next.trim() })
                }
              />
              <label className="field">
                <span>Field type</span>
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
                Required
              </label>
              <StringListEditor
                label="Validations"
                values={component.validations}
                max={MAX_MOCKUP_VALIDATIONS}
                maxLength={MAX_MOCKUP_VALIDATION}
                placeholder="e.g. letters only"
                onChange={(validations) => patchComponent({ validations })}
              />
              <CommitInput
                key={`dr:${component.id}:${component.dataRef ?? ""}`}
                label="Data reference (optional)"
                value={component.dataRef ?? ""}
                maxLength={160}
                placeholder="e.g. flow-1/start.value"
                onCommit={(next) =>
                  patchComponent({ dataRef: next.trim() === "" ? undefined : next.trim() })
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
                Required
              </label>
              <StringListEditor
                label="Options"
                values={component.options}
                max={MAX_MOCKUP_OPTIONS}
                maxLength={MAX_MOCKUP_LABEL}
                placeholder="New option"
                onChange={(options) => patchComponent({ options })}
              />
            </>
          )}
          {component.kind === "button" && (
            <ActionFields component={component} screens={spec.screens} onPatch={patchComponent} />
          )}
          {component.kind === "table" && (
            <>
              <StringListEditor
                label="Columns"
                values={component.columns}
                max={MAX_MOCKUP_COLUMNS}
                maxLength={MAX_MOCKUP_LABEL}
                placeholder="New column"
                onChange={(columns) =>
                  patchComponent({
                    columns,
                    columnTypes:
                      component.columnTypes.length === 0
                        ? []
                        : columns.map((_, i) => component.columnTypes[i] ?? "text"),
                    previewRows: component.previewRows.map((row) => row.slice(0, columns.length)),
                  })
                }
              />
              <ColumnTypesEditor
                columns={component.columns}
                types={component.columnTypes}
                onChange={(columnTypes) => patchComponent({ columnTypes })}
              />
              <PreviewRowsEditor
                columns={component.columns}
                rows={component.previewRows}
                onChange={(previewRows) => patchComponent({ previewRows })}
              />
              <StringListEditor
                label="Row actions"
                values={component.rowActions}
                max={MAX_MOCKUP_ROW_ACTIONS}
                maxLength={MAX_MOCKUP_LABEL}
                placeholder="e.g. Edit"
                onChange={(rowActions) => patchComponent({ rowActions })}
              />
            </>
          )}
          {component.kind === "container" && (
            <>
              <label className="field">
                <span>Direction</span>
                <select
                  value={component.direction ?? "vertical"}
                  onChange={(e) => {
                    const next = e.target.value as MockupDirection;
                    patchComponent({ direction: next === "vertical" ? undefined : next });
                  }}
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {MOCKUP_DIRECTION_LABELS[d]}
                    </option>
                  ))}
                </select>
              </label>
              {screen !== undefined && (
                <ChildrenPicker
                  spec={spec}
                  screenId={screen.id}
                  container={component}
                  onChange={(children) => patchComponent({ children })}
                />
              )}
            </>
          )}
          {component.kind === "icon" && (
            <>
              <IconPicker iconId={component.icon} onChange={(icon) => patchComponent({ icon })} />
              <label className="field">
                <span>Role</span>
                <select
                  value={component.iconRole ?? "decorative"}
                  onChange={(e) => {
                    const next = e.target.value as MockupIconRole;
                    patchComponent({ iconRole: next === "decorative" ? undefined : next });
                  }}
                >
                  {ICON_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {MOCKUP_ICON_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
              <CommitInput
                key={`tt:${component.id}:${component.tooltip ?? ""}`}
                label="Tooltip (optional)"
                value={component.tooltip ?? ""}
                maxLength={MAX_MOCKUP_LABEL}
                onCommit={(next) =>
                  patchComponent({ tooltip: next.trim() === "" ? undefined : next })
                }
              />
              {component.iconRole === "button" && (
                <ActionFields component={component} screens={spec.screens} onPatch={patchComponent} />
              )}
            </>
          )}
          {(component.kind === "field" ||
            component.kind === "selector" ||
            component.kind === "table") && (
            <label className="field">
              <span>Data origin</span>
              <select
                value={component.origin ?? ""}
                onChange={(e) => patchComponent({ origin: e.target.value as MockupOrigin })}
              >
                <option value="">Undeclared…</option>
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
                Declared as saved: even so, nothing creates tables or columns by itself.
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
              consequences={componentDeleteConsequences(spec, screen?.id ?? "", component)}
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
              Delete component
            </button>
          )}
        </section>
      )}

      {selection !== null && screen === undefined && (
        <p className="hint">Missing screen: pick another in the selector.</p>
      )}
    </div>
  );
}

function componentDeleteConsequences(
  spec: MockupSpec,
  screenId: string,
  component: MockupComponent,
): string[] {
  const lines = [`It will be removed from screen ${screenId}.`];
  const parent = parentOf(spec, screenId, component.id);
  if (parent !== null) {
    lines.push(`It will be released from its container ${parent.id} (the container is kept).`);
  }
  if (component.kind === "container" && component.children.length > 0) {
    lines.push(
      `Its children (${component.children.join(", ")}) will be left loose on the screen, not deleted.`,
    );
  }
  return lines;
}

function screenDeleteConsequences(spec: MockupSpec, screenId: string): string[] {
  const screen = spec.screens.find((s) => s.id === screenId);
  const lines = [
    `The screen will be deleted with its ${screen?.components.length ?? 0} components.`,
  ];
  const pointing: string[] = [];
  for (const s of spec.screens) {
    for (const c of s.components) {
      if (c.target === screenId) pointing.push(`${s.id}/${c.id}`);
    }
  }
  if (pointing.length > 0) {
    lines.push(`The target will be removed from: ${pointing.join(", ")}.`);
  }
  return lines;
}
