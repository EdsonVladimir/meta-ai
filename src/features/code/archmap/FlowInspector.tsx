// Flow inspector: detail of the selected flow row. For a member it
// shows parameter types, the return type, outgoing edges and their
// evidence; for a bare node, the symbol and its chain members.
import type { ReactNode } from "react";
import { memberSignalLines } from "./flowLayout";
import type { FlowEdge, FlowGraph, FlowPending } from "./flowModel";

export interface FlowInspectorProps {
  graph: FlowGraph;
  selected: { nodeId: string; member: string | null } | null;
}

/** Evidence keeps its file:line origin; the trailing note is dropped. */
function fileLine(evidence: string): string {
  return evidence.replace(/ \([^()]*\)$/, "");
}

function edgeTarget(graph: FlowGraph, edge: FlowEdge): string {
  const node = graph.nodes.find((entry) => entry.id === edge.toNode);
  if (node !== undefined) {
    const member = edge.toMember ?? edge.label;
    return member === undefined ? node.symbol.name : `${node.symbol.name}.${member}`;
  }
  const http = graph.httpNodes.find((entry) => entry.id === edge.toNode);
  if (http !== undefined) return `${http.verb} ${http.url ?? "(unknown url)"}`;
  return edge.toNode;
}

const PENDING_LABEL: Record<FlowPending["kind"], string> = {
  unresolved: "Unresolved",
  ambiguous: "Ambiguous",
  "no-destination": "No destination",
  cycle: "Cycle",
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="archmap-section">
      <h5 className="flow-inspector-title">{title}</h5>
      <div className="archmap-section-body">{children}</div>
    </div>
  );
}

function PendingList({ items }: { items: FlowPending[] }) {
  return (
    <ul className="archmap-list">
      {items.map((item, index) => (
        <li key={`${item.kind}:${item.label}:${index}`} title={item.evidence}>
          <strong>{PENDING_LABEL[item.kind]}:</strong> <code>{item.label}</code>
        </li>
      ))}
    </ul>
  );
}

export function FlowInspector({ graph, selected }: FlowInspectorProps) {
  const node =
    selected === null ? undefined : graph.nodes.find((entry) => entry.id === selected.nodeId);
  if (node === undefined || selected === null) {
    return (
      <div className="archmap-inspector">
        <p className="hint">Select a chain row to inspect it.</p>
        {graph.pending.length > 0 && (
          <Block title="Pending">
            <PendingList items={graph.pending} />
          </Block>
        )}
      </div>
    );
  }
  const { symbol } = node;
  if (selected.member === null) {
    return (
      <section className="archmap-inspector" aria-label={`Flow detail of ${symbol.name}`}>
        <h4>{symbol.name}</h4>
        <p className="hint">
          {symbol.kind} · {symbol.rel}
        </p>
        <Block title="Members">
          {node.members.length === 0 ? (
            <p className="hint">None</p>
          ) : (
            <ul className="archmap-list">
              {node.members.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </section>
    );
  }
  const member = symbol.members.find((entry) => entry.name === selected.member);
  const params = member?.paramTypes ?? [];
  const outgoing = graph.edges.filter(
    (edge) => edge.fromNode === node.id && edge.fromMember === selected.member,
  );
  const signals = memberSignalLines(node, selected.member);
  const pending = graph.pending.filter(
    (item) => item.fromNode === node.id && item.fromMember === selected.member,
  );
  return (
    <section
      className="archmap-inspector"
      aria-label={`Flow detail of ${symbol.name}.${selected.member}`}
    >
      <h4>
        {symbol.name}.{selected.member}
      </h4>
      <Block title="Inputs">
        {params.length === 0 ? (
          <p className="hint">None</p>
        ) : (
          <ul className="archmap-list">
            {params.map((type, index) => (
              <li key={`${type}:${index}`}>
                <code>{type}</code>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Output">
        <p className="hint">{member?.returnType ?? "Unknown (not annotated)"}</p>
      </Block>
      <Block title="Relations">
        {outgoing.length === 0 ? (
          <p className="hint">None</p>
        ) : (
          <ul className="archmap-list">
            {outgoing.map((edge) => (
              <li key={edge.id} title={edge.evidence}>
                <code>
                  {edge.kind} → {edgeTarget(graph, edge)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </Block>
      {signals.length > 0 && (
        <Block title="State">
          <ul className="archmap-list">
            {signals.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Block>
      )}
      {pending.length > 0 && (
        <Block title="Pending">
          <PendingList items={pending} />
        </Block>
      )}
      <Block title="Evidence">
        {outgoing.length === 0 ? (
          <p className="hint">None</p>
        ) : (
          <ul className="archmap-list">
            {outgoing.map((edge) => (
              <li key={edge.id} title={edge.evidence}>
                <code>{fileLine(edge.evidence)}</code>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </section>
  );
}
