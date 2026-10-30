// @vitest-environment jsdom
// Flow inspector: selected member detail (inputs, output, relations, evidence).
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readCodeFile } from "../client";
import { DEFAULT_CODE_EDITOR_PREFS } from "../editorPrefs";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import type { StructureInput } from "../structure/structureTypes";
import { buildFlowGraph } from "./flowModel";
import type { FlowProject, FlowStart } from "./flowModel";
import { FlowInspector, type FlowInspectorProps } from "./FlowInspector";

vi.mock("../client", () => ({
  readCodeFile: vi.fn(async () => {
    throw new Error("no backend");
  }),
}));

afterEach(() => cleanup());

function project(key: string, files: Record<string, string>): FlowProject {
  const inputs: StructureInput[] = Object.entries(files).map(([rel, content]) => ({
    rootId: key,
    rel,
    content,
    hash: `h:${rel}`,
  }));
  return { key, label: key, result: analyzeTsFiles(inputs) };
}

function startAt(project: FlowProject, name: string, member: string | null): FlowStart {
  const symbol = project.result.symbols.find((s) => s.name === name);
  if (symbol === undefined) throw new Error(`missing symbol: ${name}`);
  return { projectKey: project.key, symbolId: symbol.id, member };
}

const FE = project("fe", {
  "s.service.ts": `export class Service {
  private http = inject(HttpClient);
  crear(dto: CreateDto): Promise<Reserva> { return this.http.post('/reservas', dto); }
  bare(input) { return input; }
}`,
});
const GRAPH = buildFlowGraph([FE], startAt(FE, "Service", "crear"));
const NODE = GRAPH.nodes[0].id;

it("shows the selected member with inputs, output, relations and evidence", () => {
  render(<FlowInspector graph={GRAPH} selected={{ nodeId: NODE, member: "crear" }} />);
  expect(screen.getByRole("heading", { name: "Service.crear" })).toBeTruthy();
  expect(screen.getByText("Inputs")).toBeTruthy();
  expect(screen.getByText("CreateDto")).toBeTruthy();
  expect(screen.getByText("Output")).toBeTruthy();
  expect(screen.getByText("Promise<Reserva>")).toBeTruthy();
  expect(screen.getByText("Relations")).toBeTruthy();
  expect(screen.getByText("http → POST /reservas")).toBeTruthy();
  expect(screen.getByText("Evidence")).toBeTruthy();
  expect(screen.getByText("s.service.ts:3")).toBeTruthy();
});

it("marks a missing return type as unknown", () => {
  render(<FlowInspector graph={GRAPH} selected={{ nodeId: NODE, member: "bare" }} />);
  expect(screen.getByText("Unknown (not annotated)")).toBeTruthy();
});

it("asks for a selection when nothing is selected", () => {
  render(<FlowInspector graph={GRAPH} selected={null} />);
  expect(screen.getByText("Select a chain row to inspect it.")).toBeTruthy();
});

const PROJ = project("r", {
  "a.ts": `export class A {\n  run() { return 1; }\n}`,
});
const PGRAPH = buildFlowGraph([PROJ], startAt(PROJ, "A", "run"));
const PNODE = PGRAPH.nodes[0].id;
const PROPOSAL: NonNullable<FlowInspectorProps["proposal"]> = {
  generationId: "gen-1",
  file: {
    pos: 0,
    rootId: "r",
    rel: "a.ts",
    operation: "modify",
    state: "pending",
    decidedAt: null,
    content: `export class A {\n  run() { return 2; }\n}`,
    expectedFingerprint: null,
  },
  staleReason: null,
};

function renderInspector(extra: Partial<FlowInspectorProps> = {}) {
  render(
    <FlowInspector
      graph={PGRAPH}
      selected={{ nodeId: PNODE, member: "run" }}
      prefs={DEFAULT_CODE_EDITOR_PREFS}
      loader={() => Promise.reject(new Error("no monaco"))}
      {...extra}
    />,
  );
}

it("shows Accept and Discard only for a proposed file", () => {
  renderInspector({ proposal: PROPOSAL });
  expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  cleanup();
  renderInspector({ proposal: null });
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
});

it("shows the code diff for a proposed member", async () => {
  renderInspector({ proposal: PROPOSAL });
  fireEvent.click(screen.getByRole("button", { name: "View code" }));
  expect(await screen.findByLabelText("Proposed code")).toBeTruthy();
});

it("opens real code at the member line", () => {
  const onOpenCode = vi.fn();
  renderInspector({ proposal: null, onOpenCode });
  fireEvent.click(screen.getByRole("button", { name: "Open in code" }));
  expect(onOpenCode).toHaveBeenCalledWith("r", "a.ts", 2);
});

it("blocks Accept on a stale proposal and says why", () => {
  renderInspector({ proposal: { ...PROPOSAL, staleReason: "the context changed." } });
  expect(screen.getByRole("button", { name: "Accept" })).toHaveProperty("disabled", true);
  expect(screen.getByText(/the context changed/)).toBeTruthy();
});

it("reads the current file to compare against the proposal", async () => {
  vi.mocked(readCodeFile).mockResolvedValueOnce({
    text: `export class A {\n  run() { return 1; }\n}`,
    fingerprint: "h",
    size: 10,
  });
  renderInspector({ proposal: PROPOSAL });
  fireEvent.click(screen.getByRole("button", { name: "View code" }));
  expect(await screen.findByText(/return 1;/)).toBeTruthy();
  expect(screen.getByText(/return 2;/)).toBeTruthy();
});

it("names signal writes and pending links of a member", () => {
  const front = project("f", {
    "s.ts": `export class S {
  readonly n = signal(0);
  private x = inject(Fantasma);
  run() { this.n.set(1); this.x.go(); }
}`,
  });
  const graph = buildFlowGraph([front], startAt(front, "S", "run"));
  render(<FlowInspector graph={graph} selected={{ nodeId: graph.nodes[0].id, member: "run" }} />);
  expect(screen.getByText("writes n")).toBeTruthy();
  expect(screen.getByText("Fantasma")).toBeTruthy();
  expect(screen.getByText("Unresolved:")).toBeTruthy();
});

it("lists pending links before anything is selected", () => {
  const front = project("f", { "s.ts": `export class S {
  private x = inject(Fantasma);
  run() { this.x.go(); }
}` });
  const graph = buildFlowGraph([front], startAt(front, "S", "run"));
  render(<FlowInspector graph={graph} selected={null} />);
  expect(screen.getByText("Fantasma")).toBeTruthy();
});

it("hides Open in code for code that is only proposed", () => {
  const graph = {
    ...GRAPH,
    nodes: GRAPH.nodes.map((node) => ({ ...node, change: "modified" as const })),
  };
  render(
    <FlowInspector
      graph={graph}
      selected={{ nodeId: graph.nodes[0].id, member: "crear" }}
      onOpenCode={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: "Open in code" })).toBeNull();
});

it("shows why an accept failed", () => {
  render(
    <FlowInspector
      graph={GRAPH}
      selected={{ nodeId: GRAPH.nodes[0].id, member: "crear" }}
      decisionError="The scope changed; generate a new proposal."
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("The scope changed");
});

