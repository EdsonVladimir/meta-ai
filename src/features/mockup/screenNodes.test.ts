// Screen nodes shared by editor and preview: positions, default sizes
// and complete declarative data.
import { describe, expect, it } from "vitest";
import { buildScreenNodes } from "./screenNodes";
import type { MockupScreen } from "./types";

function screen(): MockupScreen {
  return {
    id: "p",
    title: "P",
    requirements: [],
    designs: [],
    states: [],
    components: [
      {
        id: "f", kind: "field", label: "F", fieldType: "text", required: false,
        validations: [], options: [], columns: [], columnTypes: [], previewRows: [],
        rowActions: [], origin: "temporary", children: [], requirements: [], designs: [],
      },
      {
        id: "i", kind: "icon", label: "I", required: false, validations: [],
        options: [], columns: [], columnTypes: [], previewRows: [], rowActions: [],
        icon: "save", iconRole: "button", children: [], requirements: [], designs: [],
      },
    ],
  };
}

describe("buildScreenNodes", () => {
  it("uses given positions and sizes, with a mockupNode view", () => {
    const nodes = buildScreenNodes(
      screen(),
      { f: { x: 10, y: 20, w: 300, h: 90 } },
      { readOnly: true },
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("mockupNode");
    expect(nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(nodes[0].style).toEqual({ width: 300, height: 90 });
    const data = nodes[1].data as Record<string, unknown>;
    expect(data["icon"]).toBe("save");
    expect(data["readOnly"]).toBe(true);
  });

  it("without position falls back to the origin with default size", () => {
    const nodes = buildScreenNodes(screen(), {}, { readOnly: false, selectedId: "i" });
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[0].style).toEqual({ width: 200, height: 64 });
    expect(nodes[0].selected).toBe(false);
    expect(nodes[1].selected).toBe(true);
  });
});
