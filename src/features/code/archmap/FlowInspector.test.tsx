// @vitest-environment jsdom
// Flow inspector: selected member detail (inputs, output, relations, evidence).
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import type { StructureInput } from "../structure/structureTypes";
import { buildFlowGraph } from "./flowModel";
import type { FlowProject, FlowStart } from "./flowModel";
import { FlowInspector } from "./FlowInspector";

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

