// Visual editor nodes (React Flow). Pure presentation: they draw the
// semantics the canvas passes them and keep no own state.
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ErAttribute, FlowNodeKind } from "./specModel";

export interface FlowNodeDatum extends Record<string, unknown> {
  nodeKind: FlowNodeKind;
  label: string;
  requirements: string[];
}

export interface ErNodeDatum extends Record<string, unknown> {
  name: string;
  attributes: ErAttribute[];
  requirements: string[];
}

export type FlowRFNode = Node<FlowNodeDatum, "flowNode">;
export type DecisionRFNode = Node<FlowNodeDatum, "decisionNode">;
export type ErRFNode = Node<ErNodeDatum, "erNode">;

const FLOW_KIND_LABELS: Record<FlowNodeKind, string> = {
  start: "Start",
  step: "Step",
  decision: "Decision",
  end: "End",
};

function refsTitle(requirements: string[]): string | undefined {
  return requirements.length === 0 ? undefined : `Cites: ${requirements.join(", ")}`;
}

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} aria-label="Input" />
      <Handle type="source" position={Position.Bottom} aria-label="Output" />
    </>
  );
}

/** Flow node: pill (start/end) or rectangle (step). */
export const FlowNodeView = memo(function FlowNodeView({ data, selected }: NodeProps<FlowRFNode>) {
  const kindLabel = FLOW_KIND_LABELS[data.nodeKind];
  return (
    <div
      className={`canvas-node flow-node kind-${data.nodeKind}${selected ? " selected" : ""}`}
      title={refsTitle(data.requirements)}
    >
      <NodeHandles />
      <span className="canvas-node-kind">{kindLabel}</span>
      <span className="canvas-node-label">{data.label}</span>
      {data.requirements.length > 0 && (
        <span className="canvas-node-refs">{data.requirements.join(" · ")}</span>
      )}
    </div>
  );
});

/**
 * Decision node: a real SVG diamond, without rotating the card. The
 * container has no background or border; the text runs horizontal in
 * its own layer, bounded to respect the slanted sides (the full text
 * lives in the inspector and the tooltip). Handles anchor at the
 * diamond vertices: input on top, outputs on the sides or bottom per
 * branch.
 */
export const DecisionNodeView = memo(function DecisionNodeView({
  data,
  selected,
}: NodeProps<DecisionRFNode>) {
  const refs = data.requirements.join(" · ");
  return (
    <div
      className={`decision-node${selected ? " selected" : ""}`}
      aria-label={`Decision: ${data.label}`}
    >
      <div className="decision-box">
        <Handle type="target" position={Position.Top} aria-label="Input" />
        <Handle id="left" type="source" position={Position.Left} aria-label="Left output" />
        <Handle id="right" type="source" position={Position.Right} aria-label="Right output" />
        <Handle id="bottom" type="source" position={Position.Bottom} aria-label="Bottom output" />
        <svg className="decision-diamond" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="50,1 99,50 50,99 1,50" className="decision-diamond-shape" />
        </svg>
        <div className="decision-text">
          <span className="decision-label" title={data.label}>
            {data.label}
          </span>
        </div>
      </div>
      {data.requirements.length > 0 && (
        <span className="decision-refs" title={refsTitle(data.requirements)}>
          {refs}
        </span>
      )}
    </div>
  );
});

/** ER node: header with the entity and attribute list with PK marks. */
export const ErNodeView = memo(function ErNodeView({ data, selected }: NodeProps<ErRFNode>) {
  return (
    <div
      className={`canvas-node er-node${selected ? " selected" : ""}`}
      title={refsTitle(data.requirements)}
    >
      <NodeHandles />
      <span className="canvas-node-title">{data.name}</span>
      <ul className="canvas-node-attrs" aria-label={`Attributes of ${data.name}`}>
        {data.attributes.map((attr) => (
          <li key={attr.name} className={attr.key ? "is-key" : undefined}>
            <span className="attr-name">{attr.name}</span>
            {attr.key && <span className="attr-key">PK</span>}
          </li>
        ))}
      </ul>
      {data.requirements.length > 0 && (
        <span className="canvas-node-refs">{data.requirements.join(" · ")}</span>
      )}
    </div>
  );
});
