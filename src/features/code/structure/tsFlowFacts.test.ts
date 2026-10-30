// Flow facts: injections, member calls and signal accesses per
// class. Tests read `symbols[0].flow` through `analyzeTsFiles`.
import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";
import type { StructureInput, SymbolFlowFacts } from "./structureTypes";

function input(content: string): StructureInput {
  return { rootId: "root-1", rel: "f.ts", content, hash: "h:f.ts" };
}

function analyze(content: string) {
  return analyzeTsFiles([input(content)]);
}

function flowOf(content: string): SymbolFlowFacts {
  return analyze(content).symbols[0].flow!;
}

describe("collectFlowFacts", () => {
  it("reads inject fields and constructor injections", () => {
    const flow = flowOf(`export class A {
  private readonly store = inject(SesionStore);
  constructor(private readonly svc: SalesService, plain: number) {}
}`);
    expect(flow.injections.map((i) => [i.field, i.typeName, i.via])).toEqual([
      ["store", "SesionStore", "inject"],
      ["svc", "SalesService", "constructor"],
    ]);
  });

  it("lists member calls in source order", () => {
    const flow = flowOf(`export class A {
  private store = inject(S);
  run() { this.store.first(); this.local(); this.store.second(); }
  local() {}
}`);
    expect(flow.calls.map((c) => [c.member, c.receiver, c.method, c.order])).toEqual([
      ["run", "store", "first", 0],
      ["run", null, "local", 1],
      ["run", "store", "second", 2],
    ]);
  });

  it("treats signals as reads and writes", () => {
    const flow = flowOf(`export class A {
  readonly #user = signal<string | null>(null);
  readonly name = signal("");
  set(v: string) { this.#user.set(v); this.name.update((x) => x + v); }
  get() { return this.#user(); }
}`);
    expect(flow.signals.map((s) => [s.member, s.signal, s.access])).toEqual([
      ["set", "#user", "write"],
      ["set", "name", "write"],
      ["get", "#user", "read"],
    ]);
    expect(flow.calls).toEqual([]);
  });

  it("records dynamic calls as unresolved", () => {
    const flow = flowOf(`export class A {
  private s = inject(S);
  run(k: string) { this.s[k](); }
}`);
    expect(flow.calls).toEqual([]);
    expect(flow.unresolved).toHaveLength(1);
  });

  it("keeps facts of methods beyond the member cap", () => {
    const methods = Array.from({ length: 60 }, (_, i) => `m${i}() {}`).join("\n");
    const flow = flowOf(`export class A {
  private s = inject(S);
  ${methods}
  last() { this.s.run(); }
}`);
    expect(flow.calls.map((c) => c.member)).toEqual(["last"]);
  });

  it("extracts what it can from a file with syntax errors", () => {
    const result = analyze(`export class A {
  private s = inject(S);
  run() { this.s.go(); }
  broken( {
}`);
    expect(result.files[0].status).toBe("partial");
    expect(result.symbols[0].flow?.injections).toHaveLength(1);
  });

  it("leaves ordinary calls out of unresolved", () => {
    const flow = flowOf(`export class A extends B {
  readonly #u = signal(0);
  readonly name = this.#u.asReadonly();
  run(list: number[]) {
    console.log(1);
    list.map((x) => x).filter(Boolean);
    helper();
    super.run();
    this.#u.asReadonly();
  }
}`);
    expect(flow.unresolved).toEqual([]);
  });

  it("walks arrow-function fields, computed and effect initializers", () => {
    const flow = flowOf(`export class A {
  private s = inject(S);
  readonly #u = signal(0);
  readonly doble = computed(() => this.#u() * 2);
  readonly log = effect(() => { this.s.track(); });
  guardar = () => { this.s.run(); };
  cerrar = function (this: A) { this.s.stop(); };
  plain = compute(this.#u());
}`);
    expect(flow.signals.map((x) => [x.member, x.signal, x.access])).toEqual([
      ["doble", "#u", "read"],
    ]);
    expect(flow.calls.map((c) => [c.member, c.receiver, c.method])).toEqual([
      ["log", "s", "track"],
      ["guardar", "s", "run"],
      ["cerrar", "s", "stop"],
    ]);
  });

  it("resolves provable literal keys", () => {
    const flow = flowOf(`export class A {
  private s = inject(S);
  run() { this.s["go"](); this["local"](); }
}`);
    expect(flow.calls.map((c) => [c.receiver, c.method])).toEqual([
      ["s", "go"],
      [null, "local"],
    ]);
    expect(flow.unresolved).toEqual([]);
  });

  const service = (body: string) => `export class S {
  private http = inject(HttpClient);
  private apiUrl = environment.urlAcme + 'carga';
  private plain = '/items';
  run(id: string) { ${body} }
}`;

  it.each([
    ["return this.http.get<Item[]>(this.apiUrl);", "GET", { base: "urlAcme", path: "carga" }, "Item[]"],
    ["return this.http.post<Item>(`${this.apiUrl}/bulk`, id);", "POST", { base: "urlAcme", path: "carga/bulk" }, "Item"],
    ["return this.http.get(this.apiUrl + '/x');", "GET", { base: "urlAcme", path: "carga/x" }, null],
    ["return this.http.delete(`${this.apiUrl}/${id}`);", "DELETE", { base: "urlAcme", path: "carga/${...}" }, null],
    ["return this.http.get(this.plain);", "GET", { base: null, path: "/items" }, null],
    ["return this.http.get('/x');", "GET", { base: null, path: "/x" }, null],
  ])("reconstructs %s", (body, verb, url, returnType) => {
    const [call] = flowOf(service(body)).httpCalls;
    expect(call).toMatchObject({ member: "run", verb, url, returnType });
  });

  it("keeps the verb when the URL is not provable", () => {
    const [call] = flowOf(service("return this.http.get(makeUrl(id));")).httpCalls;
    expect(call.verb).toBe("GET");
    expect(call.url).toBeNull();
  });

  it("does not list HttpClient calls as member calls", () => {
    expect(flowOf(service("return this.http.get('/x');")).calls).toEqual([]);
  });

  it("never invents a verb from a non-verb HttpClient method", () => {
    const flow = flowOf(`export class S {
  private http = inject(HttpClient);
  run() { return this.http.request('POST', '/x'); }
}`);
    expect(flow.httpCalls).toEqual([]);
    expect(flow.calls).toEqual([]);
    expect(flow.unresolved).toHaveLength(1);
  });

  it("numbers member calls without gaps around signals and HTTP", () => {
    const flow = flowOf(`export class S {
  private http = inject(HttpClient);
  private s = inject(T);
  readonly n = signal(0);
  run() {
    this.n.set(1);
    this.s.first();
    this.http.get('/x');
    this.n();
    this.s.second();
  }
}`);
    expect(flow.calls.map((c) => [c.method, c.order])).toEqual([
      ["first", 0],
      ["second", 1],
    ]);
  });
});
