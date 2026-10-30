// @vitest-environment jsdom
// Symbol-board acceptance: one card per class/interface/free
// function, every member shown, per-symbol layers, same names kept
// distinct, 20+ files with batch continuation, modifiers, syntax
// errors and unresolved refs. Extracted quantities (direct analyzer
// call) are checked against rendered quantities. All IO injected;
// no Tauri, no network.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectMapView, type ProjectMapDeps } from "./ProjectMapView";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { fnv1aHex } from "../model";
import { useRequirementsUi } from "../../requirements/uiStore";
import type { StructureInput } from "../structure/structureTypes";
import type { CodeListingDto, CodeRootDto } from "../types";

afterEach(() => cleanup());

beforeEach(() => {
  localStorage.clear();
  useRequirementsUi.setState({
    archInspectorWidth: null,
    archInspectorCollapsed: false,
    layerOverrides: {},
  });
});

const MIXED = `import { Injectable } from "@nestjs/common";
@Injectable()
export class AlphaService {
  run(): number { return 1; }
}
export class BetaComponent {
  title = "beta";
}
export interface GammaDto {
  id: number;
}
export function freeHelper(x: number): number {
  return x + 1;
}
`;

const BIG_METHODS = [
  "public m00sync(): void {}",
  "private m01hidden(): void {}",
  "static m02build(): BigLedger { return new BigLedger(null); }",
  "async m03fetch(): Promise<void> {}",
  "private static m04cache(): void {}",
  "public async m05load(): Promise<void> {}",
];
for (let i = 6; i < 22; i += 1) {
  BIG_METHODS.push(`m${String(i).padStart(2, "0")}plain(): void {}`);
}
const BIG = `export class BigLedger {
  constructor(private readonly repo: unknown) {}
  ${BIG_METHODS.join("\n  ")}
}
`;

const DUP_A = `export class Dup {
  ping(): string { return "a"; }
}
`;
const DUP_B = `export class Dup {
  pong(): string { return "b"; }
}
`;

const BROKEN = `export class Broken { oops( { !!! not valid ts (((
`;

const USES_MISSING = `export class UsesMissing {
  make(): unknown { return new MissingThing(); }
}
`;

// Batch 1 holds the first 20 entries; batch 2 continues with 6.
const FILES: Array<{ rel: string; text: string }> = [
  { rel: "src/mixed.ts", text: MIXED },
  { rel: "src/big.ts", text: BIG },
  { rel: "src/dup-a.ts", text: DUP_A },
  { rel: "src/dup-b.ts", text: DUP_B },
  ...Array.from({ length: 20 }, (_, i) => {
    const n = String(i).padStart(2, "0");
    return {
      rel: `src/mod-${n}.ts`,
      text: `export class Mod${n} {\n  noop(): void {}\n}\n`,
    };
  }),
  // NOTE: mods 16-19 land in batch 2 on purpose (see below).
  { rel: "src/broken.ts", text: BROKEN },
  { rel: "src/uses-missing.ts", text: USES_MISSING },
];

const ROOTS: CodeRootDto[] = [
  { id: "acc", path: "/repo/acc", name: "acceptance", missing: false, projectId: "p1" },
];

function listing(): CodeListingDto {
  return {
    entries: FILES.map((file) => ({
      name: file.rel.split("/").pop() ?? file.rel,
      rel: file.rel,
      kind: "file" as const,
      size: file.text.length,
    })),
    truncated: false,
  };
}

function makeDeps(): ProjectMapDeps {
  const byRel = new Map(FILES.map((file) => [file.rel, file.text]));
  return {
    listDir: async () => listing(),
    readFile: async (_rootId, rel) => {
      const text = byRel.get(rel);
      if (text === undefined) throw { kind: "code_not_found", message: "missing" };
      return { text, fingerprint: "h", size: text.length };
    },
    analyzeTs: (files) => Promise.resolve(analyzeTsFiles(files)),
  };
}

function renderBoard() {
  const utils = render(
    <ProjectMapView
      projectId="p1"
      roots={ROOTS}
      hidden={{}}
      onToggleRoot={() => {}}
      tabs={[]}
      deps={makeDeps()}
      groupBy="symbols"
      scope={{ kind: "all" }}
      onScopeChange={() => {}}
      hiddenProjects={{}}
      onShowAllProjects={() => {}}
    />,
  );
  return utils;
}

function inputs(): StructureInput[] {
  return FILES.map((file) => ({
    rootId: "acc",
    rel: file.rel,
    content: file.text,
    hash: fnv1aHex(file.text),
  }));
}

/**
 * Independent extraction: the real analyzer over the same inputs,
 * batched like the view does (20 files per call), merged without
 * any React code. Rendered cards must match these symbols exactly.
 */
function extractedSymbols(): number {
  const all = inputs();
  const first = analyzeTsFiles(all.slice(0, 20));
  const second = analyzeTsFiles(all.slice(20));
  const ids = new Set([
    ...first.symbols.map((symbol) => symbol.id),
    ...second.symbols.map((symbol) => symbol.id),
  ]);
  return ids.size;
}

function cardColumn(cardButton: HTMLElement): Element | null {
  return cardButton.closest(".archboard-col");
}

/** The footer status bar: scope and coverage. */
function statusBar(): HTMLElement {
  return screen.getByLabelText("Analysis status");
}

/** Waits for the automatic batches to cover every file. */
async function analyzeRest(): Promise<void> {
  await waitFor(() => expect(statusBar().textContent).toMatch(/26\/26 files analyzed/));
}

/** Matches a member row by its tooltip ("Role: label"), whatever the role. */
function memberTitle(label: string): (title: string) => boolean {
  return (title) => title.split("\n")[0].endsWith(`: ${label}`);
}

describe("symbol board acceptance", () => {
  it("draws one card per symbol, each in its own layer", async () => {
    const { container } = renderBoard();
    const section = await screen.findByLabelText(/Diagram of /);
    await analyzeRest();
    const alpha = await within(section).findByRole("button", {
      name: "AlphaService, class, 1 member",
    });
    const beta = within(section).getByRole("button", { name: "BetaComponent, class, 1 member" });
    const gamma = within(section).getByRole("button", {
      name: "GammaDto, interface, 1 member",
    });
    const free = within(section).getByRole("button", { name: "freeHelper, function, 0 members" });
    // One file, four cards, four different layers.
    const columns = new Set(
      [alpha, beta, gamma, free].map((card) => cardColumn(card)),
    );
    expect(columns.size).toBe(4);
    // Extracted symbols equal rendered cards (nothing dropped, nothing doubled).
    const cards = container.querySelectorAll(".archboard-card");
    expect(cards.length).toBe(extractedSymbols());
  });

  it("shows every member of a large class with its modifiers", async () => {
    renderBoard();
    const section = await screen.findByLabelText(/Diagram of /);
    const big = await within(section).findByRole("button", {
      name: "BigLedger, class, 24 members",
    });
    const card = big.closest(".archboard-card");
    expect(card).not.toBeNull();
    const view = within(card as HTMLElement);
    // One row per member, with its role named in the tooltip.
    expect(view.getByTitle("Constructor: constructor(private readonly repo: unknown)")).toBeTruthy();
    expect(view.getByTitle(memberTitle("private readonly repo : unknown"))).toBeTruthy();
    expect(view.getByTitle(memberTitle("public m00sync(): void"))).toBeTruthy();
    expect(view.getByTitle(memberTitle("private m01hidden(): void"))).toBeTruthy();
    expect(view.getByTitle(memberTitle("static m02build(): BigLedger"))).toBeTruthy();
    expect(view.getByTitle(memberTitle("async m03fetch(): Promise<void>"))).toBeTruthy();
    expect(view.getByTitle(memberTitle("private static m04cache(): void"))).toBeTruthy();
    expect(view.getByTitle(memberTitle("public async m05load(): Promise<void>"))).toBeTruthy();
    expect(view.getAllByTitle(/m\d\dplain\(\): void/).length).toBe(16);
    // Collapse/expand keeps every member reachable, never silently cut.
    fireEvent.click(view.getByRole("button", { name: "Hide 24 members" }));
    expect(view.queryByTitle(memberTitle("public m00sync(): void"))).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show 24 members" }));
    expect(view.getByTitle(memberTitle("public m00sync(): void"))).toBeTruthy();
  });

  it("keeps same-named symbols in different files distinct", async () => {
    renderBoard();
    const section = await screen.findByLabelText(/Diagram of /);
    const dups = await within(section).findAllByRole("button", { name: "Dup, class, 1 member" });
    expect(dups).toHaveLength(2);
    fireEvent.click(dups[0]);
    const inspector = screen.getByLabelText("Board inspector");
    expect(await within(inspector).findByText("ping(): string")).toBeTruthy();
    expect(within(inspector).queryByText("pong(): string")).toBeNull();
    fireEvent.click(dups[1]);
    expect(await within(inspector).findByText("pong(): string")).toBeTruthy();
    expect(within(inspector).queryByText("ping(): string")).toBeNull();
  });

  it("analyzes past the 20-file batch on its own", async () => {
    const { container } = renderBoard();
    await screen.findByLabelText(/Diagram of /);
    await analyzeRest();
    expect(statusBar().textContent).not.toMatch(/pending/);
    expect(container.querySelectorAll(".archboard-card").length).toBe(extractedSymbols());
  });

  it("tolerates syntax errors and lists unresolved references honestly", async () => {
    renderBoard();
    const section = await screen.findByLabelText(/Diagram of /);
    await analyzeRest();
    // The broken file never fails the batch or shows an error banner.
    expect(within(section).queryByRole("alert")).toBeNull();
    const uses = within(section).getByRole("button", { name: "UsesMissing, class, 1 member" });
    const card = uses.closest(".archboard-card");
    expect(within(card as HTMLElement).getByText("1 unresolved")).toBeTruthy();
    fireEvent.click(uses);
    const inspector = screen.getByLabelText("Board inspector");
    const detail = within(await within(inspector).findByLabelText("Symbol UsesMissing"));
    // Listed once as unresolved and once as the outgoing-relation target.
    expect(detail.getAllByText("MissingThing")).toHaveLength(2);
    expect(detail.getAllByText(/instantiates · unresolved/)).toHaveLength(2);
  });

  it("reclassifies a symbol from the inspector and moves its card", async () => {
    renderBoard();
    const section = await screen.findByLabelText(/Diagram of /);
    const alpha = await within(section).findByRole("button", {
      name: "AlphaService, class, 1 member",
    });
    expect(cardColumn(alpha)?.querySelector(".archboard-col-title")?.textContent).toMatch(
      /Services/,
    );
    fireEvent.click(alpha);
    const inspector = screen.getByLabelText("Board inspector");
    const select = (await within(inspector).findByRole("combobox", {
      name: "Symbol layer",
    })) as HTMLSelectElement;
    expect(select.value).toBe("auto");
    fireEvent.change(select, { target: { value: "state" } });
    const moved = await within(section).findByRole("button", {
      name: "AlphaService, class, 1 member",
    });
    expect(cardColumn(moved)?.querySelector(".archboard-col-title")?.textContent).toMatch(/State/);
    fireEvent.change(
      within(inspector).getByRole("combobox", { name: "Symbol layer" }),
      { target: { value: "auto" } },
    );
    const back = await within(section).findByRole("button", {
      name: "AlphaService, class, 1 member",
    });
    expect(cardColumn(back)?.querySelector(".archboard-col-title")?.textContent).toMatch(/Services/);
  });
});
