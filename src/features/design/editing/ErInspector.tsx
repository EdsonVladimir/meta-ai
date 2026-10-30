// ER model inspector: selected entity (name, attributes with PK mark,
// citations, deletion with consequences), selected relation (label,
// cardinalities, deletion) and keyboard-accessible creation. This edits
// the data MODEL (design entities and relations), not rows of any real
// database: it runs no SQL or migrations. The subset represents no
// attribute types, requiredness or per-attribute FK: only name and key
// mark; relations live as connections.
import { useState } from "react";
import {
  addAttribute,
  erDeleteConsequences,
  removeAttribute,
  removeEntity,
  removeRelation,
  renameAttribute,
  renameEntity,
  setAttributeKey,
  setEntityMockups,
  setEntityRequirements,
  updateRelation,
  type Cardinality,
  type ErSpec,
} from "./specModel";
import { CommitInput, DeleteConfirm, MockupRefsEditor, RefsPicker } from "./inspector";

const CARDS: Cardinality[] = ["1", "0..1", "N", "0..N"];

export type ErSelection =
  | { kind: "node"; id: string }
  | { kind: "edge"; index: number }
  | null;

interface ErInspectorProps {
  spec: ErSpec;
  allowed: string[];
  selection: ErSelection;
  onSpec: (spec: ErSpec) => void;
  onSelect: (selection: ErSelection) => void;
  onConnectRequest: (from: string, to: string) => void;
}

export function ErInspector({
  spec,
  allowed,
  selection,
  onSpec,
  onSelect,
  onConnectRequest,
}: ErInspectorProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [attrError, setAttrError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const entity =
    selection?.kind === "node" ? spec.entities.find((e) => e.name === selection.id) : undefined;
  const relation = selection?.kind === "edge" ? spec.relations[selection.index] : undefined;

  return (
    <div className="inspector-body">
      {entity !== undefined && (
        <section aria-label={`Entity ${entity.name}`}>
          <h4>
            Entity <code>{entity.name}</code>
          </h4>
          <CommitInput
            key={`name:${entity.name}`}
            label="Name"
            value={entity.name}
            maxLength={64}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed === entity.name) return;
              const renamed = renameEntity(spec, entity.name, trimmed);
              if (!renamed.ok) {
                setRenameError(renamed.reason ?? "Invalid name.");
                return;
              }
              setRenameError(null);
              setConfirming(null);
              onSpec(renamed.spec);
              onSelect({ kind: "node", id: trimmed });
            }}
          />
          {renameError !== null && (
            <p className="error" role="alert">
              {renameError}
            </p>
          )}
          <RefsPicker
            allowed={allowed}
            selected={entity.requirements}
            onChange={(requirements) => onSpec(setEntityRequirements(spec, entity.name, requirements))}
          />
          <MockupRefsEditor
            mockups={allowed.filter((id) => id.startsWith("mockup-"))}
            selected={entity.mockups}
            onChange={(mockups) => onSpec(setEntityMockups(spec, entity.name, mockups))}
          />
          <div className="field">
            <span>Attributes (name and key; the subset has no types)</span>
            <ul className="attr-list">
              {entity.attributes.map((attr) => (
                <li key={`${entity.name}:${attr.name}`}>
                  <CommitInput
                    label={`Attribute ${attr.name}`}
                    value={attr.name}
                    maxLength={64}
                    onCommit={(next) => {
                      const trimmed = next.trim();
                      if (trimmed === attr.name) return;
                      const renamed = renameAttribute(spec, entity.name, attr.name, trimmed);
                      if (!renamed.ok) {
                        setAttrError(renamed.reason ?? "Invalid attribute.");
                        return;
                      }
                      setAttrError(null);
                      onSpec(renamed.spec);
                    }}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={attr.key}
                      onChange={(e) => onSpec(setAttributeKey(spec, entity.name, attr.name, e.target.checked))}
                    />
                    PK
                  </label>
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={`Remove attribute ${attr.name}`}
                    onClick={() => onSpec(removeAttribute(spec, entity.name, attr.name))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {attrError !== null && (
              <p className="error" role="alert">
                {attrError}
              </p>
            )}
            <button
              type="button"
              className="secondary small"
              onClick={() => onSpec(addAttribute(spec, entity.name).spec)}
            >
              Add attribute
            </button>
          </div>
          {confirming === entity.name ? (
            <DeleteConfirm
              what={`entity ${entity.name}`}
              consequences={erDeleteConsequences(spec, entity.name)}
              onConfirm={() => {
                onSpec(removeEntity(spec, entity.name).spec);
                setConfirming(null);
                onSelect(null);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <button type="button" className="danger small" onClick={() => setConfirming(entity.name)}>
              Delete entity…
            </button>
          )}
        </section>
      )}

      {selection?.kind === "edge" && relation !== undefined && (
        <section aria-label={`Relation ${selection.index + 1}`}>
          <h4>Relation</h4>
          <p className="hint">
            <code>{relation.from}</code> → <code>{relation.to}</code>
          </p>
          <CommitInput
            key={`rel:${selection.index}:${relation.label ?? ""}`}
            label="Label (empty = no label)"
            value={relation.label ?? ""}
            maxLength={160}
            onCommit={(label) =>
              onSpec(
                updateRelation(spec, selection.index, {
                  label: label.trim() === "" ? null : label.trim(),
                }),
              )
            }
          />
          <div className="add-row">
            <label className="field">
              <span>{relation.from}</span>
              <select
                value={relation.fromCard}
                onChange={(e) =>
                  onSpec(updateRelation(spec, selection.index, { fromCard: e.target.value as Cardinality }))
                }
                aria-label={`Cardinality of ${relation.from}`}
              >
                {CARDS.map((card) => (
                  <option key={card} value={card}>
                    {card}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{relation.to}</span>
              <select
                value={relation.toCard}
                onChange={(e) =>
                  onSpec(updateRelation(spec, selection.index, { toCard: e.target.value as Cardinality }))
                }
                aria-label={`Cardinality of ${relation.to}`}
              >
                {CARDS.map((card) => (
                  <option key={card} value={card}>
                    {card}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="danger small"
            onClick={() => {
              onSpec(removeRelation(spec, selection.index));
              onSelect(null);
            }}
          >
            Delete relation
          </button>
        </section>
      )}

      {selection === null && (
        <p className="hint">Select an entity or a relation to edit it. Click the background to release.</p>
      )}

      <section aria-label="Create relation">
        <h4>Create relation</h4>
        <div className="add-row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Origin">
            <option value="">Origin…</option>
            {spec.entities.map((entity) => (
              <option key={entity.name} value={entity.name}>
                {entity.name}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Target">
            <option value="">Target…</option>
            {spec.entities.map((entity) => (
              <option key={entity.name} value={entity.name}>
                {entity.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary small"
            disabled={from === "" || to === ""}
            onClick={() => onConnectRequest(from, to)}
          >
            Relate
          </button>
        </div>
        <p className="hint">A new relation is born N:N; adjust its cardinalities here.</p>
      </section>
    </div>
  );
}
