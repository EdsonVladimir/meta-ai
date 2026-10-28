// Nodos del lienzo de mockups: una vista declarativa por componente
// (texto, campo, selector, botón, tabla). Todo el texto llega por props
// y React lo escapa: jamás se inyecta HTML aportado por personas o IA.
// El redimensionado avisa al padre al soltar (onResizeEnd en `data`).
import { memo } from "react";
import { NodeProps, NodeResizer } from "@xyflow/react";
import {
  MOCKUP_FIELD_TYPE_LABELS,
  MOCKUP_ORIGIN_LABELS,
  type MockupComponentKind,
  type MockupFieldType,
  type MockupOrigin,
} from "./types";

export interface MockupNodeData extends Record<string, unknown> {
  componentKind: MockupComponentKind;
  text?: string;
  label?: string;
  fieldType?: MockupFieldType;
  required: boolean;
  options: string[];
  columns: string[];
  action?: string;
  target?: string;
  origin?: MockupOrigin;
  readOnly: boolean;
  onResizeEnd?: (id: string, w: number, h: number) => void;
}

const MIN_W = 90;
const MIN_H = 30;

/** Resume sin inventar: el texto completo vive en el inspector. */
function brief(text: string, max: number): string {
  const flat = text.split(/\s+/).join(" ");
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function OriginTag({ origin }: { origin: MockupOrigin | undefined }) {
  if (origin === undefined) return null;
  return <span className="mockup-origin">{MOCKUP_ORIGIN_LABELS[origin]}</span>;
}

function TextView({ data }: { data: MockupNodeData }) {
  return <span className="mockup-text">{brief(data.text ?? "", 120)}</span>;
}

function FieldView({ data }: { data: MockupNodeData }) {
  return (
    <span className="mockup-field">
      <span className="mockup-label">
        {brief(data.label ?? "", 60)}
        {data.required && <span className="mockup-required" title="Obligatorio"> *</span>}
      </span>
      <span className="mockup-input" aria-hidden="true">
        {data.fieldType ? MOCKUP_FIELD_TYPE_LABELS[data.fieldType] : ""}
      </span>
      <OriginTag origin={data.origin} />
    </span>
  );
}

function SelectorView({ data }: { data: MockupNodeData }) {
  return (
    <span className="mockup-field">
      <span className="mockup-label">
        {brief(data.label ?? "", 60)}
        {data.required && <span className="mockup-required" title="Obligatorio"> *</span>}
      </span>
      <span className="mockup-input" aria-hidden="true">
        {data.options.length > 0 ? brief(data.options[0], 40) : "—"} ▾
      </span>
      <OriginTag origin={data.origin} />
    </span>
  );
}

function ButtonView({ data }: { data: MockupNodeData }) {
  return (
    <span className="mockup-button">
      {brief(data.label ?? "", 60)}
      {data.target !== undefined && data.target !== "" && (
        <span className="mockup-target" title={`Navega a ${data.target}`}> →</span>
      )}
    </span>
  );
}

function TableView({ data }: { data: MockupNodeData }) {
  return (
    <span className="mockup-table">
      <span className="mockup-label">{brief(data.label ?? "", 60)}</span>
      <span className="mockup-cols" aria-hidden="true">
        {data.columns.slice(0, 4).map((col) => (
          <span key={col} className="mockup-col">{brief(col, 20)}</span>
        ))}
        {data.columns.length > 4 && <span className="mockup-col">…</span>}
      </span>
      <OriginTag origin={data.origin} />
    </span>
  );
}

export const MockupNode = memo(function MockupNode({ id, data, selected }: NodeProps) {
  const node = data as unknown as MockupNodeData;
  return (
    <div className={`mockup-node kind-${node.componentKind}${selected ? " selected" : ""}`}>
      {!node.readOnly && (
        <NodeResizer
          minWidth={MIN_W}
          minHeight={MIN_H}
          isVisible={selected}
          onResizeEnd={(_event, params) =>
            node.onResizeEnd?.(id, Math.round(params.width), Math.round(params.height))
          }
        />
      )}
      {node.componentKind === "text" && <TextView data={node} />}
      {node.componentKind === "field" && <FieldView data={node} />}
      {node.componentKind === "selector" && <SelectorView data={node} />}
      {node.componentKind === "button" && <ButtonView data={node} />}
      {node.componentKind === "table" && <TableView data={node} />}
    </div>
  );
});

export const MOCKUP_NODE_TYPES = { mockupNode: MockupNode };
