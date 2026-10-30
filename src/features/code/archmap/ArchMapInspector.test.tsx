// @vitest-environment jsdom
// Map inspector: empty state, collapsible sections, symbol rows with
// member counts (never concatenated paragraphs), members one per row,
// connections, unresolved refs, externals and out-of-scope imports,
// plus symbol-level selection with relation evidence. The inspector
// never opens code.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ArchMapInspector } from "./ArchMapInspector";
import type { ArchMapEdge, ArchMapFile } from "./archModel";
import type { StructureRelation } from "../structure/structureTypes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FILE: ArchMapFile = {
  rootId: "root-1",
  rel: "src/sales.service.ts",
  layer: "services",
  layerReason: "suffix .service.",
  symbols: [
    {
      id: "s2",
      kind: "class",
      name: "SalesService",
      rootId: "root-1",
      rel: "src/sales.service.ts",
      members: [
        { name: "all", kind: "method", detail: "()" },
        { name: "repo", kind: "field", detail: ": Repo" },
      ],
      membersTruncated: false,
      decorators: ["Injectable"],
      unresolved: [],
      unresolvedTruncated: false,
      range: { startLine: 3, startCol: 1, endLine: 9, endCol: 2 },
    },
  ],
  externals: ["@nestjs/common"],
  missing: ["./helpers"],
  unresolved: [{ toName: "Repo", kind: "references", status: "unresolved" }],
  unresolvedTruncated: false,
};

const IN: ArchMapEdge = {
  id: "e-in",
  rootId: "root-1",
  fromRel: "src/sales.controller.ts",
  toRel: "src/sales.service.ts",
  kinds: [{ kind: "imports", count: 1 }],
  evidence: "line 1",
};

const RELS: StructureRelation[] = [
  {
    id: "r1",
    kind: "references",
    from: "s9",
    to: "s2",
    toName: "SalesService",
    status: "resolved",
    evidence: "src/sales.controller.ts:2 (constructor)",
  },
  {
    id: "r2",
    kind: "references",
    from: "s2",
    to: null,
    toName: "Repo",
    status: "unresolved",
    evidence: "src/sales.service.ts:5 (type)",
  },
];

const INDEX = new Map([
  [
    "s2",
    {
      id: "s2",
      name: "SalesService",
      kind: "class",
      rel: "src/sales.service.ts",
      rootId: "root-1",
    },
  ],
  [
    "s9",
    {
      id: "s9",
      name: "SalesController",
      kind: "class",
      rel: "src/sales.controller.ts",
      rootId: "root-1",
    },
  ],
]);

describe("ArchMapInspector", () => {
  it("invites selection when empty", () => {
    render(<ArchMapInspector file={null} edges={[]} onSelectFile={() => {}} />);
    expect(screen.getByText(/Select a card/)).toBeTruthy();
  });

  it("shows type, symbols, connections and honesty lists", () => {
    const onSelectFile = vi.fn();
    render(<ArchMapInspector file={FILE} edges={[IN]} onSelectFile={onSelectFile} />);
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.getByText(/TypeScript file/)).toBeTruthy();
    expect(screen.getByText(/suffix .service/)).toBeTruthy();
    expect(screen.getByText(/class SalesService/)).toBeTruthy();
    // Members counted, never concatenated into a paragraph.
    expect(screen.getByText("2 members")).toBeTruthy();
    expect(screen.queryByText(/all, repo/)).toBeNull();
    expect(screen.getByText(/@Injectable/)).toBeTruthy();
    expect(screen.getByText(/Used by \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Uses \(0\)/)).toBeTruthy();
    expect(screen.getByText("Repo")).toBeTruthy();
    expect(screen.getByText("@nestjs/common")).toBeTruthy();
    expect(screen.getByText("./helpers")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in code" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /sales.controller/ }));
    expect(onSelectFile).toHaveBeenCalledWith("root-1", "src/sales.controller.ts");
  });

  it("collapses sections without losing them", () => {
    render(<ArchMapInspector file={FILE} edges={[IN]} onSelectFile={() => {}} />);
    const head = screen.getByRole("button", { name: /Symbols \(1\)/ });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/class SalesService/)).toBeNull();
    fireEvent.click(head);
    expect(screen.getByText(/class SalesService/)).toBeTruthy();
  });

  it("renders static symbol rows without selection mode", () => {
    render(<ArchMapInspector file={FILE} edges={[]} onSelectFile={() => {}} />);
    expect(screen.getByText(/class SalesService/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /class SalesService/ })).toBeNull();
  });

  it("selects a symbol to show relations with evidence", () => {
    const onSelectSymbol = vi.fn();
    const { rerender } = render(
      <ArchMapInspector
        file={FILE}
        edges={[IN]}
        onSelectFile={() => {}}
        relations={RELS}
        symbolIndex={INDEX}
        selectedSymbolId={null}
        onSelectSymbol={onSelectSymbol}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /class SalesService/ }));
    expect(onSelectSymbol).toHaveBeenCalledWith("s2");

    rerender(
      <ArchMapInspector
        file={FILE}
        edges={[IN]}
        onSelectFile={() => {}}
        relations={RELS}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={onSelectSymbol}
      />,
    );
    const detail = within(screen.getByLabelText("Symbol SalesService"));
    expect(detail.getByText(/Lines 3–9/)).toBeTruthy();
    expect(detail.getByText(/src\/sales.controller.ts:2 \(constructor\)/)).toBeTruthy();
    expect(detail.getByText(/src\/sales.service.ts:5 \(type\)/)).toBeTruthy();
    expect(detail.getByText(/references · resolved/)).toBeTruthy();
    expect(detail.getByText(/references · unresolved/)).toBeTruthy();
    expect(detail.queryByRole("button", { name: "Open in code" })).toBeNull();
  });

  it("navigates relation targets across files and symbols", () => {
    const onSelectFile = vi.fn();
    const onSelectSymbol = vi.fn();
    render(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={onSelectFile}
        relations={RELS}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={onSelectSymbol}
      />,
    );
    const detail = within(screen.getByLabelText("Symbol SalesService"));
    fireEvent.click(detail.getByRole("button", { name: /class SalesController/ }));
    expect(onSelectFile).toHaveBeenCalledWith("root-1", "src/sales.controller.ts");
    expect(onSelectSymbol).toHaveBeenCalledWith("s9");
    expect(detail.getByText("Repo")).toBeTruthy();
  });

  it("lists members one per row with an honest note", () => {
    render(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={() => {}}
        relations={[]}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
      />,
    );
    const detail = within(screen.getByLabelText("Symbol SalesService"));
    expect(detail.getByRole("button", { name: /Members \(2\)/ })).toBeTruthy();
    expect(detail.getByText("all()")).toBeTruthy();
    expect(detail.getByText("repo : Repo")).toBeTruthy();
    expect(detail.getByText(/no own ranges/)).toBeTruthy();
    expect(detail.queryByRole("button", { name: "open container" })).toBeNull();
  });

  it("reclassifies the symbol layer with an automatic fallback", () => {
    const onSetLayerOverride = vi.fn();
    const node = {
      id: "s2",
      rootId: "root-1",
      rel: "src/sales.service.ts",
      symbol: FILE.symbols[0],
      layer: "services" as const,
      layerReason: "@Injectable decorator",
    };
    const { rerender } = render(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={() => {}}
        relations={[]}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
        node={node}
        nodeLayer={{ layer: "services", reason: "@Injectable decorator", overridden: false }}
        onSetLayerOverride={onSetLayerOverride}
      />,
    );
    const detail = within(screen.getByLabelText("Symbol SalesService"));
    expect(detail.getByText(/@Injectable decorator/)).toBeTruthy();
    const select = detail.getByRole("combobox", { name: "Symbol layer" });
    expect((select as HTMLSelectElement).value).toBe("auto");
    fireEvent.change(select, { target: { value: "state" } });
    expect(onSetLayerOverride).toHaveBeenCalledWith("s2", "state");

    rerender(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={() => {}}
        relations={[]}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
        node={node}
        nodeLayer={{ layer: "state", reason: "manual override", overridden: true }}
        onSetLayerOverride={onSetLayerOverride}
      />,
    );
    const after = within(screen.getByLabelText("Symbol SalesService"));
    expect(after.getByText(/Manual override/)).toBeTruthy();
    expect((after.getByRole("combobox", { name: "Symbol layer" }) as HTMLSelectElement).value).toBe(
      "state",
    );
    fireEvent.change(after.getByRole("combobox", { name: "Symbol layer" }), {
      target: { value: "auto" },
    });
    expect(onSetLayerOverride).toHaveBeenCalledWith("s2", null);
  });

  it("hides the layer section without a symbol card", () => {
    render(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={() => {}}
        relations={[]}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
      />,
    );
    const detail = within(screen.getByLabelText("Symbol SalesService"));
    expect(detail.queryByRole("combobox", { name: "Symbol layer" })).toBeNull();
  });
});

describe("ArchMapInspector module states", () => {
  it("informs when the selection sits outside the module filter", () => {
    const onShowAll = vi.fn();
    render(
      <ArchMapInspector
        file={FILE}
        edges={[IN]}
        onSelectFile={() => {}}
        relations={RELS}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
        outsideModule={{ moduleLabel: "SalesModule", onShowAll }}
      />,
    );
    expect(screen.getByText(/outside the SalesModule module filter/)).toBeTruthy();
    expect(screen.queryByLabelText("Symbol SalesService")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all modules" }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("lists memberships and reference notes on the symbol detail", () => {
    render(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={() => {}}
        relations={[]}
        symbolIndex={INDEX}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
        memberships={["SalesModule (declared module)", "sales (directory group)"]}
        referenceNote="outside SalesModule"
      />,
    );
    const detail = within(screen.getByLabelText("Symbol SalesService"));
    expect(detail.getByText(/Reference card — outside SalesModule/)).toBeTruthy();
    expect(
      detail.getByText("Member of: SalesModule (declared module); sales (directory group)."),
    ).toBeTruthy();
  });
});

describe("member detail", () => {
  it("shows role, written modifiers and unknown returns, never guessed", () => {
    const onSelectMember = vi.fn();
    render(
      <ArchMapInspector
        file={FILE}
        edges={[]}
        onSelectFile={() => {}}
        selectedSymbolId="s2"
        onSelectSymbol={() => {}}
        selectedMember={0}
        onSelectMember={onSelectMember}
      />,
    );
    const detail = within(screen.getByRole("region", { name: "Member all" }));
    expect(detail.getByText("Method")).toBeTruthy();
    expect(detail.getByText("Not written (no modifier in the code)")).toBeTruthy();
    expect(detail.getByText("None written")).toBeTruthy();
    expect(detail.getByText("Unknown (not annotated)")).toBeTruthy();
    fireEvent.click(detail.getByRole("button", { name: "Back to members" }));
    expect(onSelectMember).toHaveBeenCalledWith(null);
    // Members are selectable from the inspector list too.
    fireEvent.click(screen.getByRole("button", { name: "Inspect Property: repo : Repo" }));
    expect(onSelectMember).toHaveBeenCalledWith(1);
  });
});
