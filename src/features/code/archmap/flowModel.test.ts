// Flow graph: chains across projects, same-project resolution,
// cycles and caps.
import { expect, it } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { combineResults } from "../structure/structureMerge";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import type { StructureInput } from "../structure/structureTypes";
import { buildFlowGraph, FLOW_MAX_NODES } from "./flowModel";
import type { FlowProject, FlowStart } from "./flowModel";

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

it("follows a chain across projects to the entity", () => {
  const graph = buildFlowGraph([FE, BE], startAt(FE, "AComponent", "guardar"));
  expect(graph.nodes.map((n) => n.symbol.name)).toEqual([
    "AComponent", "ASvc", "CCtrl", "CSvc", "Carga",
  ]);
  expect(graph.httpNodes[0]).toMatchObject({ verb: "POST", url: "{urlApi}cargas", via: "client" });
  expect(graph.pending).toEqual([]);
});

it("keeps only the started member when one is given", () => {
  const graph = buildFlowGraph([FE, BE], startAt(FE, "AComponent", "guardar"));
  expect(graph.nodes[0].members).toEqual(["guardar"]);
});

it("starts from every method when no member is given", () => {
  const graph = buildFlowGraph([FE, BE], startAt(FE, "AComponent", null));
  expect(graph.nodes[0].members).toEqual(["guardar", "otro"]);
});

it("resolves same-named classes inside the caller's project", () => {
  const gw = project("gw", { "s.ts": `export class Dup { run() {} }`,
    "c.ts": `export class C { private d = inject(Dup); go() { this.d.run(); } }` });
  const be = project("be2", { "s.ts": `export class Dup { run() {} }` });
  const graph = buildFlowGraph([gw, be], startAt(gw, "C", "go"));
  expect(graph.nodes.map((n) => n.projectKey)).toEqual(["gw", "gw"]);
  expect(graph.pending).toEqual([]);
});

it("marks ambiguous names inside one project", () => {
  const dup = project("p", { "a.ts": `export class Dup { run() {} }`,
    "b.ts": `export class Dup { run() {} }`,
    "c.ts": `export class C { private d = inject(Dup); go() { this.d.run(); } }` });
  const graph = buildFlowGraph([dup], startAt(dup, "C", "go"));
  expect(graph.pending[0]).toMatchObject({ kind: "ambiguous", label: "Dup" });
});

it("reports HTTP calls with no route as no destination", () => {
  const graph = buildFlowGraph([FE], startAt(FE, "AComponent", "guardar"));
  expect(graph.pending.map((p) => p.kind)).toEqual(["no-destination"]);
});

it("cuts cycles and marks them", () => {
  const cyc = project("p", { "a.ts": `export class A {
  a() { this.b(); }
  b() { this.a(); }
}` });
  const graph = buildFlowGraph([cyc], startAt(cyc, "A", "a"));
  expect(graph.nodes[0].members).toEqual(["a", "b"]);
  expect(graph.pending.map((p) => p.kind)).toEqual(["cycle"]);
});

it("stops at the node cap and says so", () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 70; i += 1) {
    files[`s${i}.ts`] = `export class S${i} { private n = inject(S${i + 1}); go() { this.n.go(); } }`;
  }
  files["s70.ts"] = `export class S70 { go() {} }`;
  const big = project("p", files);
  const graph = buildFlowGraph([big], startAt(big, "S0", "go"));
  expect(graph.nodes.length).toBeLessThanOrEqual(FLOW_MAX_NODES);
  expect(graph.truncated).toBe(true);
});

it("lists HTTP client interceptors on the HTTP node", () => {
  const fe = project("fe", {
    "a.component.ts": `export class AComponent {
  private svc = inject(ASvc);
  guardar() { this.svc.crear(); }
}`,
    "a.service.ts": `export class ASvc {
  private http = inject(HttpClient);
  private url = environment.urlApi + 'cargas';
  crear() { return this.http.post(this.url, {}); }
}`,
    "main.ts": `bootstrapApplication(App, { providers: [
  provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
] });`,
  });
  const graph = buildFlowGraph([fe, BE], startAt(fe, "AComponent", "guardar"));
  expect(graph.httpNodes[0].interceptors).toEqual(["authInterceptor", "errorInterceptor"]);
});

it("does not call a second use of a helper a cycle", () => {
  const p = project("p", { "a.ts": `export class A {
  run() { this.load(); this.reload(); }
  reload() { this.load(); }
  load() {}
}` });
  const graph = buildFlowGraph([p], startAt(p, "A", "run"));
  expect(graph.pending).toEqual([]);
  expect(graph.edges.filter((e) => e.toMember === "load")).toHaveLength(2);
});

it("starts from arrow-function fields too", () => {
  const p = project("p", { "a.ts": `export class A {
  private s = inject(S);
  guardar = () => { this.s.run(); };
}`, "s.ts": `export class S { run() {} }` });
  const graph = buildFlowGraph([p], startAt(p, "A", null));
  expect(graph.nodes[0].members).toEqual(["guardar"]);
  expect(graph.nodes.map((n) => n.symbol.name)).toEqual(["A", "S"]);
});

it("numbers a member's steps in source order across calls and HTTP", () => {
  const p = project("p", { "a.ts": `export class A {
  private http = inject(HttpClient);
  private s = inject(S);
  run() {
    this.http.get('/x');
    this.s.go();
  }
}`, "s.ts": `export class S { go() {} }` });
  const graph = buildFlowGraph([p], startAt(p, "A", "run"));
  const steps = [...graph.edges].sort((a, b) => a.order - b.order);
  expect(steps.map((e) => [e.kind, e.order])).toEqual([
    ["http", 0],
    ["call", 1],
  ]);
});

it("flags a dependency that does not exist, even when the file imports packages", () => {
  const p = project("p", { "a.ts": `import { inject } from "@angular/core";
import { Fantasma } from "./fantasma.service";
export class A {
  private f = inject(Fantasma);
  run() { this.f.go(); }
}` });
  const graph = buildFlowGraph([p], startAt(p, "A", "run"));
  expect(graph.pending).toEqual([
    expect.objectContaining({ kind: "unresolved", label: "Fantasma" }),
  ]);
});

it("stays quiet about types imported from packages", () => {
  const p = project("p", { "a.ts": `import { Router } from "@angular/router";
export class A {
  private r = inject(Router);
  run() { this.r.navigate([]); }
}` });
  expect(buildFlowGraph([p], startAt(p, "A", "run")).pending).toEqual([]);
});

