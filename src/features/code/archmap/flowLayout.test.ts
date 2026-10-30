// Flow board layout: columns by first appearance, row anchors, card growth.
import { expect, it } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { combineResults } from "../structure/structureMerge";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import type { StructureInput } from "../structure/structureTypes";
import {
  ARCH_CARD_PAD_Y,
  ARCH_HEAD_ROW_H,
  ARCH_MEM_ROW_H,
  ARCH_META_ROW_H,
  ARCH_SUB_ROW_H,
} from "./boardLayout";
import { buildFlowGraph } from "./flowModel";
import type { FlowGraph, FlowProject, FlowStart } from "./flowModel";
import { layoutFlowBoard } from "./flowLayout";

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

function withExtraMember(graph: FlowGraph): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) =>
      index === 0 ? { ...node, members: [...node.members, "extra"] } : node,
    ),
  };
}

it("orders columns by first appearance along the chain", () => {
  const layout = layoutFlowBoard(CHAIN);
  expect(layout.columns.map((c) => c.label)).toEqual([
    "fe · UI Components", "fe · Services", "HTTP", "be · Controllers", "be · Services", "be · Data Contracts",
  ]);
});

it("places a row anchor inside its card", () => {
  const layout = layoutFlowBoard(CHAIN);
  const card = layout.cards.get(CHAIN.nodes[0].id)!;
  const y = layout.rowY.get(`${CHAIN.nodes[0].id}::guardar`)!;
  expect(y).toBeGreaterThan(card.y);
  expect(y).toBeLessThan(card.y + card.h);
});

it("grows cards with their chain members", () => {
  const one = layoutFlowBoard(CHAIN).cards.get(CHAIN.nodes[0].id)!.h;
  const two = layoutFlowBoard(withExtraMember(CHAIN)).cards.get(CHAIN.nodes[0].id)!.h;
  expect(two - one).toBe(ARCH_MEM_ROW_H);
});

it("anchors a row at the center of its visible box", () => {
  const layout = layoutFlowBoard(CHAIN);
  const card = layout.cards.get(CHAIN.nodes[0].id)!;
  const top = card.y + 1 + ARCH_CARD_PAD_Y + ARCH_HEAD_ROW_H + ARCH_SUB_ROW_H + ARCH_META_ROW_H;
  expect(layout.rowY.get(`${CHAIN.nodes[0].id}::guardar`)).toBe(top + 6 + 14);
});
