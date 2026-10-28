// Inspector del modelo ER: entidad seleccionada (nombre, atributos con
// marca PK, citas, borrado con consecuencias), relación seleccionada
// (etiqueta, cardinalidades, borrado) y creación accesible por teclado.
//
// Esto edita el MODELO de datos (entidades y relaciones del diseño), no
// filas de ninguna base real: no ejecuta SQL ni migraciones. El subconjunto
// no representa tipos de atributo, obligatoriedad ni FK por atributo: solo
// nombre y marca de clave; las relaciones viven como conexiones.
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
  setEntityRequirements,
  updateRelation,
  type Cardinality,
  type ErSpec,
} from "./specModel";
import { CommitInput, DeleteConfirm, RefsPicker } from "./inspector";

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
        <section aria-label={`Entidad ${entity.name}`}>
          <h4>
            Entidad <code>{entity.name}</code>
          </h4>
          <CommitInput
            key={`name:${entity.name}`}
            label="Nombre"
            value={entity.name}
            maxLength={64}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed === entity.name) return;
              const renamed = renameEntity(spec, entity.name, trimmed);
              if (!renamed.ok) {
                setRenameError(renamed.reason ?? "Nombre inválido.");
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
          <div className="field">
            <span>Atributos (nombre y clave; el subconjunto no tiene tipos)</span>
            <ul className="attr-list">
              {entity.attributes.map((attr) => (
                <li key={`${entity.name}:${attr.name}`}>
                  <CommitInput
                    label={`Atributo ${attr.name}`}
                    value={attr.name}
                    maxLength={64}
                    onCommit={(next) => {
                      const trimmed = next.trim();
                      if (trimmed === attr.name) return;
                      const renamed = renameAttribute(spec, entity.name, attr.name, trimmed);
                      if (!renamed.ok) {
                        setAttrError(renamed.reason ?? "Atributo inválido.");
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
                    aria-label={`Quitar atributo ${attr.name}`}
                    onClick={() => onSpec(removeAttribute(spec, entity.name, attr.name))}
                  >
                    Quitar
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
              Añadir atributo
            </button>
          </div>
          {confirming === entity.name ? (
            <DeleteConfirm
              what={`la entidad ${entity.name}`}
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
              Eliminar entidad…
            </button>
          )}
        </section>
      )}

      {selection?.kind === "edge" && relation !== undefined && (
        <section aria-label={`Relación ${selection.index + 1}`}>
          <h4>Relación</h4>
          <p className="hint">
            <code>{relation.from}</code> → <code>{relation.to}</code>
          </p>
          <CommitInput
            key={`rel:${selection.index}:${relation.label ?? ""}`}
            label="Etiqueta (vacía = sin etiqueta)"
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
                aria-label={`Cardinalidad de ${relation.from}`}
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
                aria-label={`Cardinalidad de ${relation.to}`}
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
            Eliminar relación
          </button>
        </section>
      )}

      {selection === null && (
        <p className="hint">Selecciona una entidad o una relación para editarla. Clic en el fondo para soltar.</p>
      )}

      <section aria-label="Crear relación">
        <h4>Crear relación</h4>
        <div className="add-row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Origen">
            <option value="">Origen…</option>
            {spec.entities.map((entity) => (
              <option key={entity.name} value={entity.name}>
                {entity.name}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Destino">
            <option value="">Destino…</option>
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
            Relacionar
          </button>
        </div>
        <p className="hint">La relación nueva nace N:N; ajusta sus cardinalidades aquí.</p>
      </section>
    </div>
  );
}
