// Mockup-canvas node builder, shared by the editor
// and the proposed-screens preview. Pure except for the
// React Flow types: given the screen and its positions, it returns the nodes with
// the view (`mockupNode`) and their declarative data. The canvas injects
// `onResizeEnd` into every node (see MockupCanvas).
import type { Node } from "@xyflow/react";
import { defaultComponentSize } from "./mockupModel";
import type { MockupScreen } from "./types";

export interface ScreenNodeEntry {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export function buildScreenNodes(
  screen: MockupScreen,
  positions: Record<string, ScreenNodeEntry>,
  options: { readOnly: boolean; selectedId?: string | null },
): Node[] {
  return screen.components.map((component) => {
    const entry = positions[component.id] ?? { x: 0, y: 0 };
    const size = defaultComponentSize(component.kind);
    return {
      id: component.id,
      type: "mockupNode",
      position: { x: entry.x, y: entry.y },
      style: { width: entry.w ?? size.w, height: entry.h ?? size.h },
      data: {
        componentKind: component.kind,
        text: component.text,
        label: component.label,
        fieldType: component.fieldType,
        required: component.required,
        options: component.options,
        columns: component.columns,
        columnTypes: component.columnTypes,
        actionKind: component.actionKind,
        operation: component.operation,
        target: component.target,
        buttonState: component.buttonState,
        origin: component.origin,
        icon: component.icon,
        iconRole: component.iconRole,
        direction: component.direction,
        childCount: component.children.length,
        readOnly: options.readOnly,
      },
      selected: options.selectedId === component.id,
    };
  });
}
