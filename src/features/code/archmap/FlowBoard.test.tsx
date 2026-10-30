// @vitest-environment jsdom
// Flow board: chain-only rows, ordered edges, pending boxes, row selection.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { combineResults } from "../structure/structureMerge";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import type { StructureInput } from "../structure/structureTypes";
import { FlowBoard } from "./FlowBoard";
import { layoutFlowBoard } from "./flowLayout";
import { buildFlowGraph } from "./flowModel";
import type { FlowGraph, FlowProject, FlowStart } from "./flowModel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function project(key: string, files: Record<string, string>): FlowProject {
  const inputs: StructureInput[] = Object.entries(files).map(([rel, content]) => ({
    rootId: key,
    rel,
    content,
    hash: `h:${rel}`,
  }));
  const parts = [];
  for (let i = 0; i < inputs.length; i += STRUCTURE_LIMITS.maxFiles) {
    parts.push(analyzeTsFiles(inputs.slice(i, i + STRUCTURE_LIMITS.maxFiles)));
  }
  return { key, label: key, result: combineResults(parts) };
}

function startAt(project: FlowProject, name: string, member: string | null): FlowStart {
  const symbol = project.result.symbols.find((s) => s.name === name);
  if (symbol === undefined) throw new Error(`missing symbol: ${name}`);
  return { projectKey: project.key, symbolId: symbol.id, member };
}

const FE = project("fe", {
  "a.component.ts": `export class AComponent {
  private svc = inject(ASvc);
  guardar() { this.svc.crear(); }
  otro() {}
}`,
  "a.service.ts": `export class ASvc {
  private http = inject(HttpClient);
  private url = environment.urlApi + 'cargas';
  crear() { return this.http.post(this.url, {}); }
}`,
});
const BE = project("be", {
  "c.controller.ts": `@Controller('cargas') export class CCtrl {
  constructor(private svc: CSvc) {}
  @Post() crear(@Body() d: D) { return this.svc.crear(d); }
}`,
  "c.service.ts": `export class CSvc {
  constructor(@InjectRepository(Carga) private repo: Repository<Carga>) {}
  crear(d: D) { return this.repo.save(d); }
}`,
  "c.entity.ts": `@Entity() export class Carga { id: number; }`,
});
const CHAIN = buildFlowGraph([FE, BE], startAt(FE, "AComponent", "guardar"));
const WITH_PENDING = buildFlowGraph([FE], startAt(FE, "AComponent", "guardar"));

function Board({
  graph,
  onSelect,
}: {
  graph: FlowGraph;
  onSelect?: (selection: { nodeId: string; member: string | null } | null) => void;
}) {
  return (
    <FlowBoard
      graph={graph}
      layout={layoutFlowBoard(graph)}
      selected={null}
      onSelect={onSelect ?? (() => {})}
    />
  );
}

it("shows only chain members and collapses the rest", () => {
  render(<Board graph={CHAIN} />);
  expect(screen.getByTitle(/^Method: guardar/)).toBeTruthy();
  expect(screen.queryByTitle(/^Method: otro/)).toBeNull();
  expect(screen.getByText("+1 method")).toBeTruthy();
});

it("draws edges with their call order", () => {
  const { container } = render(<Board graph={CHAIN} />);
  expect(container.querySelectorAll(".flow-edge").length).toBe(CHAIN.edges.length);
  expect(screen.getAllByText("1").length).toBeGreaterThan(0);
});

it("shows pending items as no-destination boxes with dashed links", () => {
  const { container } = render(<Board graph={WITH_PENDING} />);
  expect(screen.getByText("No destination")).toBeTruthy();
  expect(container.querySelector(".flow-edge.pending")).not.toBeNull();
});

it("selects a member row", () => {
  const onSelect = vi.fn();
  render(<Board graph={CHAIN} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /^Method: guardar/ }));
  expect(onSelect).toHaveBeenCalledWith({ nodeId: CHAIN.nodes[0].id, member: "guardar" });
});

function markModified(graph: FlowGraph): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) =>
      index === 0
        ? { ...node, change: "modified", memberChanges: { guardar: "modified" } }
        : node,
    ),
  };
}

it("draws proposed changes with a label, not only a color", () => {
  const { container } = render(<Board graph={markModified(CHAIN)} />);
  const card = container.querySelector(".archboard-card.proposed")!;
  expect(within(card as HTMLElement).getByText("Muse")).toBeTruthy();
  expect(within(card as HTMLElement).getAllByText("M").length).toBeGreaterThan(0);
});

it("names what the repository does to an entity", () => {
  const be = project("be3", {
    "s.ts": `export class S {
  constructor(@InjectRepository(Carga) private repo: Repository<Carga>) {}
  go(d: D) { const c = this.repo.create(d); return this.repo.save(c); }
}`,
    "c.ts": `@Entity() export class Carga { id: number; }`,
  });
  render(<Board graph={buildFlowGraph([be], startAt(be, "S", "go"))} />);
  expect(screen.getByText("repository: create, save")).toBeTruthy();
});

it("points every edge with an arrow", () => {
  const { container } = render(<Board graph={CHAIN} />);
  const edges = Array.from(container.querySelectorAll(".flow-edge"));
  expect(edges.every((edge) => edge.getAttribute("marker-end") === "url(#flow-arrow)")).toBe(true);
});

it("marks changed member rows, not only the card", () => {
  const node = CHAIN.nodes[0];
  const graph = {
    ...CHAIN,
    nodes: [{ ...node, change: "modified" as const, memberChanges: { guardar: "modified" as const } }, ...CHAIN.nodes.slice(1)],
  };
  render(<Board graph={graph} />);
  const row = screen.getByRole("button", { name: /^Method: guardar/ });
  expect(within(row).getByText("M")).toBeTruthy();
});

