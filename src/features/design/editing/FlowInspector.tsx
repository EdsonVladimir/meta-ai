// Inspector de flujos: nodo seleccionado (identidad, etiqueta, tipo,
// citas, borrado con consecuencias), conexión seleccionada (etiqueta de
// rama, borrado) y creación accesible por teclado.
import { useState } from "react";
import {
  flowDeleteConsequences,
  removeFlowEdge,
  removeFlowNode,
  renameFlowNodeId,
  updateFlowEdge,
  updateFlowNode,
  type FlowNodeKind,
  type FlowSpec,
} from "./specModel";
import { CommitInput, DeleteConfirm, RefsPicker } from "./inspector";

const NODE_KINDS: { value: FlowNodeKind; label: string }[] = [
  { value: "start", label: "Inicio" },
  { value: "step", label: "Paso" },
  { value: "decision", label: "Decisión" },
  { value: "end", label: "Fin" },
];

export type FlowSelection =
  | { kind: "node"; id: string }
  | { kind: "edge"; index: number }
  | null;

interface FlowInspectorProps {
  spec: FlowSpec;
  allowed: string[];
  selection: FlowSelection;
  onSpec: (spec: FlowSpec) => void;
  onSelect: (selection: FlowSelection) => void;
  onConnectRequest: (from: string, to: string) => void;
}

export function FlowInspector({
  spec,
  allowed,
  selection,
  onSpec,
  onSelect,
  onConnectRequest,
}: FlowInspectorProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const node = selection?.kind === "node" ? spec.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.kind === "edge" ? spec.edges[selection.index] : undefined;

  return (
    <div className="inspector-body">
      {node !== undefined && (
        <section aria-label={`Nodo ${node.id}`}>
          <h4>
            Nodo <code>{node.id}</code>
          </h4>
          <CommitInput
            key={`id:${node.id}`}
            label="Identificador"
            value={node.id}
            maxLength={64}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed === node.id) return;
              const renamed = renameFlowNodeId(spec, node.id, trimmed);
              if (!renamed.ok) {
                setRenameError(renamed.reason ?? "Identificador inválido.");
                return;
              }
              setRenameError(null);
              onSpec(renamed.spec);
              onSelect({ kind: "node", id: trimmed });
            }}
          />
          {renameError !== null && (
            <p className="error" role="alert">
              {renameError}
            </p>
          )}
          <CommitInput
            key={`label:${node.id}:${node.label}`}
            label="Etiqueta"
            value={node.label}
            maxLength={160}
            onCommit={(label) => onSpec(updateFlowNode(spec, node.id, { label: label.trim() }))}
          />
          <label className="field">
            <span>Tipo</span>
            <select
              value={node.kind}
              onChange={(e) => onSpec(updateFlowNode(spec, node.id, { kind: e.target.value as FlowNodeKind }))}
            >
              {NODE_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <RefsPicker
            allowed={allowed}
            selected={node.requirements}
            onChange={(requirements) => onSpec(updateFlowNode(spec, node.id, { requirements }))}
          />
          {confirming === node.id ? (
            <DeleteConfirm
              what={`el nodo ${node.id}`}
              consequences={flowDeleteConsequences(spec, node.id)}
              onConfirm={() => {
                onSpec(removeFlowNode(spec, node.id).spec);
                setConfirming(null);
                onSelect(null);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <button type="button" className="danger small" onClick={() => setConfirming(node.id)}>
              Eliminar nodo…
            </button>
          )}
        </section>
      )}

      {selection?.kind === "edge" && edge !== undefined && (
        <section aria-label={`Conexión ${selection.index + 1}`}>
          <h4>Conexión</h4>
          <p className="hint">
            <code>{edge.from}</code> → <code>{edge.to}</code>
          </p>
          <CommitInput
            key={`edge:${selection.index}:${edge.label ?? ""}`}
            label="Etiqueta de rama (vacía = sin etiqueta)"
            value={edge.label ?? ""}
            maxLength={160}
            onCommit={(label) =>
              onSpec(updateFlowEdge(spec, selection.index, label.trim() === "" ? null : label.trim()))
            }
          />
          <button
            type="button"
            className="danger small"
            onClick={() => {
              onSpec(removeFlowEdge(spec, selection.index));
              onSelect(null);
            }}
          >
            Eliminar conexión
          </button>
        </section>
      )}

      {selection === null && (
        <p className="hint">Selecciona un nodo o una conexión para editarlo. Clic en el fondo para soltar.</p>
      )}

      <section aria-label="Crear conexión">
        <h4>Crear conexión</h4>
        <div className="add-row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Origen">
            <option value="">Origen…</option>
            {spec.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Destino">
            <option value="">Destino…</option>
            {spec.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary small"
            disabled={from === "" || to === ""}
            onClick={() => onConnectRequest(from, to)}
          >
            Conectar
          </button>
        </div>
      </section>
    </div>
  );
}
