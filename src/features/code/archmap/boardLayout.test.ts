// boardLayout: deterministic column geometry, content heights,
// edge endpoints on card borders, selection-only edges, fit/anchor math.
import { describe, expect, it } from "vitest";
import type {
  ArchMapEdge,
  ArchMapFile,
  ArchMapNode,
  ArchMapSymbol,
  ArchMapSymbolEdge,
} from "./archModel";
import {
  ARCH_CARD_BORDER,
  ARCH_CARD_GAP,
  ARCH_CARD_PAD_Y,
  ARCH_CARD_W,
  ARCH_COL_BOTTOM_PAD,
  ARCH_COL_GAP,
  ARCH_COL_HEAD_H,
  ARCH_COL_PAD_X,
  ARCH_COL_W,
  ARCH_HEAD_ROW_H,
  ARCH_MEM_ROW_H,
  ARCH_META_ROW_H,
  ARCH_MORE_ROW_H,
  ARCH_SUB_ROW_H,
  ARCH_SYM_ROW_H,
  anchoredScroll,
  edgeMidpoint,
  cardHeight,
  columnX,
  edgePath,
  emptyExpansion,
  fileKey,
  fitZoomStep,
  layoutBoard,
  layoutSymbolBoard,
  symbolCardHeight,
  visibleBoardEdges,
  visibleSymbolEdges,
  type BoardExpansion,
} from "./boardLayout";

function symbol(name: string, memberNames: string[] = []): ArchMapSymbol {
  return {
    id: `ts:root-1:${name}#0`,
    kind: "class",
    name,
    rootId: "root-1",
    rel: "a.ts",
    members: memberNames.map((member) => ({ name: member, kind: "method" as const, detail: "()" })),
    membersTruncated: false,
    decorators: [],
    unresolved: [],
    unresolvedTruncated: false,
    range: { startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
  };
}

function file(overrides: Partial<ArchMapFile> & { rel: string }): ArchMapFile {
  return {
    rootId: "root-1",
    layer: "services",
    layerReason: "test",
    symbols: [],
    externals: [],
    missing: [],
    unresolved: [],
    unresolvedTruncated: false,
    ...overrides,
  };
}

function edge(fromRel: string, toRel: string): ArchMapEdge {
  return {
    id: `edge:${fromRel}::${toRel}`,
    rootId: "root-1",
    fromRel,
    toRel,
    kinds: [{ kind: "imports", count: 1 }],
    evidence: "test",
  };
}

const BASE_CARD = ARCH_CARD_PAD_Y * 2 + ARCH_CARD_BORDER + ARCH_HEAD_ROW_H + ARCH_META_ROW_H;

describe("cardHeight", () => {
  it("derives heights from the rows actually rendered", () => {
    const empty = file({ rel: "a.ts" });
    expect(cardHeight(empty, emptyExpansion())).toBe(BASE_CARD);
    const withSymbols = file({ rel: "b.ts", symbols: [symbol("A"), symbol("B")] });
    expect(cardHeight(withSymbols, emptyExpansion())).toBe(BASE_CARD + 2 * ARCH_SYM_ROW_H);
    const many = file({
      rel: "c.ts",
      symbols: [symbol("A"), symbol("B"), symbol("C"), symbol("D")],
    });
    expect(cardHeight(many, emptyExpansion())).toBe(
      BASE_CARD + 3 * ARCH_SYM_ROW_H + ARCH_MORE_ROW_H,
    );
    const all: BoardExpansion = { allSymbols: new Set([fileKey("root-1", "c.ts")]), openMembers: new Set() };
    expect(cardHeight(many, all)).toBe(BASE_CARD + 4 * ARCH_SYM_ROW_H + ARCH_MORE_ROW_H);
  });

  it("grows with open member lists", () => {
    const candidate = file({ rel: "a.ts", symbols: [symbol("A", ["m1", "m2"])] });
    expect(cardHeight(candidate, emptyExpansion())).toBe(BASE_CARD + ARCH_SYM_ROW_H);
    const open: BoardExpansion = {
      allSymbols: new Set(),
      openMembers: new Set(["ts:root-1:A#0"]),
    };
    expect(cardHeight(candidate, open)).toBe(BASE_CARD + ARCH_SYM_ROW_H + 2 * ARCH_MEM_ROW_H);
  });
});

describe("layoutBoard", () => {
  const first = file({ rel: "a.controller.ts", symbols: [symbol("A")] });
  const second = file({
    rel: "b.controller.ts",
    symbols: [symbol("B", ["m1"]), symbol("B2")],
  });
  const third = file({ rel: "c.service.ts", symbols: [] });

  it("places columns left to right with their cards stacked", () => {
    const layout = layoutBoard(
      [
        { layer: "controllers", files: [first, second] },
        { layer: "services", files: [third] },
      ],
      emptyExpansion(),
    );
    expect(columnX(0)).toBe(0);
    expect(columnX(1)).toBe(ARCH_COL_W + ARCH_COL_GAP);
    expect(layout.width).toBe(2 * ARCH_COL_W + ARCH_COL_GAP);
    const a = layout.cards.get(fileKey("root-1", "a.controller.ts"))!;
    const b = layout.cards.get(fileKey("root-1", "b.controller.ts"))!;
    const c = layout.cards.get(fileKey("root-1", "c.service.ts"))!;
    expect(a.x).toBe(ARCH_COL_PAD_X);
    expect(a.y).toBe(ARCH_COL_HEAD_H + ARCH_CARD_GAP);
    expect(a.w).toBe(ARCH_CARD_W);
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y + a.h + ARCH_CARD_GAP);
    expect(b.h).toBeGreaterThan(a.h);
    expect(c.x).toBe(columnX(1) + ARCH_COL_PAD_X);
    expect(layout.height).toBe(b.y + b.h + ARCH_COL_BOTTOM_PAD);
  });

  it("never intersects cards of one column", () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      file({
        rel: `f${i}.ts`,
        symbols: Array.from({ length: i % 5 }, (_, j) => symbol(`S${i}_${j}`, j % 2 === 0 ? ["m"] : [])),
      }),
    );
    const expansion: BoardExpansion = {
      allSymbols: new Set([fileKey("root-1", "f4.ts")]),
      openMembers: new Set(["ts:root-1:S6_0#0", "ts:root-1:S6_2#0"]),
    };
    const layout = layoutBoard([{ layer: "services", files }], expansion);
    const boxes = files.map((entry) => layout.cards.get(fileKey(entry.rootId, entry.rel))!);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const verticalGap = boxes[j].y - (boxes[i].y + boxes[i].h);
        expect(verticalGap).toBeGreaterThanOrEqual(ARCH_CARD_GAP);
      }
      expect(boxes[i].y + boxes[i].h).toBeLessThanOrEqual(layout.height);
      expect(boxes[i].x + boxes[i].w).toBeLessThanOrEqual(layout.width);
    }
  });

  it("shifts later cards when members expand", () => {
    const columns = [{ layer: "services" as const, files: [first, second] }];
    const before = layoutBoard(columns, emptyExpansion());
    const after = layoutBoard(columns, {
      allSymbols: new Set(),
      openMembers: new Set(["ts:root-1:A#0"]),
    });
    const keyA = fileKey("root-1", "a.controller.ts");
    const keyB = fileKey("root-1", "b.controller.ts");
    // A has no members, so nothing moves; B's member list pushes nothing
    // below it either, but opening B grows its own box.
    expect(after.cards.get(keyA)).toEqual(before.cards.get(keyA));
    const openB: BoardExpansion = {
      allSymbols: new Set(),
      openMembers: new Set(["ts:root-1:B#0"]),
    };
    const grown = layoutBoard(
      [{ layer: "services" as const, files: [second, first] }],
      openB,
    );
    const flat = layoutBoard([{ layer: "services" as const, files: [second, first] }], emptyExpansion());
    expect(grown.cards.get(keyB)!.h).toBe(flat.cards.get(keyB)!.h + ARCH_MEM_ROW_H);
    expect(grown.cards.get(keyA)!.y).toBe(flat.cards.get(keyA)!.y + ARCH_MEM_ROW_H);
  });
});

describe("edgePath", () => {
  it("anchors same-column cards bottom to top", () => {
    const path = edgePath({ x: 8, y: 38, w: 280, h: 100 }, { x: 8, y: 150, w: 280, h: 60 });
    expect(path).toBe("M 148,138 C 148,144 148,144 148,150");
  });

  it("anchors facing side edges across columns", () => {
    const left = { x: 8, y: 38, w: 280, h: 100 };
    const right = { x: 332, y: 200, w: 280, h: 60 };
    expect(edgePath(left, right)).toBe("M 288,88 C 312,88 308,230 332,230");
    expect(edgePath(right, left)).toBe("M 332,230 C 308,230 312,88 288,88");
  });
});

describe("visibleBoardEdges", () => {
  const edges = [edge("a.ts", "b.ts"), edge("b.ts", "c.ts"), edge("c.ts", "d.ts")];
  const keys = new Set(["a.ts", "b.ts", "c.ts", "d.ts"].map((rel) => fileKey("root-1", rel)));

  it("draws nothing without a selection", () => {
    expect(visibleBoardEdges(edges, keys, null, { incoming: true, outgoing: true, depth: 2 })).toEqual(
      [],
    );
  });

  it("keeps the direct neighborhood filtered by direction", () => {
    const sel = fileKey("root-1", "b.ts");
    expect(
      visibleBoardEdges(edges, keys, sel, { incoming: true, outgoing: true, depth: 1 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["edge:a.ts::b.ts", "edge:b.ts::c.ts"]);
    expect(
      visibleBoardEdges(edges, keys, sel, { incoming: true, outgoing: false, depth: 1 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["edge:a.ts::b.ts"]);
    expect(
      visibleBoardEdges(edges, keys, sel, { incoming: false, outgoing: true, depth: 1 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["edge:b.ts::c.ts"]);
  });

  it("adds one context hop at depth 2", () => {
    const sel = fileKey("root-1", "b.ts");
    expect(
      visibleBoardEdges(edges, keys, sel, { incoming: true, outgoing: true, depth: 2 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["edge:a.ts::b.ts", "edge:b.ts::c.ts", "edge:c.ts::d.ts"]);
  });

  it("drops edges with a filtered-out end", () => {
    const sel = fileKey("root-1", "b.ts");
    const partial = new Set([fileKey("root-1", "a.ts"), sel]);
    expect(
      visibleBoardEdges(edges, partial, sel, { incoming: true, outgoing: true, depth: 2 }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["edge:a.ts::b.ts"]);
  });
});

describe("fitZoomStep", () => {
  it("picks the largest step that fits", () => {
    expect(fitZoomStep(1000, 800, 1000, 800)).toBe(1);
    expect(fitZoomStep(1000, 800, 500, 800)).toBe(0.5);
    expect(fitZoomStep(1000, 800, 700, 800)).toBe(0.67);
    expect(fitZoomStep(1000, 800, 400, 300)).toBe(0.5);
    expect(fitZoomStep(200, 100, 2000, 2000)).toBe(2);
  });

  it("falls back to 100% without sizes", () => {
    expect(fitZoomStep(0, 0, 800, 600)).toBe(1);
    expect(fitZoomStep(400, 300, 0, 0)).toBe(1);
  });
});

describe("edgeMidpoint", () => {
  it("sits between the anchored ends, in the gap between neighbor columns", () => {
    const a = { x: columnX(0) + ARCH_COL_PAD_X, y: 0, w: ARCH_CARD_W, h: 40 };
    const b = { x: columnX(1) + ARCH_COL_PAD_X, y: 100, w: ARCH_CARD_W, h: 60 };
    const gapMid = (a.x + a.w + b.x) / 2;
    expect(edgeMidpoint(a, b)).toEqual({ x: gapMid, y: 75 });
    expect(edgeMidpoint(b, a)).toEqual({ x: gapMid, y: 75 });
  });

  it("moves labels of long edges beside the target, never onto a card in between", () => {
    const a = { x: columnX(0) + ARCH_COL_PAD_X, y: 0, w: ARCH_CARD_W, h: 40 };
    const c = { x: columnX(2) + ARCH_COL_PAD_X, y: 100, w: ARCH_CARD_W, h: 60 };
    const between = { left: columnX(1), right: columnX(1) + ARCH_COL_W };
    const label = edgeMidpoint(a, c);
    expect(label.x).toBe(columnX(2) - ARCH_COL_GAP / 2);
    expect(label.x > between.right).toBe(true);
    expect(label.y).toBe(130);
    expect(edgeMidpoint(c, a).x).toBe(columnX(1) - ARCH_COL_GAP / 2);
    expect(edgeMidpoint(c, a).x < between.left).toBe(true);
  });

  it("sits in the vertical gap for cards in one column", () => {
    const upper = { x: 0, y: 0, w: 100, h: 40 };
    const lower = { x: 0, y: 60, w: 100, h: 40 };
    expect(edgeMidpoint(lower, upper)).toEqual({ x: 50, y: 50 });
  });
});

describe("symbolCardHeight", () => {
  const BASE =
    ARCH_CARD_PAD_Y * 2 + ARCH_CARD_BORDER + ARCH_HEAD_ROW_H + ARCH_SUB_ROW_H + ARCH_META_ROW_H;

  it("opens members by default, one row each, growing with the list", () => {
    expect(symbolCardHeight(0, false)).toBe(BASE);
    expect(symbolCardHeight(3, false)).toBe(BASE + 3 * ARCH_MEM_ROW_H + ARCH_MORE_ROW_H);
    // The analyzer caps lists at 50; every row is laid out, none scrolls.
    expect(symbolCardHeight(50, false)).toBe(BASE + 50 * ARCH_MEM_ROW_H + ARCH_MORE_ROW_H);
  });

  it("collapses to header rows plus an honest toggle", () => {
    expect(symbolCardHeight(25, true)).toBe(BASE + ARCH_MORE_ROW_H);
    expect(symbolCardHeight(0, true)).toBe(BASE);
  });

  it("renders reference cards as head + meta only", () => {
    expect(symbolCardHeight(25, false, true)).toBe(BASE);
    expect(symbolCardHeight(25, true, true)).toBe(BASE);
    expect(symbolCardHeight(0, false, true)).toBe(BASE);
  });
});

describe("layoutSymbolBoard", () => {
  function node(id: string, memberCount: number): ArchMapNode {
    const symbol: ArchMapSymbol = {
      id,
      kind: "class",
      name: id,
      rootId: "root-1",
      rel: "a.ts",
      members: Array.from({ length: memberCount }, (_, i) => ({
        name: `m${i}`,
        kind: "method" as const,
        detail: "()",
      })),
      membersTruncated: false,
      decorators: [],
      unresolved: [],
      unresolvedTruncated: false,
      range: { startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
    };
    return { id, rootId: "root-1", rel: "a.ts", symbol, layer: "services", layerReason: "t" };
  }

  it("stacks symbol cards without intersections", () => {
    const nodes = [node("a", 2), node("b", 25), node("c", 0)];
    const layout = layoutSymbolBoard([{ layer: "services", nodes }], new Set());
    const boxes = nodes.map((entry) => layout.cards.get(entry.id)!);
    expect(boxes).toHaveLength(3);
    for (let i = 0; i < boxes.length - 1; i += 1) {
      expect(boxes[i + 1].y - (boxes[i].y + boxes[i].h)).toBe(ARCH_CARD_GAP);
    }
    expect(boxes[1].h).toBeGreaterThan(boxes[0].h);
    expect(boxes[2].h).toBeLessThan(boxes[0].h);
  });

  it("shifts later cards when one collapses", () => {
    const columns = [{ layer: "services" as const, nodes: [node("a", 10), node("b", 2)] }];
    const open = layoutSymbolBoard(columns, new Set());
    const shut = layoutSymbolBoard(columns, new Set(["a"]));
    expect(shut.cards.get("b")!.y).toBeLessThan(open.cards.get("b")!.y);
    expect(shut.cards.get("a")!.y).toBe(open.cards.get("a")!.y);
  });

  it("compacts reference cards without moving their top", () => {
    const columns = [{ layer: "services" as const, nodes: [node("a", 10), node("b", 2)] }];
    const full = layoutSymbolBoard(columns, new Set());
    const ref = layoutSymbolBoard(columns, new Set(), new Set(["a"]));
    expect(ref.cards.get("a")!.y).toBe(full.cards.get("a")!.y);
    expect(ref.cards.get("a")!.h).toBeLessThan(full.cards.get("a")!.h);
    expect(ref.cards.get("b")!.y).toBeLessThan(full.cards.get("b")!.y);
  });
});

describe("visibleSymbolEdges", () => {
  const edges: ArchMapSymbolEdge[] = [
    { id: "e1", from: "a", to: "b", kinds: [{ kind: "references", count: 1 }], evidence: "t" },
    { id: "e2", from: "b", to: "c", kinds: [{ kind: "extends", count: 1 }], evidence: "t" },
    { id: "e3", from: "c", to: "d", kinds: [{ kind: "references", count: 2 }], evidence: "t" },
  ];
  const ids = new Set(["a", "b", "c", "d"]);

  it("draws nothing without a selection", () => {
    expect(
      visibleSymbolEdges(edges, ids, null, { incoming: true, outgoing: true, depth: 2 }),
    ).toEqual([]);
  });

  it("keeps the directed neighborhood at depth 1", () => {
    const both = visibleSymbolEdges(edges, ids, "b", {
      incoming: true,
      outgoing: true,
      depth: 1,
    });
    expect(both.map((e) => e.id)).toEqual(["e1", "e2"]);
    const out = visibleSymbolEdges(edges, ids, "b", {
      incoming: false,
      outgoing: true,
      depth: 1,
    });
    expect(out.map((e) => e.id)).toEqual(["e2"]);
  });

  it("adds one context hop at depth 2", () => {
    const deep = visibleSymbolEdges(edges, ids, "b", {
      incoming: true,
      outgoing: true,
      depth: 2,
    });
    expect(deep.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("anchoredScroll", () => {
  it("keeps the point under the cursor stable", () => {
    // Content point (100 + 50) at zoom 1 lands on scroll 250 at zoom 2.
    expect(anchoredScroll(1, 2, 100, 50)).toBe(250);
    expect(anchoredScroll(2, 1, 250, 50)).toBe(100);
    expect(anchoredScroll(1, 1, 100, 50)).toBe(100);
  });

  it("never scrolls negative", () => {
    expect(anchoredScroll(2, 1, 0, 10)).toBe(0);
  });
});
