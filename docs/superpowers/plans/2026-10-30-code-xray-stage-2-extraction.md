# Code X-ray Stage 2: Extraction Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. External agents (Muse, Codex, OpenCode) use the prompt in "Worker prompt" below instead.

**Goal:** Extract per-file execution, HTTP, pipeline and composition facts from TypeScript, Angular and NestJS code, and show them in the inspector.

**Architecture:** New pure extractors feed optional fields on the existing `StructureResult`. Extractors never resolve across files; Stages 3 and 4 do that. HTML templates are read after analysis by an injected-IO step, and the inspector exposes the facts for validation on real code.

**Tech Stack:** TypeScript, the `ts-compiler` alias of the TypeScript compiler API, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-code-xray-design.md` (sections 2, 3, 4, 8, 9).

## Global Constraints

- All new fields are optional; results and snapshots without them keep working.
- Every fact carries evidence built with the existing `evidenceOf` (`file:line (construct)`).
- Extractors stay pure: no Tauri, no file IO, no cross-file resolution.
- No new npm dependency.
- Anything unprovable is recorded as unresolved, never guessed.
- English only in code, comments, tests and docs.
- No network in tests. Do not read files outside this repository.
- Do not touch Rust: snapshots store `result` as raw JSON, so no Rust change is needed.
- Do not commit or push unless the task prompt says so.
- Done means `npm test` and `npx tsc --noEmit` pass.

## Review Focus

1. A `get` on something that is not `HttpClient` (`map.get('/x')`, an Express `app.get('/x')`): it must stay an endpoint and never become an HTTP call. Pinned in Task 3.
2. Classes over the 50-member cap: facts of methods beyond the cap are kept, because the chain must not silently break. Pinned in Task 2.
3. Overloads and duplicate method names: facts attach by name, without crashing or duplicating ranges. Pinned in Task 1.
4. Files with syntax errors: partial facts, and the batch never fails. Pinned in Task 2.
5. Template text that looks like a tag (comments, strings in attributes): no false children. Pinned in Task 6.

---

## Worker prompt

Give each agent one task at a time:

```text
You are implementing one task of an approved plan in the Ruth IDE repository.
Read, in order: AGENTS.md, CLAUDE.md, then
docs/superpowers/plans/2026-10-30-code-xray-stage-2-extraction.md
(Global Constraints, Review Focus, and Task <N> only), and the spec sections
it cites.

Rules:
- Implement Task <N> only. Follow its steps in order, test first.
- Use the exact names, types and test assertions from the plan. If one is
  wrong or impossible, stop and report it; do not improvise a replacement.
- Touch only the files the task lists.
- Do not refactor, rename, reformat, or "improve" anything else.
- Do not weaken, skip or delete a test to make it pass.
- Do not commit, push or change branches.

When finished, report: files changed, the output of `npm test` and
`npx tsc --noEmit`, anything you could not do, and any decision the plan did
not cover. Claim only what you ran.
```

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/features/code/structure/structureTypes.ts` | New fact types (modify) |
| `src/features/code/structure/tsAnalyze.ts` | Wires extractors in; endpoint fix (modify) |
| `src/features/code/structure/tsFlowFacts.ts` | Injections, calls, signals, HTTP calls, repository calls |
| `src/features/code/structure/tsNestFacts.ts` | NestJS routes and pipeline |
| `src/features/code/structure/tsAngularFacts.ts` | Component metadata, route records, interceptors |
| `src/features/code/structure/ngTemplate.ts` | Tolerant HTML template scanner |
| `src/features/code/structure/componentAssets.ts` | Reads referenced templates and styles (injected IO) |
| `src/features/code/structure/structureMerge.ts` | Merges new result-level fields (modify) |
| `src/features/code/archmap/archModel.ts` | Passes facts through (modify) |
| `src/features/code/archmap/ProjectMapView.tsx` | Calls the assets step (modify) |
| `src/features/code/archmap/SymbolFacts.tsx` | Inspector section |
| `src/features/code/archmap/ArchMapInspector.tsx` | Shows the section (modify) |

---

### Task 1: Fact types and member details

**Files:**
- Modify: `src/features/code/structure/structureTypes.ts`, `src/features/code/structure/tsAnalyze.ts`
- Test: `src/features/code/structure/tsAnalyze.test.ts`

**Interfaces:**
- Produces, in `structureTypes.ts`:

```ts
// Added to StructureMember (all optional):
range?: StructureRange;
bodyHash?: string;
paramTypes?: string[];
returnType?: string | null;

export interface StructureInjection {
  field: string;
  typeName: string;
  via: "inject" | "constructor" | "repository";
  evidence: string;
}
export interface StructureMemberCall {
  member: string;
  /** Field the call goes through; null for `this.method()`. */
  receiver: string | null;
  method: string;
  /** Source order inside the member, from 0. */
  order: number;
  evidence: string;
}
export interface StructureSignalAccess {
  member: string;
  signal: string;
  access: "read" | "write";
  evidence: string;
}
export interface HttpUrlFact {
  /** `environment.x` property kept as a token, e.g. "urlAcme". */
  base: string | null;
  /** Path text; substitutions appear as `${...}`. */
  path: string;
}
export interface StructureHttpCall {
  member: string;
  verb: string;
  /** null: verb proven, URL not reconstructable. */
  url: HttpUrlFact | null;
  returnType: string | null;
  evidence: string;
}
export interface StructureRepositoryCall {
  member: string;
  /** Entity name from `@InjectRepository(E)`. */
  entity: string;
  method: string;
  evidence: string;
}
export interface StructureRouteFact {
  member: string;
  verb: string;
  path: string;
  bodyType: string | null;
  decorators: string[];
  guards: string[];
  interceptors: string[];
  evidence: string;
}
export interface SymbolFlowFacts {
  injections: StructureInjection[];
  calls: StructureMemberCall[];
  signals: StructureSignalAccess[];
  httpCalls: StructureHttpCall[];
  repositoryCalls: StructureRepositoryCall[];
  routes: StructureRouteFact[];
  /** Calls not followed (dynamic access, computed names). */
  unresolved: string[];
}
export interface TemplateUse {
  /** Tag, or attribute name for directives. */
  name: string;
  kind: "element" | "attribute" | "pipe";
  line: number;
}
export interface TemplateFacts {
  rel: string;
  uses: TemplateUse[];
}
export interface ComponentFacts {
  kind: "component" | "directive" | "pipe";
  /** Selector, or the pipe name. */
  selector: string | null;
  standalone: boolean | null;
  imports: string[];
  templateRel: string | null;
  styleRels: string[];
  /** Set after the assets step. */
  template?: TemplateFacts | null;
  missingAssets?: string[];
}
export interface RouteRecordFact {
  path: string | null;
  component: string | null;
  /** Literal `import()` target of loadComponent/loadChildren. */
  lazyImport: string | null;
  canActivate: string[];
  childOf: string | null;
  evidence: string;
}
export type PipelineScope = "http-client" | "global-guard" | "global-interceptor";
export interface PipelineFact {
  scope: PipelineScope;
  /** Names in registration order. */
  names: string[];
  evidence: string;
}
// Added to StructureSymbol: flow?: SymbolFlowFacts; component?: ComponentFacts;
// Added to StructureResult: routeRecords?: RouteRecordFact[]; pipeline?: PipelineFact[];
```

- [ ] **Step 1: Write the failing tests** in `tsAnalyze.test.ts`, under `describe("member details")`:

```ts
it("records range, hash and types for methods", () => {
  const result = analyze(`export class A {
  save(id: string, dto: CreateDto): Promise<Sale> { return run(id); }
}`);
  const save = result.symbols[0].members.find((m) => m.name === "save")!;
  expect(save.range?.startLine).toBe(2);
  expect(save.paramTypes).toEqual(["string", "CreateDto"]);
  expect(save.returnType).toBe("Promise<Sale>");
  expect(save.bodyHash).toMatch(/^[0-9a-f]+$/);
});

it("changes the hash with the body, not with whitespace", () => {
  const hash = (body: string) =>
    analyze(`export class A { run() { ${body} } }`).symbols[0].members[0].bodyHash;
  expect(hash("return 1;")).toBe(hash("return   1;"));
  expect(hash("return 1;")).not.toBe(hash("return 2;"));
});

it("leaves an unannotated return as null", () => {
  const result = analyze(`export class A { run() {} }`);
  expect(result.symbols[0].members[0].returnType).toBeNull();
});

it("survives overloads", () => {
  const result = analyze(`export class A {
  run(a: string): void;
  run(a: number): void;
  run(a: unknown): void {}
}`);
  expect(result.symbols[0].members.filter((m) => m.name === "run")).toHaveLength(3);
});
```

Reuse the file's existing analyze helper if it has another name.

- [ ] **Step 2: Run:** `npx vitest run src/features/code/structure/tsAnalyze.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Add the types and fill the member fields in `collectMembers`.** `bodyHash` is `fnv1aHex` (from `../model`, which is worker-safe) of the node text with whitespace runs collapsed to one space. Fields get `range` and hash too; `paramTypes`/`returnType` only apply to methods and constructors. A parameter without a type is `"unknown"`, and the return annotation is cut with the existing `shortText(..., 40)`.

- [ ] **Step 4: Run** the same test file. Expected: PASS.

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`. Expected: no failures.

### Task 2: Injections, member calls and signals

**Files:**
- Create: `src/features/code/structure/tsFlowFacts.ts`, `src/features/code/structure/tsFlowFacts.test.ts`
- Modify: `src/features/code/structure/tsAnalyze.ts` (`emitClass` sets `flow`)

**Interfaces:**
- Produces: `export function collectFlowFacts(source: ts.SourceFile, node: ts.ClassDeclaration, evidence: (node: ts.Node, what: string) => string): SymbolFlowFacts`
- `httpCalls`, `repositoryCalls` and `routes` stay `[]` until Tasks 3 and 4.
- Consumes: the types from Task 1.

- [ ] **Step 1: Write failing tests**, using `analyzeTsFiles` and reading `symbols[0].flow`:

```ts
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
```

`flowOf` wraps `analyzeTsFiles` and returns `symbols[0].flow!`.

- [ ] **Step 2: Run:** `npx vitest run src/features/code/structure/tsFlowFacts.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `collectFlowFacts`.** First collect `signal`/`computed` fields, then walk each method, constructor and accessor body once. Nested arrow functions count as part of their member. A signal is read when called directly, and written through `.set`, `.update` or `.mutate`. Calls on HTTP fields are left to Task 3.

- [ ] **Step 4: Run** the test file. Expected: PASS.

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`. Expected: no failures.

### Task 3: HTTP calls, URLs and the endpoint fix

**Files:**
- Modify: `src/features/code/structure/tsFlowFacts.ts`, `src/features/code/structure/tsAnalyze.ts` (`visitCalls`)
- Test: `src/features/code/structure/tsFlowFacts.test.ts`, `src/features/code/structure/tsAnalyze.test.ts`

**Interfaces:**
- Produces: `export function httpClientFieldsOf(node: ts.ClassDeclaration): Set<string>`, returning fields typed or injected as `HttpClient`. `visitCalls` skips endpoint emission for receivers `this.<field>` in that set.
- Consumes: `SymbolFlowFacts.httpCalls`, `HttpUrlFact`.

- [ ] **Step 1: Write failing tests:**

```ts
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
```

In `tsAnalyze.test.ts`:

```ts
it("never registers HttpClient calls as endpoints", () => {
  const result = analyze(`export class S {
  constructor(private http: HttpClient) {}
  run() { return this.http.get('/x'); }
}`);
  expect(result.endpoints).toEqual([]);
});

it("keeps Express-shaped routes and other receivers as endpoints", () => {
  const result = analyze(`const app = express();
app.get('/a', handler);
export class S { private map = new Map(); run() { this.map.get('/b'); } }`);
  expect(result.endpoints.map((e) => e.url)).toEqual(["/a", "/b"]);
});
```

- [ ] **Step 2: Run** both test files. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `httpClientFieldsOf` and URL reconstruction.** Resolve only: string and template literals, `+` concatenation, `this.<field>` with such an initializer, and `environment.<x>` as `base`. Any other expression, including ternaries, gives `url: null`. Return type is the first type argument, cut with `shortText(..., 40)`. Update the "HTTP APIs" header comment of `tsAnalyze.ts` with `HttpClient` support.

- [ ] **Step 4: Run** both test files. Expected: PASS.

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`. Expected: no failures.

### Task 4: NestJS routes, repositories and pipeline

**Files:**
- Create: `src/features/code/structure/tsNestFacts.ts`, `src/features/code/structure/tsNestFacts.test.ts`
- Modify: `src/features/code/structure/tsAnalyze.ts`, `src/features/code/structure/tsFlowFacts.ts`, `src/features/code/structure/structureMerge.ts`

**Interfaces:**
- Produces:
  - `export function collectNestRoutes(source: ts.SourceFile, node: ts.ClassDeclaration, evidence: (node: ts.Node, what: string) => string): StructureRouteFact[]`
  - `export function collectNestPipeline(source: ts.SourceFile, evidence: (node: ts.Node, what: string) => string): PipelineFact[]`
- `analyzeTsFiles` sets `pipeline`; `combineResults` concatenates `pipeline` and `routeRecords`, leaving them undefined when no part has them.

- [ ] **Step 1: Write failing tests:**

```ts
const CTRL = `@UseGuards(JwtGuard)
@Controller('esquema-columnas')
export class C {
  constructor(private readonly service: S) {}
  @Public()
  @UseInterceptors(LogInterceptor)
  @Post('bulk')
  createBulk(@Body() dtos: CreateDto[]) { return this.service.createBulk(dtos); }
  @Get()
  all() {}
}`;

it("joins controller and method paths with decorators", () => {
  const routes = flowOf(CTRL).routes;
  expect(routes[0]).toMatchObject({
    member: "createBulk",
    verb: "POST",
    path: "/esquema-columnas/bulk",
    bodyType: "CreateDto[]",
    decorators: ["Public"],
    guards: ["JwtGuard"],
    interceptors: ["LogInterceptor"],
  });
  expect(routes[1]).toMatchObject({ member: "all", verb: "GET", path: "/esquema-columnas" });
});

it("links repository calls to their entity", () => {
  const flow = flowOf(`export class S {
  constructor(@InjectRepository(Carga) private repo: Repository<Carga>) {}
  save(d: D) { return this.repo.save(d); }
}`);
  expect(flow.injections[0]).toMatchObject({ field: "repo", typeName: "Carga", via: "repository" });
  expect(flow.repositoryCalls[0]).toMatchObject({ member: "save", entity: "Carga", method: "save" });
  expect(flow.calls).toEqual([]);
});

it("reads global guards and interceptors", () => {
  const result = analyze(`@Module({ providers: [
  { provide: APP_GUARD, useClass: JwtGuard },
  { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
] })
export class M {}`);
  expect(result.pipeline?.map((p) => [p.scope, p.names])).toEqual([
    ["global-guard", ["JwtGuard"]],
    ["global-interceptor", ["MetricsInterceptor"]],
  ]);
});

it("reads useGlobal calls in bootstrap code", () => {
  const result = analyze(`async function boot(app: App) {
  app.useGlobalGuards(new AGuard());
  app.useGlobalInterceptors(new BInterceptor());
}`);
  expect(result.pipeline?.map((p) => p.names[0])).toEqual(["AGuard", "BInterceptor"]);
});

it("keeps a non-literal route path honest", () => {
  const flow = flowOf(`@Controller(PREFIX) export class C { @Get('x') a() {} }`);
  expect(flow.routes[0].path).toBe("/${...}/x");
});
```

- [ ] **Step 2: Run:** `npx vitest run src/features/code/structure/tsNestFacts.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement both collectors** and wire them in. Paths are joined with single slashes and a leading slash. Non-literal parts become `${...}`. Class-level and method-level guards and interceptors merge, class first. `decorators` excludes the verb, `UseGuards`, `UseInterceptors` and `ApiXxx` names.

- [ ] **Step 4: Run** the test file. Expected: PASS.

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`. Expected: no failures.

### Task 5: Angular metadata, route records and interceptors

**Files:**
- Create: `src/features/code/structure/tsAngularFacts.ts`, `src/features/code/structure/tsAngularFacts.test.ts`
- Modify: `src/features/code/structure/tsAnalyze.ts`

**Interfaces:**
- Produces:
  - `export function collectComponentFacts(source: ts.SourceFile, node: ts.ClassDeclaration, rel: string): ComponentFacts | null`
  - `export function collectRouteRecords(source: ts.SourceFile, evidence: (node: ts.Node, what: string) => string): RouteRecordFact[]`
  - `export function collectHttpInterceptors(source: ts.SourceFile, evidence: (node: ts.Node, what: string) => string): PipelineFact[]`
- `templateRel` and `styleRels` are normalized root-relative paths.

- [ ] **Step 1: Write failing tests:**

```ts
it("reads component metadata with root-relative assets", () => {
  const result = analyze(
    `@Component({ selector: 'app-carga', templateUrl: './carga.component.html',
  styleUrl: '../shared/carga.css', standalone: false }) export class C {}`,
    "src/app/carga/carga.component.ts",
  );
  expect(result.symbols[0].component).toEqual({
    kind: "component",
    selector: "app-carga",
    standalone: false,
    imports: [],
    templateRel: "src/app/carga/carga.component.html",
    styleRels: ["src/app/shared/carga.css"],
  });
});

it("reads styleUrls, standalone imports, directives and pipes", () => {
  expect(analyze(`@Component({ selector: 'a', styleUrls: ['./a.css', './b.scss'],
  imports: [TableModule, ChildComponent] }) export class A {}`, "a.ts").symbols[0].component)
    .toMatchObject({ styleRels: ["a.css", "b.scss"], imports: ["TableModule", "ChildComponent"] });
  expect(analyze(`@Directive({ selector: '[appFoco]' }) export class D {}`, "d.ts").symbols[0].component)
    .toMatchObject({ kind: "directive", selector: "[appFoco]" });
  expect(analyze(`@Pipe({ name: 'fecha' }) export class P {}`, "p.ts").symbols[0].component)
    .toMatchObject({ kind: "pipe", selector: "fecha" });
});

it("reads route records with children, guards and lazy targets", () => {
  const result = analyze(`const routes: Routes = [
  { path: 'inicio', component: Shell, canActivate: [authGuard], children: [
    { path: 'carga', component: Carga },
    { path: 'x', loadComponent: () => import('./x.component').then((m) => m.X) },
    { path: 'y', loadChildren: () => import(name) },
  ] },
];`);
  expect(result.routeRecords?.map((r) => [r.path, r.component, r.lazyImport, r.canActivate, r.childOf])).toEqual([
    ["inicio", "Shell", null, ["authGuard"], null],
    ["carga", "Carga", null, [], "inicio"],
    ["x", null, "./x.component", [], "inicio"],
    ["y", null, null, [], "inicio"],
  ]);
});

it("reads withInterceptors in order", () => {
  const result = analyze(`@NgModule({ providers: [provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))] })
export class M {}`);
  expect(result.pipeline).toEqual([
    expect.objectContaining({ scope: "http-client", names: ["authInterceptor", "errorInterceptor"] }),
  ]);
});

it("ignores objects that are not route arrays", () => {
  const result = analyze(`const opts = [{ path: 'not-a-route', size: 3 }];`);
  expect(result.routeRecords ?? []).toEqual([]);
});
```

The `analyze(content, rel?)` helper defaults `rel` to `a.ts`.

- [ ] **Step 2: Run:** `npx vitest run src/features/code/structure/tsAngularFacts.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the three collectors.** A route record array is one typed `Routes`/`Route[]`, or passed to `RouterModule.forRoot/forChild`, `provideRouter`. An untyped array of objects does not qualify. Relative paths resolve from the component's folder; a path escaping the root leaves that asset out and adds it to `missingAssets`.

- [ ] **Step 4: Run** the test file. Expected: PASS.

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`. Expected: no failures.

### Task 6: Template scanner

**Files:**
- Create: `src/features/code/structure/ngTemplate.ts`, `src/features/code/structure/ngTemplate.test.ts`

**Interfaces:**
- Produces: `export function scanTemplate(rel: string, html: string): TemplateFacts`

- [ ] **Step 1: Write failing tests:**

```ts
const uses = (html: string) =>
  scanTemplate("a.html", html).uses.map((u) => [u.kind, u.name, u.line]);

it("lists custom elements with their lines", () => {
  expect(uses(`<div>\n  <app-hijo></app-hijo>\n  <p-table></p-table>\n</div>`)).toEqual([
    ["element", "app-hijo", 2],
    ["element", "p-table", 3],
  ]);
});

it("skips plain HTML elements", () => {
  expect(uses(`<section><button>Ok</button></section>`)).toEqual([]);
});

it("lists attributes with their bound forms normalized", () => {
  const names = uses(`<input appFoco [appMask]="x" (click)="y()" *appSi="z" class="a" />`).map((u) => u[1]);
  expect(names).toEqual(expect.arrayContaining(["appFoco", "appMask", "appSi"]));
  expect(names).not.toContain("click");
  expect(names).not.toContain("class");
});

it("lists pipes inside interpolations and bindings", () => {
  const out = uses(`<p [title]="a | fecha">{{ b | moneda:'BOB' }}</p>`);
  expect(out).toEqual(expect.arrayContaining([["pipe", "fecha", 1], ["pipe", "moneda", 1]]));
});

it("ignores comments and quoted text", () => {
  expect(uses(`<!-- <app-viejo></app-viejo> -->\n<p title="<app-falso>">x</p>`)).toEqual([]);
});

it("does not confuse the logical or with a pipe", () => {
  expect(uses(`<p>{{ a || b }}</p>`)).toEqual([]);
});

it("reads new control flow blocks and tolerates broken markup", () => {
  expect(uses(`@if (ok) {\n<app-a></app-a>\n}\n<div <app-b`)).toEqual([["element", "app-a", 2]]);
});
```

- [ ] **Step 2: Run:** `npx vitest run src/features/code/structure/ngTemplate.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `scanTemplate`** as a single-pass character scanner with comment, tag and quoted-attribute states. Elements count only with a hyphen in the name. Keep attributes whose name, after removing `[ ] ( ) *`, is not a native or event binding: drop `(event)` forms and a fixed list of global HTML attributes (`class`, `id`, `style`, `title`, `name`, `type`, `value`, `href`, `src`, `alt`, `for`, `placeholder`, `disabled`, `required`). Results are deduplicated per name and kind, keeping the first line.

- [ ] **Step 4: Run** the test file. Expected: PASS.

### Task 7: Reading assets in the analysis run

**Files:**
- Create: `src/features/code/structure/componentAssets.ts`, `src/features/code/structure/componentAssets.test.ts`
- Modify: `src/features/code/archmap/ProjectMapView.tsx` (after each `analyzeTs` batch), `src/features/code/archmap/ProjectMapView.test.tsx`

**Interfaces:**
- Produces: `export async function attachComponentAssets(result: StructureResult, readFile: (rootId: string, rel: string) => Promise<{ text: string }>): Promise<StructureResult>`
- Consumes: `ComponentFacts`, `scanTemplate`.

- [ ] **Step 1: Write failing tests:**

```ts
it("attaches the template and reports missing assets", async () => {
  const result = analyzeTsFiles([{ rootId: "r", rel: "a.component.ts", hash: "h",
    content: `@Component({ selector: 'a', templateUrl: './a.html', styleUrl: './gone.css' }) export class A {}` }]);
  const read = async (_root: string, rel: string) => {
    if (rel === "a.html") return { text: "<app-b></app-b>" };
    throw { kind: "code_not_found", message: "missing" };
  };
  const out = await attachComponentAssets(result, read);
  const facts = out.symbols[0].component!;
  expect(facts.template?.uses[0].name).toBe("app-b");
  expect(facts.missingAssets).toEqual(["gone.css"]);
});

it("marks an unreadable template without failing", async () => {
  const result = analyzeTsFiles([{ rootId: "r", rel: "a.ts", hash: "h",
    content: `@Component({ selector: 'a', templateUrl: './a.html' }) export class A {}` }]);
  const out = await attachComponentAssets(result, async () => { throw new Error("denied"); });
  expect(out.symbols[0].component).toMatchObject({ template: null, missingAssets: ["a.html"] });
});

it("returns results without components unchanged", async () => {
  const result = analyzeTsFiles([{ rootId: "r", rel: "a.ts", hash: "h", content: `export class A {}` }]);
  expect(await attachComponentAssets(result, async () => ({ text: "" }))).toEqual(result);
});
```

Add one case to `ProjectMapView.test.tsx`: a component with `templateUrl` makes the view read that HTML file through `deps.readFile`.

- [ ] **Step 2: Run** both test files. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `attachComponentAssets`,** without mutating its input, and call it in `ProjectMapView.tsx` on each batch result right after `depsRef.current.analyzeTs(slice)`, before `combineResults`, using `depsRef.current.readFile`. Reads run sequentially.

- [ ] **Step 4: Run** both test files. Expected: PASS.

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`. Expected: no failures.

### Task 8: Facts in the inspector

**Files:**
- Create: `src/features/code/archmap/SymbolFacts.tsx`, `src/features/code/archmap/SymbolFacts.test.tsx`
- Modify: `src/features/code/archmap/archModel.ts`, `src/features/code/archmap/ArchMapInspector.tsx`, `src/styles.css`, `docs/architecture-map.md`, `docs/arquitectura.md`

**Interfaces:**
- Produces: `export function SymbolFacts({ flow, component }: { flow?: SymbolFlowFacts; component?: ComponentFacts }): ReactNode`, which returns `null` when there is nothing to show.
- `ArchMapSymbol` gains optional `flow` and `component`, copied in `buildArchMap`.

- [ ] **Step 1: Write failing tests:**

```tsx
it("lists injections, calls, signals and HTTP with evidence", () => {
  render(<SymbolFacts flow={FLOW} />);
  expect(screen.getByText("sesionStore → SesionStore")).toBeTruthy();
  expect(screen.getByText("ejecutar → sesionStore.cerrarSesion()")).toBeTruthy();
  expect(screen.getByText("setUsuario writes #usuario")).toBeTruthy();
  expect(screen.getByText("GET {urlAcme}carga")).toBeTruthy();
  expect(screen.getByTitle("a.ts:3 (inject)")).toBeTruthy();
});

it("says when a URL could not be reconstructed", () => {
  render(<SymbolFacts flow={{ ...FLOW, httpCalls: [{ ...FLOW.httpCalls[0], url: null }] }} />);
  expect(screen.getByText("GET (URL unresolved)")).toBeTruthy();
});

it("lists component assets, template uses and missing files", () => {
  render(<SymbolFacts component={COMPONENT} />);
  expect(screen.getByText("app-carga")).toBeTruthy();
  expect(screen.getByText("a.component.html")).toBeTruthy();
  expect(screen.getByText("app-hijo")).toBeTruthy();
  expect(screen.getByText("Missing: gone.css")).toBeTruthy();
});

it("renders nothing without facts, as with old snapshots", () => {
  const { container } = render(<SymbolFacts />);
  expect(container.firstChild).toBeNull();
});
```

Define `FLOW` and `COMPONENT` in the test with those values. Add one assertion to `archModel.test.ts` that `flow` reaches `ArchMapSymbol`.

- [ ] **Step 2: Run:** `npx vitest run src/features/code/archmap/SymbolFacts.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement `SymbolFacts`** with the existing inspector `Section` pattern and `archmap-list`, placed after "Members" in `SymbolDetail`. Section titles: Dependencies, Calls, State, HTTP, Routes, Persistence, Component. Each row uses its fact's `evidence` as `title`. Export `Section` from `ArchMapInspector.tsx`, or move it to its own file if that creates an import cycle.

- [ ] **Step 4: Document** in `docs/arquitectura.md` (new §28.2) and `docs/architecture-map.md`: the new facts, the limits from spec 4.6, and that `HttpClient` calls no longer count as endpoints.

- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: all pass.

---

## Stage exit check (auditor)

On the ACME pilot, confirm through the inspector:

- `LogoutService` lists `router`, `sesionStore`, `permisosStore`, `tokenStore` and its calls.
- `SesionStore.setUsuario` writes `#usuario`.
- A frontend service shows `GET {urlAcme}…` calls.
- `EsquemaColumnasController.createBulk` shows `POST /esquema-columnas/bulk` with `CreateEsquemaColumnaDto[]`.
- `CargaComponent` shows its HTML, CSS and child tags.
