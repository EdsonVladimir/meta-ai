// @vitest-environment jsdom
// Column board: headers with badge/label/count, cards with expandable
// symbols and members, selection-only edges, hidden cards, honest
// test/config/no-symbol badges.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArchMapBoard } from "./ArchMapBoard";
import type { ArchMapEdge, ArchMapFile } from "./archModel";
import {
  ARCH_CARD_BORDER,
  ARCH_CARD_PAD_Y,
  ARCH_HEAD_ROW_H,
  ARCH_MEM_ROW_H,
  ARCH_META_ROW_H,
  ARCH_MORE_ROW_H,
  ARCH_SYM_ROW_H,
  cardHeight,
  emptyExpansion,
  fileKey,
  layoutBoard,
  type BoardColumn,
  type BoardExpansion,
} from "./boardLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function file(overrides: Partial<ArchMapFile> & { rel: string }): ArchMapFile {
  return {
    rootId: "root-1",
    layer: "services",
    layerReason: "suffix .service.",
    symbols: [],
    externals: [],
    missing: [],
    unresolved: [],
    unresolvedTruncated: false,
    ...overrides,
  };
}

function sym(
  id: string,
  kind: "class" | "function",
  name: string,
  members: string[],
  decorators: string[] = [],
): ArchMapFile["symbols"][number] {
  return {
    id,
    kind,
    name,
    rootId: "root-1",
    rel: "src/sales.service.ts",
    members: members.map((member) => ({ name: member, kind: "method" as const, detail: "()" })),
    membersTruncated: false,
    decorators,
    unresolved: [],
    unresolvedTruncated: false,
    range: { startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
  };
}

const CTRL = file({
  rel: "src/sales.controller.ts",
  layer: "controllers",
  symbols: [
    sym("ts:root-1:src/sales.controller.ts#0", "class", "SalesController", ["list"], [
      "Controller",
    ]),
  ],
});

const SVC = file({
  rel: "src/sales.service.ts",
  symbols: [
    sym("ts:root-1:src/sales.service.ts#0", "class", "SalesService", ["all"], ["Injectable"]),
    sym("ts:root-1:src/sales.service.ts#1", "function", "helper", []),
    sym("ts:root-1:src/sales.service.ts#2", "function", "other", []),
    sym("ts:root-1:src/sales.service.ts#3", "function", "fourth", []),
  ],
});

const EDGE: ArchMapEdge = {
  id: "edge:root-1::src/sales.controller.ts::src/sales.service.ts",
  rootId: "root-1",
  fromRel: "src/sales.controller.ts",
  toRel: "src/sales.service.ts",
  kinds: [
    { kind: "imports", count: 1 },
    { kind: "references", count: 1 },
  ],
  evidence: "src/sales.controller.ts:1 imports './sales.service'",
};

function columns(): BoardColumn[] {
  return [
    { layer: "controllers", files: [CTRL] },
    { layer: "services", files: [SVC] },
  ];
}

function renderBoard(options: {
  cols?: BoardColumn[];
  edges?: ArchMapEdge[];
  visible?: Set<string>;
  selectedKey?: string | null;
  edgeOpts?: { incoming: boolean; outgoing: boolean; depth: 1 | 2 };
  expansion?: BoardExpansion;
  onToggleSymbols?: (key: string) => void;
  onToggleMembers?: (id: string) => void;
  onSelect?: (key: string | null) => void;
} = {}) {
  const cols = options.cols ?? columns();
  const expansion = options.expansion ?? emptyExpansion();
  const onSelect = options.onSelect ?? (() => {});
  const onToggleSymbols = options.onToggleSymbols ?? (() => {});
  const onToggleMembers = options.onToggleMembers ?? (() => {});
  const utils = render(
    <ArchMapBoard
      columns={cols}
      layout={layoutBoard(cols, expansion)}
      edges={options.edges ?? [EDGE]}
      visibleKeys={
        options.visible ??
        new Set([fileKey("root-1", CTRL.rel), fileKey("root-1", SVC.rel)])
      }
      selectedKey={options.selectedKey ?? null}
      edgeOpts={options.edgeOpts ?? { incoming: true, outgoing: true, depth: 1 }}
      expansion={expansion}
      onToggleSymbols={onToggleSymbols}
      onToggleMembers={onToggleMembers}
      onSelect={onSelect}
    />,
  );
  return { ...utils, onSelect, onToggleSymbols, onToggleMembers };
}

describe("ArchMapBoard", () => {
  it("renders column headers, cards and symbols", () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: "Controllers (1 file)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Services (1 file)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "src/sales.controller.ts, 1 symbols" })).toBeTruthy();
    expect(screen.getByText("SalesService")).toBeTruthy();
    // Badges: language, symbol count, no-symbol and kind markers.
    expect(screen.getAllByText("TS").length).toBeGreaterThan(0);
    expect(screen.getByText("1 symbol")).toBeTruthy();
  });

  it("sizes every card from the same layout pass", () => {
    const { container } = renderBoard();
    const cards = Array.from(container.querySelectorAll(".archboard-card"));
    expect(cards).toHaveLength(2);
    expect((cards[0] as HTMLElement).style.height).toBe(`${cardHeight(CTRL, emptyExpansion())}px`);
    expect((cards[1] as HTMLElement).style.height).toBe(`${cardHeight(SVC, emptyExpansion())}px`);
    const canvas = container.querySelector(".archboard") as HTMLElement;
    const layout = layoutBoard(columns(), emptyExpansion());
    expect(canvas.style.width).toBe(`${layout.width}px`);
    expect(canvas.style.height).toBe(`${layout.height}px`);
  });

  it("matches every card height to its rendered rows", () => {
    const expansion: BoardExpansion = {
      allSymbols: new Set([fileKey("root-1", SVC.rel)]),
      openMembers: new Set(["ts:root-1:src/sales.service.ts#0"]),
    };
    const { container } = renderBoard({ expansion });
    for (const card of Array.from(container.querySelectorAll(".archboard-card"))) {
      const rows =
        ARCH_CARD_PAD_Y * 2 +
        ARCH_CARD_BORDER +
        ARCH_HEAD_ROW_H * card.querySelectorAll(":scope > .archboard-card-head").length +
        ARCH_META_ROW_H * card.querySelectorAll(":scope > .archboard-card-meta").length +
        ARCH_SYM_ROW_H * card.querySelectorAll(":scope > .archboard-symbol").length +
        ARCH_MEM_ROW_H * card.querySelectorAll(":scope > .archboard-member-slot").length +
        ARCH_MORE_ROW_H * card.querySelectorAll(":scope > .archboard-more").length;
      expect((card as HTMLElement).style.height).toBe(`${rows}px`);
    }
  });

  it("selects on header click and toggles off", () => {
    const onSelect = vi.fn();
    renderBoard({ onSelect });
    const head = screen.getByRole("button", { name: "src/sales.service.ts, 4 symbols" });
    fireEvent.click(head);
    expect(onSelect).toHaveBeenCalledWith(fileKey("root-1", SVC.rel));
  });

  it("draws no edges without a selection", () => {
    renderBoard({ selectedKey: null });
    expect(document.querySelectorAll(".arch-edge")).toHaveLength(0);
  });

  it("draws only the selected card edges, with kind labels", () => {
    const other = file({ rel: "src/lonely.service.ts", symbols: [] });
    const otherEdge: ArchMapEdge = {
      id: "edge:root-1::src/lonely.service.ts::src/sales.service.ts",
      rootId: "root-1",
      fromRel: "src/lonely.service.ts",
      toRel: "src/sales.service.ts",
      kinds: [{ kind: "imports", count: 1 }],
      evidence: "test",
    };
    renderBoard({
      cols: [
        { layer: "controllers", files: [CTRL] },
        { layer: "services", files: [SVC, other] },
      ],
      edges: [EDGE, otherEdge],
      visible: new Set(
        [CTRL.rel, SVC.rel, other.rel].map((rel) => fileKey("root-1", rel)),
      ),
      selectedKey: fileKey("root-1", CTRL.rel),
    });
    const paths = document.querySelectorAll(".arch-edge");
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("class")).toContain("kind-imports");
    expect(document.querySelectorAll(".arch-edge-label")).toHaveLength(1);
    expect(screen.getByText("imports, references")).toBeTruthy();
  });

  it("hides filtered-out cards and their edges", () => {
    renderBoard({
      visible: new Set([fileKey("root-1", CTRL.rel)]),
      selectedKey: fileKey("root-1", CTRL.rel),
    });
    expect(document.querySelectorAll(".arch-edge")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "src/sales.service.ts, 4 symbols" }).closest(
        ".archboard-card",
      )?.className,
    ).toContain("hidden");
  });

  it("expands symbol lists and member lists on demand", () => {
    const onToggleSymbols = vi.fn();
    const onToggleMembers = vi.fn();
    renderBoard({ onToggleSymbols, onToggleMembers });
    expect(screen.queryByText("fourth")).toBeNull();
    const more = screen.getByRole("button", { name: "Show all 4 symbols" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(onToggleSymbols).toHaveBeenCalledWith(fileKey("root-1", SVC.rel));
    fireEvent.click(screen.getByRole("button", { name: "SalesService, 1 members" }));
    expect(onToggleMembers).toHaveBeenCalledWith("ts:root-1:src/sales.service.ts#0");
  });

  it("shows full lists with a way back once expanded", () => {
    renderBoard({
      expansion: {
        allSymbols: new Set([fileKey("root-1", SVC.rel)]),
        openMembers: new Set(["ts:root-1:src/sales.service.ts#0"]),
      },
    });
    expect(screen.getByText("fourth")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    // One row per member, never a concatenated paragraph.
    expect(screen.getByTitle("Method: all()")).toBeTruthy();
  });

  it("marks test, config and symbol-less files", () => {
    const test = file({ rel: "src/a.spec.ts", layer: "unassigned", layerReason: "test file" });
    const config = file({ rel: "src/app.config.ts", layer: "crosscutting", symbols: [] });
    const { container } = renderBoard({
      cols: [
        { layer: "unassigned", files: [test] },
        { layer: "crosscutting", files: [config] },
      ],
      edges: [],
      visible: new Set([fileKey("root-1", test.rel), fileKey("root-1", config.rel)]),
    });
    expect(screen.getByText("test")).toBeTruthy();
    expect(screen.getByText("config")).toBeTruthy();
    expect(screen.getAllByText("no symbols")).toHaveLength(2);
    // The Unassigned column keeps its explanation as a tooltip.
    const head = container.querySelector(".archboard-col-head") as HTMLElement;
    expect(head.getAttribute("title")).toMatch(/Matched no rule/);
  });

  it("keeps full names in tooltips while truncating", () => {
    const long = file({
      rel: "src/deeply/nested/a-very-long-file-name-that-overflows.service.ts",
      symbols: [],
    });
    renderBoard({
      cols: [{ layer: "services", files: [long] }],
      edges: [],
      visible: new Set([fileKey("root-1", long.rel)]),
    });
    const head = screen.getByRole("button", { name: /a-very-long-file-name/ });
    expect(head.getAttribute("title")).toBe(long.rel);
  });
});
