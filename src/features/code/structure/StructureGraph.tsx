// Structure graph on React Flow (reused, deferred): semantic reading
// only. Nodes can be dragged (visual), but that touches no code.
// Unresolved relations draw no edges.
import { memo, useMemo, useState } from "react";
import {
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { StructureKind, StructureRelationKind, StructureSymbol } from "./structureTypes";
import { drawableRelations, layoutStructure } from "./structureLayout";

export interface TypeCardDatum extends Record<string, unknown> {
  symbol: StructureSymbol;
  unresolved: number;
}

export type TypeCardNode = Node<TypeCardDatum, "typeCard">;

const KIND_LABELS: Record<StructureKind, string> = {
  class: "class",
  interface: "interface",
  struct: "struct",
  enum: "enum",
  trait: "trait",
  function: "function",
  component: "component",
};

const EDGE_STYLE: Record<StructureRelationKind, { stroke: string; strokeDasharray?: string }> = {
  extends: { stroke: "#3ddc97" },
  implements: { stroke: "#3ddc97", strokeDasharray: "6 3" },
  references: { stroke: "#8b95a1", strokeDasharray: "2 4" },
  instantiates: { stroke: "#e8b86d", strokeDasharray: "8 3 2 3" },
};

/** Type card with expandable members (local visual state). */
export const TypeCardView = memo(function TypeCardView({ data, selected }: NodeProps<TypeCardNode>) {
  const [open, setOpen] = useState(false);
  const { symbol } = data;
  return (
    <div
      className={`struct-card kind-${symbol.kind}${selected ? " selected" : ""}`}
      aria-label={`${KIND_LABELS[symbol.kind]} ${symbol.name}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} aria-label="Input" />
      <div className="struct-card-head">
        <span className="struct-card-kind">{KIND_LABELS[symbol.kind]}</span>
        <span className="struct-card-lang">{symbol.language === "ts" ? "TS" : "Rust"}</span>
      </div>
      <div className="struct-card-name" title={`${symbol.rel} · line ${symbol.range.startLine}`}>
        {symbol.name}
      </div>
      <div className="struct-card-file" title={symbol.rel}>
        {symbol.rel}
      </div>
      {symbol.members.length > 0 && (
        <button
          type="button"
          className="secondary small struct-card-toggle"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          aria-expanded={open}
        >
          {open ? "Hide" : "View"} {symbol.members.length} member
          {symbol.members.length === 1 ? "" : "s"}
          {symbol.membersTruncated ? "+" : ""}
        </button>
      )}
      {open && (
        <ul className="struct-card-members">
          {symbol.members.map((member, index) => (
            <li key={`${member.kind}:${member.name}:${index}`} title={member.detail}>
              <span className={`struct-member-kind m-${member.kind}`}>{member.kind}</span>{" "}
              {member.name}
            </li>
          ))}
        </ul>
      )}
      {data.unresolved > 0 && (
        <div className="struct-card-unresolved hint">
          {data.unresolved} unverified
        </div>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} aria-label="Output" />
    </div>
  );
});

const nodeTypes = { typeCard: TypeCardView };

interface StructureGraphProps {
  symbols: StructureSymbol[];
  relations: Array<{
    id: string;
    kind: StructureRelationKind;
    from: string;
    to: string | null;
    status: string;
  }>;
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function GraphInner({ symbols, relations, visibleIds, selectedId, onSelect }: StructureGraphProps) {
  const nodes: TypeCardNode[] = useMemo(() => {
    const positions = layoutStructure(symbols);
    const unresolvedBySymbol = new Map<string, number>();
    for (const rel of relations) {
      if (rel.status !== "resolved") {
        unresolvedBySymbol.set(rel.from, (unresolvedBySymbol.get(rel.from) ?? 0) + 1);
      }
    }
    return symbols
      .filter((symbol) => visibleIds.has(symbol.id))
      .map((symbol) => ({
        id: symbol.id,
        type: "typeCard",
        position: positions.get(symbol.id) ?? { x: 0, y: 0 },
        data: { symbol, unresolved: unresolvedBySymbol.get(symbol.id) ?? 0 },
        selected: symbol.id === selectedId,
      }));
  }, [symbols, relations, visibleIds, selectedId]);

  const edges: Edge[] = useMemo(
    () =>
      drawableRelations(relations, visibleIds).map((rel) => ({
        id: rel.id,
        source: rel.from,
        target: rel.to,
        label: rel.kind === "references" ? undefined : rel.kind,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: EDGE_STYLE[rel.kind as StructureRelationKind],
      })),
    [relations, visibleIds],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onPaneClick={() => onSelect(null)}
      onNodeClick={(_event, node) => onSelect(node.id)}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
      aria-label="Code structure diagram"
    >
      <Controls showInteractive={false} aria-label="Diagram controls" />
    </ReactFlow>
  );
}

export function StructureGraph(props: StructureGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
