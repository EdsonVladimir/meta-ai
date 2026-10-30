// Flow inspector: selected node (identity, label, kind, citations,
// deletion with consequences), selected connection (branch label,
// deletion) and keyboard-accessible creation.
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
import { CommitInput, DeleteConfirm, MockupRefsEditor, RefsPicker } from "./inspector";

const NODE_KINDS: { value: FlowNodeKind; label: string }[] = [
  { value: "start", label: "Start" },
  { value: "step", label: "Step" },
  { value: "decision", label: "Decision" },
  { value: "end", label: "End" },
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
        <section aria-label={`Node ${node.id}`}>
          <h4>
            Node <code>{node.id}</code>
          </h4>
          <CommitInput
            key={`id:${node.id}`}
            label="Identifier"
            value={node.id}
            maxLength={64}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed === node.id) return;
              const renamed = renameFlowNodeId(spec, node.id, trimmed);
              if (!renamed.ok) {
                setRenameError(renamed.reason ?? "Invalid identifier.");
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
            label="Label"
            value={node.label}
            maxLength={160}
            onCommit={(label) => onSpec(updateFlowNode(spec, node.id, { label: label.trim() }))}
          />
          <label className="field">
            <span>Kind</span>
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
          <MockupRefsEditor
            mockups={allowed.filter((id) => id.startsWith("mockup-"))}
            selected={node.mockups}
            onChange={(mockups) => onSpec(updateFlowNode(spec, node.id, { mockups }))}
          />
          {confirming === node.id ? (
            <DeleteConfirm
              what={`node ${node.id}`}
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
              Delete node…
            </button>
          )}
        </section>
      )}

      {selection?.kind === "edge" && edge !== undefined && (
        <section aria-label={`Connection ${selection.index + 1}`}>
          <h4>Connection</h4>
          <p className="hint">
            <code>{edge.from}</code> → <code>{edge.to}</code>
          </p>
          <CommitInput
            key={`edge:${selection.index}:${edge.label ?? ""}`}
            label="Branch label (empty = no label)"
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
            Delete connection
          </button>
        </section>
      )}

      {selection === null && (
        <p className="hint">Select a node or a connection to edit it. Click the background to release.</p>
      )}

      <section aria-label="Create connection">
        <h4>Create connection</h4>
        <div className="add-row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Origin">
            <option value="">Origin…</option>
            {spec.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id}
              </option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Target">
            <option value="">Target…</option>
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
            Connect
          </button>
        </div>
      </section>
    </div>
  );
}
