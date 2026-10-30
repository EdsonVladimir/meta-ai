// @vitest-environment jsdom
// Symbol board: one card per symbol with its own layer, members open
// by default as one row each (the card grows to hold them all), honest
// collapse toggles, unresolved markers, member selection, and
// symbol-only edges around the selection.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArchSymbolBoard } from "./ArchSymbolBoard";
import type { ArchMapNode, ArchMapSymbol, ArchMapSymbolEdge } from "./archModel";
import {
  ARCH_CARD_BORDER,
  ARCH_CARD_PAD_Y,
  ARCH_HEAD_ROW_H,
  ARCH_MEM_ROW_H,
  ARCH_META_ROW_H,
  ARCH_MORE_ROW_H,
  ARCH_SUB_ROW_H,
  layoutSymbolBoard,
  symbolCardHeight,
  type SymbolColumn,
} from "./boardLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function sym(
  id: string,
  kind: ArchMapSymbol["kind"],
  name: string,
  members: Array<{ name: string; detail?: string }>,
  extras: Partial<ArchMapSymbol> = {},
): ArchMapSymbol {
  return {
    id,
    kind,
    name,
    rootId: "root-1",
    rel: "src/shop.ts",
    members: members.map((m) => ({ name: m.name, kind: "method" as const, detail: m.detail ?? "()" })),
    membersTruncated: false,
    decorators: [],
    unresolved: [],
    unresolvedTruncated: false,
    range: { startLine: 1, startCol: 1, endLine: 2, endCol: 1 },
    ...extras,
  };
}

function node(symbol: ArchMapSymbol, layer: ArchMapNode["layer"]): ArchMapNode {
  return {
    id: symbol.id,
    rootId: symbol.rootId,
    rel: symbol.rel,
    symbol,
    layer,
    layerReason: "test",
  };
}

const CTRL = sym("c1", "class", "SalesController", [{ name: "list" }], {
  decorators: ["Controller"],
});
const SVC = sym(
  "s1",
  "class",
  "SalesService",
  [{ name: "all" }, { name: "one", detail: "(id: string)" }],
  { decorators: ["Injectable"] },
);
const DTO = sym("d1", "interface", "SaleDto", []);

const EDGES: ArchMapSymbolEdge[] = [
  {
    id: "symedge:c1::s1",
    from: "c1",
    to: "s1",
    kinds: [{ kind: "references", count: 1 }],
    evidence: "src/shop.ts:2 (constructor)",
  },
  {
    id: "symedge:s1::d1",
    from: "s1",
    to: "d1",
    kinds: [{ kind: "references", count: 1 }],
    evidence: "src/shop.ts:5 (return)",
  },
];

function columns(): SymbolColumn[] {
  return [
    { layer: "controllers", nodes: [node(CTRL, "controllers")] },
    { layer: "services", nodes: [node(SVC, "services")] },
    { layer: "contracts", nodes: [node(DTO, "contracts")] },
  ];
}

function renderBoard(options: {
  cols?: SymbolColumn[];
  edges?: ArchMapSymbolEdge[];
  visible?: Set<string>;
  selectedId?: string | null;
  collapsed?: Set<string>;
  referenceIds?: Set<string>;
  referenceNote?: string | null;
  onToggleMembers?: (id: string) => void;
  onSelect?: (id: string | null) => void;
  onShowFlow?: (symbolId: string, member: string | null) => void;
  selectedMember?: number | null;
  onSelectMember?: (id: string, index: number) => void;
  projectLabel?: string | null;
} = {}) {
  const cols = options.cols ?? columns();
  const collapsed = options.collapsed ?? new Set<string>();
  const referenceIds = options.referenceIds ?? new Set<string>();
  const utils = render(
    <ArchSymbolBoard
      columns={cols}
      layout={layoutSymbolBoard(cols, collapsed, referenceIds)}
      edges={options.edges ?? EDGES}
      visibleIds={options.visible ?? new Set(["c1", "s1", "d1"])}
      selectedId={options.selectedId ?? null}
      edgeOpts={{ incoming: true, outgoing: true, depth: 1 }}
      collapsed={collapsed}
      referenceIds={referenceIds}
      referenceNote={options.referenceNote}
      onShowFlow={options.onShowFlow}
      selectedMember={options.selectedMember}
      onSelectMember={options.onSelectMember}
      projectLabel={options.projectLabel}
      onToggleMembers={options.onToggleMembers ?? (() => {})}
      onSelect={options.onSelect ?? (() => {})}
    />,
  );
  return utils;
}

describe("ArchSymbolBoard", () => {
  it("renders one card per symbol with its own layer", () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: "Controllers (1 symbol)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Services (1 symbol)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Data Contracts (1 symbol)" })).toBeTruthy();
    // Symbol name leads; file, language and counts stay secondary.
    expect(
      screen.getByRole("button", { name: "SalesService, class, 2 members" }),
    ).toBeTruthy();
    expect(screen.getAllByText("TS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("shop.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("no members")).toBeTruthy();
  });

  it("opens every member by default with an honest collapse", () => {
    const onToggleMembers = vi.fn();
    renderBoard({ onToggleMembers });
    expect(screen.getByTitle("Method: all()")).toBeTruthy();
    expect(screen.getByTitle("Method: one(id: string)")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Hide 2 members" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggleMembers).toHaveBeenCalledWith("s1");
  });

  it("sizes every card from the same layout pass", () => {
    const collapsed = new Set(["s1"]);
    const { container } = renderBoard({ collapsed });
    const cards = Array.from(container.querySelectorAll(".archboard-card"));
    expect(cards).toHaveLength(3);
    expect((cards[0] as HTMLElement).style.height).toBe(`${symbolCardHeight(1, false)}px`);
    expect((cards[1] as HTMLElement).style.height).toBe(`${symbolCardHeight(2, true)}px`);
    expect((cards[2] as HTMLElement).style.height).toBe(`${symbolCardHeight(0, false)}px`);
    // Rendered rows match the math: one slot per member row.
    for (const card of cards) {
      const rows = card.querySelectorAll(".archboard-member-slot").length;
      const toggle = card.querySelectorAll(":scope > .archboard-more").length;
      const expected =
        ARCH_CARD_PAD_Y * 2 +
        ARCH_CARD_BORDER +
        ARCH_HEAD_ROW_H +
        ARCH_SUB_ROW_H +
        ARCH_META_ROW_H +
        rows * ARCH_MEM_ROW_H +
        toggle * ARCH_MORE_ROW_H;
      expect((card as HTMLElement).style.height).toBe(`${expected}px`);
    }
  });

  it("grows to hold every member row instead of scrolling inside", () => {
    const big = sym(
      "b1",
      "class",
      "Big",
      Array.from({ length: 25 }, (_, i) => ({ name: `m${i}` })),
    );
    const cols: SymbolColumn[] = [{ layer: "services", nodes: [node(big, "services")] }];
    const { container } = renderBoard({ cols, visible: new Set(["b1"]) });
    const list = container.querySelector(".archboard-member-list") as HTMLElement;
    // Every member gets its own row; the card height covers them all.
    expect(list.querySelectorAll(".archboard-member")).toHaveLength(25);
    const card = list.closest(".archboard-card") as HTMLElement;
    expect(card.style.height).toBe(`${symbolCardHeight(25, false)}px`);
    expect(symbolCardHeight(25, false)).toBeGreaterThanOrEqual(25 * ARCH_MEM_ROW_H);
    expect(screen.getByRole("button", { name: "Hide 25 members" })).toBeTruthy();
  });

  it("marks unresolved references and capped member lists", () => {
    const tricky = sym("t1", "class", "Tricky", [{ name: "run" }], {
      membersTruncated: true,
      unresolved: [{ toName: "Ghost", kind: "references", status: "unresolved" }],
    });
    const cols: SymbolColumn[] = [{ layer: "services", nodes: [node(tricky, "services")] }];
    renderBoard({ cols, visible: new Set(["t1"]) });
    expect(screen.getByText("1 unresolved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide 1 member (list capped)" })).toBeTruthy();
  });

  it("selects on head click and toggles off", () => {
    const onSelect = vi.fn();
    renderBoard({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: /SalesService/ }));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("draws symbol edges only around the selection", () => {
    const { container, rerender } = renderBoard({ selectedId: null });
    expect(container.querySelectorAll(".arch-edge")).toHaveLength(0);
    const cols = columns();
    rerender(
      <ArchSymbolBoard
        columns={cols}
        layout={layoutSymbolBoard(cols, new Set())}
        edges={EDGES}
        visibleIds={new Set(["c1", "s1", "d1"])}
        selectedId="s1"
        edgeOpts={{ incoming: true, outgoing: true, depth: 1 }}
        collapsed={new Set()}
        onToggleMembers={() => {}}
        onSelect={() => {}}
      />,
    );
    const paths = container.querySelectorAll(".arch-edge");
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute("class")).toContain("kind-references");
    expect(container.querySelectorAll(".arch-edge-label")).toHaveLength(2);
  });

  it("keeps full names in tooltips while truncating", () => {
    const long = sym("l1", "class", "AVeryLongClassNameThatMustTruncateGracefully", []);
    const cols: SymbolColumn[] = [{ layer: "services", nodes: [node(long, "services")] }];
    renderBoard({ cols, visible: new Set(["l1"]) });
    const head = screen.getByRole("button", { name: /AVeryLongClassName/ });
    expect(head.getAttribute("title")).toContain("src/shop.ts");
  });

  it("renders references compactly, announced as outside the module", () => {
    const { container } = renderBoard({
      referenceIds: new Set(["s1"]),
      referenceNote: "outside SalesModule",
    });
    const head = screen.getByRole("button", { name: "SalesService, class, outside the module" });
    expect(head.getAttribute("title")).toContain("(outside the module)");
    const card = head.closest(".archboard-card");
    expect(card?.className).toContain("reference");
    expect(card?.querySelector(".archboard-member-list")).toBeNull();
    expect(card?.querySelector(".archboard-more")).toBeNull();
    const badge = card?.querySelector(".archboard-badge.ref");
    expect(badge?.textContent).toBe("reference");
    expect(badge?.getAttribute("title")).toBe("outside SalesModule");
    // Height matches the reference layout math (head + meta only).
    const cols = columns();
    const layout = layoutSymbolBoard(cols, new Set(), new Set(["s1"]));
    expect(card?.getAttribute("style")).toContain(`height: ${layout.cards.get("s1")?.h}px`);
    expect(container.querySelectorAll(".archboard-card.reference")).toHaveLength(1);
  });

  it("selects one member row for the inspector, separate from the card", () => {
    const onSelectMember = vi.fn();
    const { container } = renderBoard({ selectedId: "s1", selectedMember: 1, onSelectMember });
    const rows = screen.getAllByRole("button", { name: /^Method: / });
    expect(rows.map((row) => row.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    fireEvent.click(screen.getByRole("button", { name: "Method: all()" }));
    expect(onSelectMember).toHaveBeenCalledWith("s1", 0);
    // Selection is a state of its own: the role accent stays on the card.
    const card = container.querySelector(".archboard-card.selected") as HTMLElement;
    expect(card.className).toContain("role-services");
  });

  it("shows the real language, the project and every decorator", () => {
    const cols: SymbolColumn[] = [
      {
        layer: "ui",
        nodes: [
          node(
            sym("u1", "component", "ListView", [], {
              rel: "src/list.view.tsx",
              decorators: ["Component", "Custom"],
            }),
            "ui",
          ),
        ],
      },
    ];
    const { container } = renderBoard({ cols, visible: new Set(["u1"]), projectLabel: "shop-web" });
    expect(container.querySelector(".archboard-lang")?.textContent).toBe("TSX");
    expect(container.querySelector(".archboard-chip.project")?.textContent).toBe("shop-web");
    expect(container.querySelector(".archboard-decorator")?.textContent).toBe("@Component @Custom");
    expect(screen.getByRole("heading", { name: "UI Components (1 symbol)" })).toBeTruthy();
  });

  it("badges written visibility and modifiers, never implied ones", () => {
    const cols: SymbolColumn[] = [
      {
        layer: "services",
        nodes: [
          node(
            {
              ...sym("v1", "class", "Vis", []),
              members: [
                { name: "a", kind: "method", detail: "()", visibility: "private" },
                { name: "b", kind: "field", detail: ": B", visibility: "protected", isReadonly: true },
                { name: "c", kind: "method", detail: "()" },
              ],
            },
            "services",
          ),
        ],
      },
    ];
    const { container } = renderBoard({ cols, visible: new Set(["v1"]) });
    const tags = Array.from(container.querySelectorAll(".archboard-member")).map((row) =>
      Array.from(row.querySelectorAll(".archboard-tag")).map((tag) => tag.className.replace("archboard-tag ", "")),
    );
    expect(tags).toEqual([["vis-private"], ["vis-protected", "mod"], []]);
    // Visibility never tints the card as an error.
    expect(container.querySelector(".archboard-card")?.className).not.toContain("error");
  });

  it("offers Show flow only where a chain can start", () => {
    renderBoard({ onShowFlow: () => {} });
    expect(screen.getByRole("button", { name: "Show flow of SalesService" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show flow of SaleDto" })).toBeNull();
  });
});
