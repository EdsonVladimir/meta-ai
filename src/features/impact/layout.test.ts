import { describe, expect, test } from "vitest";
import { MAX_GRAPH_NODES } from "./coordination";
import { layoutImpactGraph, NODE_H, NODE_W } from "./layout";

describe("layoutImpactGraph", () => {
  test("origin alone, no affected items", () => {
    const layout = layoutImpactGraph({
      originId: "req-1",
      originKind: "requirement",
      originTitle: null,
      affected: [],
      paths: [],
    });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]).toMatchObject({ id: "req-1", status: "origin", depth: 0, x: 0, y: 0 });
    expect(layout.edges).toHaveLength(0);
    expect(layout.truncated).toBe(false);
    expect(layout.total).toBe(1);
  });

  test("layers by depth without duplicating nodes or edges", () => {
    const layout = layoutImpactGraph({
      originId: "req-1",
      originKind: "requirement",
      originTitle: null,
      affected: [
        { id: "flujo-1", kind: "flow", requiresReview: true, title: null },
        { id: "mer-1", kind: "data_model", requiresReview: false, title: null },
      ],
      paths: [
        ["req-1", "flujo-1"],
        ["req-1", "flujo-1"],
        ["req-1", "flujo-1", "mer-1"],
      ],
    });
    expect(layout.nodes.map((n) => n.id)).toEqual(["req-1", "flujo-1", "mer-1"]);
    expect(layout.edges).toEqual([
      { from: "flujo-1", to: "mer-1" },
      { from: "req-1", to: "flujo-1" },
    ]);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("flujo-1")?.status).toBe("pending");
    expect(byId.get("mer-1")?.status).toBe("updated");
    expect(byId.get("mer-1")?.depth).toBe(2);
    expect(byId.get("mer-1")?.x).toBeGreaterThan(byId.get("flujo-1")?.x as number);
    expect(layout.truncated).toBe(false);
  });

  test("tells pending approval from pending sources apart", () => {
    const layout = layoutImpactGraph({
      originId: "req-1",
      originKind: "requirement",
      originTitle: null,
      affected: [
        { id: "flujo-1", kind: "flow", requiresReview: false, awaitingApproval: true, title: null },
        { id: "mer-1", kind: "data_model", requiresReview: false, title: null },
      ],
      paths: [
        ["req-1", "flujo-1"],
        ["req-1", "mer-1"],
      ],
    });
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("flujo-1")?.status).toBe("awaiting");
    expect(byId.get("mer-1")?.status).toBe("updated");
  });

  test("diamond: two paths, one node", () => {
    const layout = layoutImpactGraph({
      originId: "req-1",
      originKind: "requirement",
      originTitle: null,
      affected: [
        { id: "a", kind: "flow", requiresReview: true, title: null },
        { id: "b", kind: "flow", requiresReview: true, title: null },
        { id: "c", kind: "data_model", requiresReview: true, title: null },
      ],
      paths: [
        ["req-1", "a", "c"],
        ["req-1", "b", "c"],
      ],
    });
    expect(layout.nodes.filter((n) => n.id === "c")).toHaveLength(1);
    expect(layout.edges).toHaveLength(4);
  });

  test("explicit truncation without faking the total", () => {
    const affected = Array.from({ length: MAX_GRAPH_NODES + 5 }, (_, i) => ({
      id: `flujo-${i}`,
      kind: "flow",
      requiresReview: true,
      title: null,
    }));
    const layout = layoutImpactGraph({
      originId: "req-1",
      originKind: "requirement",
      originTitle: null,
      affected,
      paths: affected.map((a) => ["req-1", a.id]),
    });
    expect(layout.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(layout.total).toBe(MAX_GRAPH_NODES + 6);
    expect(layout.truncated).toBe(true);
    // The source never truncates: it is the map's reference.
    expect(layout.nodes[0].id).toBe("req-1");
  });

  test("deterministic with a contained box", () => {
    const input = {
      originId: "req-1",
      originKind: "requirement",
      originTitle: null,
      affected: [
        { id: "b", kind: "flow", requiresReview: false, title: null },
        { id: "a", kind: "flow", requiresReview: true, title: null },
      ],
      paths: [
        ["req-1", "b"],
        ["req-1", "a"],
      ],
    };
    const first = layoutImpactGraph(input);
    const second = layoutImpactGraph(input);
    expect(second).toEqual(first);
    expect(first.width).toBeLessThanOrEqual(2 * NODE_W + 64);
    expect(first.height).toBe(2 * NODE_H + 22);
  });
});
