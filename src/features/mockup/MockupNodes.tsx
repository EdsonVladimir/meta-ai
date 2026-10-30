// Mockup canvas nodes: one declarative view per component (text, field,
// selector, button, table, container, icon). All text arrives via props
// and React escapes it: HTML contributed by people or AI is never
// injected. Icons come from the own catalog (MockupIcon): the glyph is
// drawn, never arbitrary saved SVG. Resizing notifies the parent on
// release (onResizeEnd in `data`).
import { memo } from "react";
import { NodeProps, NodeResizer } from "@xyflow/react";
import {
  MOCKUP_BUTTON_STATE_LABELS,
  MOCKUP_FIELD_TYPE_LABELS,
  MOCKUP_ORIGIN_LABELS,
  type MockupActionKind,
  type MockupButtonState,
  type MockupComponentKind,
  type MockupDirection,
  type MockupFieldType,
  type MockupIconRole,
  type MockupOrigin,
} from "./types";
import { MockupIcon } from "./MockupIcon";

export interface MockupNodeData extends Record<string, unknown> {
  componentKind: MockupComponentKind;
  text?: string;
  label?: string;
  fieldType?: MockupFieldType;
  required: boolean;
  options: string[];
  columns: string[];
  columnTypes: MockupFieldType[];
  actionKind?: MockupActionKind;
  operation?: string;
  target?: string;
  buttonState?: MockupButtonState;
  origin?: MockupOrigin;
  icon?: string;
  iconRole?: MockupIconRole;
  direction?: MockupDirection;
  childCount: number;
  readOnly: boolean;
  onResizeEnd?: (id: string, w: number, h: number) => void;
}

const MIN_W = 90;
const MIN_H = 30;

/** Summarizes without inventing: the full text lives in the inspector. */
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
        {data.required && <span className="mockup-required" title="Required"> *</span>}
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
        {data.required && <span className="mockup-required" title="Required"> *</span>}
      </span>
      <span className="mockup-input" aria-hidden="true">
        {data.options.length > 0 ? brief(data.options[0], 40) : "—"} ▾
      </span>
      <OriginTag origin={data.origin} />
    </span>
  );
}

function ButtonView({ data }: { data: MockupNodeData }) {
  const state = data.buttonState ?? "enabled";
  return (
    <span className={`mockup-button state-${state}`}>
      {brief(data.label ?? "", 60)}
      {data.target !== undefined && data.target !== "" && (
        <span className="mockup-target" title={`Navega a ${data.target}`}> →</span>
      )}
      {state !== "enabled" && (
        <span className="mockup-state">{MOCKUP_BUTTON_STATE_LABELS[state]}</span>
      )}
    </span>
  );
}

function TableView({ data }: { data: MockupNodeData }) {
  return (
    <span className="mockup-table">
      <span className="mockup-label">{brief(data.label ?? "", 60)}</span>
      <span className="mockup-cols" aria-hidden="true">
        {data.columns.slice(0, 4).map((col, i) => (
          <span key={`${col}-${i}`} className="mockup-col" title={data.columnTypes[i] ?? "text"}>
            {brief(col, 20)}
          </span>
        ))}
        {data.columns.length > 4 && <span className="mockup-col">…</span>}
      </span>
      <OriginTag origin={data.origin} />
    </span>
  );
}

function ContainerView({ data }: { data: MockupNodeData }) {
  return (
    <span className="mockup-container">
      <span className="mockup-label">{brief(data.label ?? "Group", 60)}</span>
      <span className="mockup-count" aria-hidden="true">
        {data.childCount} · {data.direction === "horizontal" ? "↔" : "↕"}
      </span>
    </span>
  );
}

function IconView({ data }: { data: MockupNodeData }) {
  const state = data.buttonState ?? "enabled";
  return (
    <span className={`mockup-icon state-${state}`} title={brief(data.label ?? "", 60)}>
      <span className="mockup-glyph" aria-hidden={false}>
        <MockupIcon id={data.icon ?? ""} label={data.label ?? "Icono"} />
      </span>
      {data.iconRole === "button" && state !== "enabled" && (
        <span className="mockup-state">{MOCKUP_BUTTON_STATE_LABELS[state]}</span>
      )}
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
      {node.componentKind === "container" && <ContainerView data={node} />}
      {node.componentKind === "icon" && <IconView data={node} />}
    </div>
  );
});

export const MOCKUP_NODE_TYPES = { mockupNode: MockupNode };
