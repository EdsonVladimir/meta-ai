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
});
