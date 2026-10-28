// Nodos visuales del editor (React Flow). Presentación pura: dibujan la
// semántica que les pasa el lienzo y no guardan estado propio.
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
  start: "Inicio",
  step: "Paso",
  decision: "Decisión",
  end: "Fin",
};

function refsTitle(requirements: string[]): string | undefined {
  return requirements.length === 0 ? undefined : `Cita: ${requirements.join(", ")}`;
}

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} aria-label="Entrada" />
      <Handle type="source" position={Position.Bottom} aria-label="Salida" />
    </>
  );
}

/** Nodo de flujo: píldora (inicio/fin) o rectángulo (paso). */
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
 * Nodo de decisión: rombo SVG real, sin rotar la tarjeta. El contenedor no
 * tiene fondo ni borde; el texto va horizontal en su propia capa, acotado
 * para respetar los lados inclinados (el completo vive en el inspector y
 * en el tooltip). Los handles anclan en los vértices del rombo: la entrada
 * arriba y las salidas en los laterales o abajo según las ramas.
 */
export const DecisionNodeView = memo(function DecisionNodeView({
  data,
  selected,
}: NodeProps<DecisionRFNode>) {
  const refs = data.requirements.join(" · ");
  return (
    <div
      className={`decision-node${selected ? " selected" : ""}`}
      aria-label={`Decisión: ${data.label}`}
    >
      <div className="decision-box">
        <Handle type="target" position={Position.Top} aria-label="Entrada" />
        <Handle id="left" type="source" position={Position.Left} aria-label="Salida izquierda" />
        <Handle id="right" type="source" position={Position.Right} aria-label="Salida derecha" />
        <Handle id="bottom" type="source" position={Position.Bottom} aria-label="Salida inferior" />
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

/** Nodo ER: cabecera con la entidad y lista de atributos con marcas PK. */
export const ErNodeView = memo(function ErNodeView({ data, selected }: NodeProps<ErRFNode>) {
  return (
    <div
      className={`canvas-node er-node${selected ? " selected" : ""}`}
      title={refsTitle(data.requirements)}
    >
      <NodeHandles />
      <span className="canvas-node-title">{data.name}</span>
      <ul className="canvas-node-attrs" aria-label={`Atributos de ${data.name}`}>
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
