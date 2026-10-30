# Code X-ray Demo: Flow Mode and Proposal X-ray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. External agents use the worker prompt below.

**Goal:** Show the method-level chain of a component across frontend, gateway and backend, and draw a Muse code proposal on that chain before anything reaches the disk.

**Architecture:** Pure models (`flowModel`, `proposalOverlay`) work on per-project `StructureResult`s kept by `ProjectMapView`. A new `FlowBoard` renders them with the existing cards, rows and viewport. The existing `CodeProposalDialog` supplies generations; its accept and discard commands are reused.

**Tech Stack:** TypeScript, React 19, Vitest, Rust (`ruth-meta`, Tauri commands) for one optional field.

**Spec:** `docs/superpowers/specs/2026-10-30-code-xray-design.md` (sections 3, 5, 7A, 8, 9).

**Deadline:** submission closes 2026-11-04 21:00 ET (22:00 Bolivia); internal target 18:00 Bolivia, features frozen on 2026-11-03. Run tasks in this order: 0, 2, 3, 4, 5, 6, 7, 7B, 8, 10, 9. Task 1 is deferred until after the demo. Task 9 is the first to cut.

**Demo project:** the public sample in `examples/reservas`. Client code is never used for the demo and never sent to Meta.

## Global Constraints

- Nothing from a proposal reaches the disk except through the existing Accept command.
- A link is drawn only with code evidence; otherwise it is unresolved, ambiguous or "no destination".
- Names resolve inside the caller's project first. Only HTTP links cross projects.
- Proposal color `#ff4fd8`, always with a dashed border and a "Muse" label.
- Flow caps: depth 12, 60 nodes, with a visible notice.
- Adjust instruction: at most 2000 characters.
- No new npm or crate dependency.
- English only in code, comments, tests and docs.
- No network in tests. Tests must not read outside this repository.
- No client names, code or paths in anything published. Use `examples/reservas` for demo fixtures.
- Do not commit or push unless the task prompt says so.
- Done means `npm test` exits 0 (an unhandled error fails the run even when every test passes) and `npx tsc --noEmit` passes, plus `cargo test --workspace` from `src-tauri/` when Rust changes.

## Review Focus

1. Two projects with the same class name (`AuditoriaService` in gateway and backend): each chain stays inside its project. Pinned in Task 2.
2. A proposal that replaces a file with a syntax error: partial overlay, no crash, and a note. Pinned in Task 5.
3. A proposal for a brand-new file: all its symbols are "added", even if the analysis never saw that file. Pinned in Task 5.
4. Cycles (`a()` calls `b()` calls `a()`): the walk ends and marks the cut. Pinned in Task 2.
5. Closing or re-running a proposal: the overlay clears and no fuchsia remains. Pinned in Task 6.

---

## Worker prompt

```text
You are implementing one task of an approved plan in the Ruth IDE repository.
Read, in order: AGENTS.md, CLAUDE.md, then
docs/superpowers/plans/2026-10-30-code-xray-demo-flow.md
(Global Constraints, Review Focus, and Task <N> only), and the spec sections
it cites.

Rules:
- Implement Task <N> only. Follow its steps in order, test first.
- Use the exact names, types and test assertions from the plan. If one is
  wrong or impossible, stop and report it; do not improvise a replacement.
- Touch only the files the task lists.
- If a test outside this task's files breaks, stop and report it; do not edit it.
- Do not add behavior the plan does not ask for; report what you think is missing.
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
| `src/features/code/structure/tsFlowFacts.ts` | Proxy calls, module-constant URLs (modify) |
| `src/features/code/structure/tsNestFacts.ts` | `setGlobalPrefix` (modify) |
| `src/features/code/archmap/flowModel.ts` | Resolves facts into a `FlowGraph` |
| `src/features/code/archmap/flowLayout.ts` | Columns, card heights, row anchors |
| `src/features/code/archmap/FlowBoard.tsx` | Draws the graph |
| `src/features/code/archmap/FlowInspector.tsx` | Inputs, Output, Relations, Evidence |
| `src/features/code/archmap/proposalOverlay.ts` | Applies a generation in memory; change marks |
| `src/features/code/archmap/ProjectMapView.tsx` | Flow entry, analyze all, overlay state (modify) |
| `src/features/code/archmap/ArchitectureView.tsx` | Muse entry point (modify) |
| `src/features/code/structure/CodeProposalDialog.tsx` | Reports generations; adjust input (modify) |

---

### Task 0: Public sample project

**Files:**
- Create: `examples/reservas/README.md`, `examples/reservas/backend/src/**`, `examples/reservas/frontend/src/**`, `examples/reservas/backend/package.json`, `examples/reservas/frontend/package.json`
- Test: `src/features/code/archmap/sampleProject.test.ts`

**Interfaces:**
- Produces: a small room-booking app written for this repository. Backend (NestJS, TypeORM): `ReservasController` with `GET /reservas`, `POST /reservas`, `ReservasService`, `Reserva` entity, `CreateReservaDto`. Frontend (Angular signals): `ReservasPageComponent`, `ReservaFormComponent`, `ReservasStore` (`signal`, `computed`), `ReservasService` using `HttpClient` with `environment.apiUrl + 'reservas'`, `authInterceptor`, `authGuard`.
- No `setGlobalPrefix` and no gateway. No third-party assets. Under 25 TypeScript files in total. Contains no user-registration feature: the demo asks Muse to add it.

- [ ] **Step 1: Write the failing test**, which loads the sample's `.ts` files with `node:fs`, runs `analyzeTsFiles` in groups of `STRUCTURE_LIMITS.maxFiles`, and asserts:

```ts
it("yields every link the demo needs", () => {
  const result = analyzeSample();
  const flow = (name: string) => result.symbols.find((s) => s.name === name)!.flow!;
  expect(flow("ReservasService").httpCalls.map((c) => c.verb).sort()).toEqual(["GET", "POST"]);
  expect(flow("ReservasController").routes.map((r) => r.path)).toEqual(["/reservas", "/reservas"]);
  expect(flow("ReservasStore").signals.length).toBeGreaterThan(0);
  expect(result.symbols.some((s) => s.decorators?.includes("Entity"))).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/code/archmap/sampleProject.test.ts`. Expected: FAIL.

- [ ] **Step 3: Write the sample.** Plain, idiomatic code; both sides must be real source that a reader can follow. `examples/reservas/README.md` says it is a demo target for Ruth.

- [ ] **Step 4: Run** the test, `npm test` and `npx tsc --noEmit`. Expected: PASS, and the root `tsc` does not compile `examples/`.

### Task 1: Gateway hops (deferred until after the demo)

**Files:**
- Modify: `src/features/code/structure/structureTypes.ts`, `src/features/code/structure/tsFlowFacts.ts`, `src/features/code/structure/tsNestFacts.ts`, `src/features/code/structure/tsAnalyze.ts`, `src/features/code/structure/structureMerge.ts`
- Test: `src/features/code/structure/tsFlowFacts.test.ts`, `src/features/code/structure/tsNestFacts.test.ts`

**Interfaces:**
- Produces: `StructureHttpCall.via?: "proxy"`; `StructureResult.globalPrefixes?: string[]`; `export function collectGlobalPrefixes(source: ts.SourceFile): string[]` in `tsNestFacts.ts`.
- `combineResults` concatenates `globalPrefixes`, and omits the field when empty.

- [ ] **Step 1: Write the failing tests:**

```ts
it("reads proxy forwards with module constants", () => {
  const flow = flowOf(`const BASE_PATH = '/api/auditoria';
export class S {
  constructor(private readonly proxy: AcmeBackendProxyService) {}
  listar(f: F) { return this.proxy.forward('get', BASE_PATH, { params: f }); }
  uno(id: string) { return this.proxy.forward('get', \`\${BASE_PATH}/\${id}\`); }
}`);
  expect(flow.httpCalls.map((c) => [c.member, c.verb, c.url?.path, c.via])).toEqual([
    ["listar", "GET", "/api/auditoria", "proxy"],
    ["uno", "GET", "/api/auditoria/${...}", "proxy"],
  ]);
  expect(flow.calls).toEqual([]);
});

it("does not treat other forward methods as HTTP", () => {
  const flow = flowOf(`export class S {
  constructor(private readonly bus: EventBus) {}
  run() { this.bus.forward('get', '/x'); }
}`);
  expect(flow.httpCalls).toEqual([]);
  expect(flow.calls.map((c) => c.method)).toEqual(["forward"]);
});

it("reads setGlobalPrefix", () => {
  const result = analyze(`async function boot(app: App) {
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
}`);
  expect(result.globalPrefixes).toEqual(["api"]);
});
```

- [ ] **Step 2: Run** both test files. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** In `resolveHttpUrl`, an identifier resolves through top-level `const` declarations of the same file with the same whitelist. A proxy call needs all of: injected type name ending in `Proxy` or `ProxyService`, method `forward`, first argument a verb literal, URL in the second argument.

- [ ] **Step 4: Run** both test files, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 2: Flow model

**Files:**
- Create: `src/features/code/archmap/flowModel.ts`, `src/features/code/archmap/flowModel.test.ts`, `src/features/code/structure/tsAngularFacts.ts`, `src/features/code/structure/tsAngularFacts.test.ts`
- Modify: `src/features/code/structure/tsAnalyze.ts`

**Interfaces:**
- Consumes: `SymbolFlowFacts`, `StructureResult`, `classifySymbol` from `archLayers.ts`, `normalizeApi` from `apiLinks.ts`.
- Produces:

```ts
export const FLOW_MAX_DEPTH = 12;
export const FLOW_MAX_NODES = 60;

export interface FlowProject { key: string; label: string; result: StructureResult }
export interface FlowStart { projectKey: string; symbolId: string; member: string | null }
export type FlowChange = "added" | "modified" | "removed";

export interface FlowNode {
  /** `${projectKey}#${symbolId}`. */
  id: string;
  projectKey: string;
  projectLabel: string;
  symbol: StructureSymbol;
  layer: ArchLayer;
  /** Members on the chain, in first-visit order. */
  members: string[];
  /** Distance from the start; orders columns. */
  depth: number;
  change?: FlowChange;
  memberChanges?: Record<string, FlowChange>;
}
export interface FlowHttpNode {
  id: string;
  verb: string;
  /** `{urlAcme}carga/bulk`, or null when not reconstructed. */
  url: string | null;
  depth: number;
  via: "client" | "proxy";
  interceptors: string[];
  guards: string[];
}
export type FlowEdgeKind = "call" | "http" | "route" | "entity";
export interface FlowEdge {
  id: string;
  kind: FlowEdgeKind;
  fromNode: string;
  fromMember: string | null;
  toNode: string;
  toMember: string | null;
  /** Order inside the calling member. */
  order: number;
  evidence: string;
}
export interface FlowPending {
  kind: "unresolved" | "ambiguous" | "no-destination" | "cycle";
  label: string;
  fromNode: string;
  fromMember: string | null;
  evidence: string;
}
export interface FlowGraph {
  nodes: FlowNode[];
  httpNodes: FlowHttpNode[];
  edges: FlowEdge[];
  pending: FlowPending[];
  truncated: boolean;
}
export function buildFlowGraph(projects: FlowProject[], start: FlowStart): FlowGraph;
```

- [ ] **Step 1: Write the failing tests**, building projects with `analyzeTsFiles`:

```ts
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
```

`project(key, files)` calls `analyzeTsFiles`, splitting files into groups of `STRUCTURE_LIMITS.maxFiles` and joining with `combineResults`. `startAt` finds the symbol by name.

In `src/features/code/structure/tsAngularFacts.test.ts` (new), pin the one Angular collector the demo needs, taken from Task 5 of the Stage 2 plan:

```ts
it("reads withInterceptors in order", () => {
  const result = analyze(`bootstrapApplication(App, { providers: [
  provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
] });`);
  expect(result.pipeline).toEqual([
    expect.objectContaining({ scope: "http-client", names: ["authInterceptor", "errorInterceptor"] }),
  ]);
});
```

Add `src/features/code/structure/tsAngularFacts.ts` with `collectHttpInterceptors(source, evidence): PipelineFact[]`, wired into `analyzeTsFiles`, and pin in `flowModel.test.ts` that an HTTP node lists those interceptors.

- [ ] **Step 2: Run:** `npx vitest run src/features/code/archmap/flowModel.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `buildFlowGraph`** as a breadth-first walk over `(node, member)` pairs. `this.method()` stays in the same node. An external injected type with no symbol is ignored without a pending entry when the file imports it from a package. Route match: same verb and same `normalizeApi` path, comparing the URL without its base token to the route path. Only `calls`, `httpCalls`, `repositoryCalls` are followed. Interceptors come from `pipeline` entries with scope `http-client` of the caller's project; guards come from the route and `global-guard` entries.

- [ ] **Step 4: Run** the test file, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 3: Flow board

**Files:**
- Create: `src/features/code/archmap/flowLayout.ts`, `flowLayout.test.ts`, `FlowBoard.tsx`, `FlowBoard.test.tsx`
- Modify: `src/styles.css`, `src/features/code/archmap/boardCss.test.ts`

**Interfaces:**
- Consumes: `FlowGraph`, `MemberRow`, `memberRole`, `edgePath`, `ARCH_*` row constants.
- Produces:

```ts
export interface FlowLayout {
  width: number;
  height: number;
  columns: Array<{ key: string; label: string; x: number; w: number }>;
  cards: Map<string, CardPos>;
  /** `${nodeId}::${member}` to the row's vertical center. */
  rowY: Map<string, number>;
}
export function layoutFlowBoard(graph: FlowGraph): FlowLayout;
export interface FlowBoardProps {
  graph: FlowGraph;
  layout: FlowLayout;
  selected: { nodeId: string; member: string | null } | null;
  onSelect: (selection: { nodeId: string; member: string | null } | null) => void;
}
export function FlowBoard(props: FlowBoardProps): ReactNode;
```

- [ ] **Step 1: Write the failing tests:**

```ts
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
```

```tsx
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
```

- [ ] **Step 2: Run** both test files. Expected: FAIL.

- [ ] **Step 3: Implement.** Column key: project plus layer, with one shared "HTTP" column per hop. Cards reuse the `.archboard-card` classes and heights. Edges go row to row: from `rowY` of the source to `rowY` of the target, in the same SVG layer order as the board. Order numbers are small labels at the source end. Rows also list the member's signal accesses from `symbol.flow.signals` ("writes reservas"), because stores are part of the chain. Solid lines for proven edges; `.flow-edge.pending` is dashed. Add CSS constants to `boardCss.test.ts` for any new row height.

- [ ] **Step 4: Run** the test files, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 4: Entering Flow mode

**Files:**
- Create: `src/features/code/archmap/FlowInspector.tsx`, `FlowInspector.test.tsx`
- Modify: `src/features/code/archmap/ArchSymbolBoard.tsx`, `src/features/code/archmap/ProjectMapView.tsx`, `src/features/code/archmap/ProjectMapView.test.tsx`

**Interfaces:**
- Consumes: `buildFlowGraph`, `FlowBoard`, `layoutFlowBoard`, `mergedRef.current[section.key].result`, `section.title`.
- Produces: `onShowFlow?: (symbolId: string, member: string | null) => void` on `ArchSymbolBoard`; `FlowInspector({ graph, selected })`; in `ProjectMapView`, `flowStart` state and `export function flowProjectsOf(sections: MapSection[], merged: Record<string, { result: StructureResult }>): FlowProject[]`.

- [ ] **Step 1: Write the failing tests** in `ProjectMapView.test.tsx`:

```tsx
it("enters Flow mode from a card and leaves it", async () => {
  renderView({ groupBy: "symbols" });
  fireEvent.click(await screen.findByRole("button", { name: "Show flow of SalesController" }));
  expect(await screen.findByRole("button", { name: /^Leave flow/ })).toBeTruthy();
  expect(screen.getByText(/Flow: SalesController/)).toBeTruthy();
  expect(screen.queryByLabelText("Architecture board")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Leave flow/ }));
  expect(await screen.findByLabelText("Diagram of backend")).toBeTruthy();
});

it("warns about a partial chain and analyzes everything on request", async () => {
  const deps = batchDeps(25);
  renderView({ roots: NESTED_ROOTS, deps, groupBy: "symbols" });
  fireEvent.click(await screen.findByRole("button", { name: /^Show flow of C0/ }));
  expect(await screen.findByText(/Partial chain: 5 files not analyzed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Analyze all" }));
  await waitFor(() => expect(screen.queryByText(/Partial chain/)).toBeNull());
});
```

`batchDeps(n)` reuses the 25-file setup of "analyzes the first batch and continues on demand"; extract its setup into a local helper only inside the test file.

`FlowInspector.test.tsx` pins, for a selected member: heading `Service.crear`, section Inputs lists parameter types, section Output shows the return type or "Unknown (not annotated)", section Relations lists outgoing edges, section Evidence lists `file:line`.

- [ ] **Step 2: Run** both test files. Expected: FAIL.

- [ ] **Step 3: Implement.** "Show flow" is a small button in the card head, and in the member detail of the inspector. In Flow mode the boards are replaced by one `BoardViewport` with `FlowBoard`, plus `FlowInspector` in the shared inspector slot. The chip "Flow: X.member() ×" has accessible name "Leave flow". "Analyze all" raises `batchCount` for every section with pending files, so the existing batch loop runs with cancel.

- [ ] **Step 4: Run** both test files, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 5: Proposal overlay model

**Files:**
- Create: `src/features/code/archmap/proposalOverlay.ts`, `proposalOverlay.test.ts`

**Interfaces:**
- Consumes: `CodeProposalFileDto`, `analyzeTsFiles`, `FlowProject`, `FlowChange`.
- Produces:

```ts
export interface SymbolChange {
  change: FlowChange;
  members: Record<string, FlowChange>;
}
export interface ProposalOverlay {
  projects: FlowProject[];
  /** Keyed by `${rootId}:${rel}:${symbol name}`. */
  changes: Map<string, SymbolChange>;
  removed: Array<{ rootId: string; rel: string; name: string }>;
  /** Files not analyzable (non-TS), or partially parsed. */
  notes: string[];
}
export function buildProposalOverlay(
  projects: FlowProject[],
  files: CodeProposalFileDto[],
  analyze?: (inputs: StructureInput[]) => StructureResult,
): ProposalOverlay;
export function applyChangesToGraph(graph: FlowGraph, overlay: ProposalOverlay): FlowGraph;
```

- [ ] **Step 1: Write the failing tests:**

```ts
const BASE = project("fe", { "a.ts": `export class A { run() { return 1; } keep() {} }` });
const file = (rel: string, content: string, operation = "modify", state = "pending") =>
  ({ pos: 0, rootId: "r", rel, operation, state, decidedAt: null, content, expectedFingerprint: null });

it("marks modified methods by body and added methods", () => {
  const overlay = buildProposalOverlay([BASE], [
    file("a.ts", `export class A { run() { return 2; } keep() {} nuevo() {} }`),
  ]);
  expect(overlay.changes.get("r:a.ts:A")).toEqual({
    change: "modified",
    members: { run: "modified", nuevo: "added" },
  });
});

it("marks every symbol of a new file as added", () => {
  const overlay = buildProposalOverlay([BASE], [
    file("b.ts", `export class B { go() {} }`, "create"),
  ]);
  expect(overlay.changes.get("r:b.ts:B")?.change).toBe("added");
  expect(overlay.projects[0].result.symbols.some((s) => s.name === "B")).toBe(true);
});

it("lists symbols the proposal removes", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.ts", `export const x = 1;`)]);
  expect(overlay.removed).toEqual([{ rootId: "r", rel: "a.ts", name: "A" }]);
});

it("ignores accepted and discarded files", () => {
  const overlay = buildProposalOverlay([BASE], [
    file("a.ts", `export class A {}`, "modify", "discarded"),
  ]);
  expect(overlay.changes.size).toBe(0);
});

it("does not mutate the original projects", () => {
  const before = JSON.stringify(BASE.result);
  buildProposalOverlay([BASE], [file("a.ts", `export class A {}`)]);
  expect(JSON.stringify(BASE.result)).toBe(before);
});

it("keeps going on syntax errors and notes them", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.ts", `export class A { run( { }`)]);
  expect(overlay.notes).toEqual(["a.ts: partial syntax"]);
});

it("notes non-TypeScript files without analyzing them", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.html", "<p></p>", "create")]);
  expect(overlay.notes).toEqual(["a.html: not analyzed"]);
});

it("marks graph nodes and members", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.ts", `export class A { run() { return 2; } keep() {} }`)]);
  const graph = buildFlowGraph(overlay.projects, startAt(overlay.projects[0], "A", "run"));
  const marked = applyChangesToGraph(graph, overlay);
  expect(marked.nodes[0]).toMatchObject({ change: "modified", memberChanges: { run: "modified" } });
});
```

- [ ] **Step 2: Run:** `npx vitest run src/features/code/archmap/proposalOverlay.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Find the project holding the file's `rootId`; a new file joins the first project with that root. Remove that file's symbols, files and relations from a copy, analyze the proposed content, then `combineResults`. Compare by symbol name inside the file, and by member name plus `bodyHash`. The default `analyze` is `analyzeTsFiles`, called directly so the overlay stays synchronous.

- [ ] **Step 4: Run** the test file, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 6: Muse on the X-ray

**Files:**
- Modify: `src/features/code/structure/CodeProposalDialog.tsx`, `CodeProposalDialog.test.tsx`, `src/features/code/archmap/ArchitectureView.tsx`, `ArchitectureView.test.tsx`, `ProjectMapView.tsx`, `ProjectMapView.test.tsx`, `FlowBoard.tsx`, `FlowBoard.test.tsx`, `src/styles.css`

**Interfaces:**
- Produces: `onGeneration?: (generation: CodeGenerationDto | null) => void` on `CodeProposalDialog`; `proposalFiles?: CodeProposalFileDto[] | null` on `ProjectMapView`.
- Consumes: `buildProposalOverlay`, `applyChangesToGraph`.

- [ ] **Step 1: Write the failing tests:**

```tsx
it("draws proposed changes with a label, not only a color", () => {
  const { container } = render(<Board graph={markModified(CHAIN)} />);
  const card = container.querySelector(".archboard-card.proposed")!;
  expect(within(card as HTMLElement).getByText("Muse")).toBeTruthy();
  expect(within(card as HTMLElement).getByText("M")).toBeTruthy();
});

it("reports each generation and clears on discard", async () => {
  const onGeneration = vi.fn();
  renderDialog({ onGeneration });
  await generate();
  expect(onGeneration).toHaveBeenLastCalledWith(expect.objectContaining({ id: "gen-1" }));
  fireEvent.click(screen.getByRole("button", { name: /Close/ }));
  expect(onGeneration).toHaveBeenLastCalledWith(null);
});
```

In `ArchitectureView.test.tsx`:

```tsx
it("offers Propose with Muse outside the manual panel", async () => {
  const { ArchitectureView } = await import("./ArchitectureView");
  render(<ArchitectureView />);
  expect(screen.getByRole("button", { name: "Propose with Muse" })).toBeTruthy();
});
```

In `ProjectMapView.test.tsx`: passing `proposalFiles` and then `null` shows and then removes `.archboard-card.proposed` in Flow mode; a test also pins that `deps.readFile` writes nothing and no write command is called.

- [ ] **Step 2: Run** the listed test files. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** Symbol ids come from analysis order, so an overlay can change them: re-find the start symbol in `overlay.projects` by project key, `rel` and name before building the graph. Pin that with a test where the proposal adds a class above the start symbol in the same file. Follow the existing helper names in `CodeProposalDialog.test.tsx`. "Propose with Muse" sits beside the "Manual analysis" toggle and opens `CodeProposalDialog` with the workspace `scope`; when no project or module is selected, the button is disabled with a title saying why. Card style: `.archboard-card.proposed` with `border: 1px dashed #ff4fd8`, a "Muse" badge and A/M/R. With a proposal and no flow open, Flow mode starts at the first added or modified component or class. Removed symbols are listed in the inspector.

- [ ] **Step 4: Run** the listed test files, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 7: Read the code and decide from the box

**Files:**
- Modify: `src/features/code/archmap/FlowInspector.tsx`, `FlowInspector.test.tsx`, `ProjectMapView.tsx`, `ProjectMapView.test.tsx`, `ArchitectureView.tsx`, `ArchitectureView.test.tsx`

**Interfaces:**
- Consumes: `CodeConflictDiff`, `readCodeFile`, `acceptCodeFile`, `discardCodeFile`, `onFileAccepted` behavior from the dialog.
- Produces: `FlowInspector` props `proposal?: { generationId: string; file: CodeProposalFileDto } | null`, `onAccept?: () => void`, `onDiscard?: () => void`, `onOpenCode?: (rootId: string, rel: string, line: number) => void`.

- [ ] **Step 1: Write the failing tests:**

```tsx
it("shows Accept and Discard only for a proposed file", () => {
  renderInspector({ proposal: PROPOSAL });
  expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  cleanup();
  renderInspector({ proposal: null });
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
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
  expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/the context changed/)).toBeTruthy();
});
```

Add `staleReason: string | null` to the `proposal` prop.

- [ ] **Step 2: Run:** `npx vitest run src/features/code/archmap/FlowInspector.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** The diff sits in a modal, using the same `CodeConflictDiff` props as the proposal dialog. `ArchitectureView` keeps the whole `CodeGenerationDto`, not only its files, so the inspector has the generation id and `stale`. After Accept, from the inspector or from the dialog, the file's state updates, the owning section re-analyzes through the existing retry path, and the card loses `.proposed`. The dialog's `onReanalyze` in `ArchitectureView` must trigger that same re-analysis; it is a no-op today. Pin it in `ProjectMapView.test.tsx` with a prop that requests re-analysis of one file: the view reads it again and shows the new content.

- [ ] **Step 4: Run** the test file, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 7B: Verification panel

Meta must do a contextual, verifiable task. This panel shows what Muse received and what Ruth verified, separating the model's work from the local analysis.

**Files:**
- Create: `src/features/code/archmap/proposalChecks.ts`, `proposalChecks.test.ts`
- Modify: `src/features/code/archmap/FlowInspector.tsx`, `FlowInspector.test.tsx`

**Interfaces:**
- Consumes: `CodeGenerationDto`, `ProposalOverlay`, `FlowGraph`.
- Produces:

```ts
export interface ProposalCheck {
  id: "syntax" | "scope" | "chain" | "fresh";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}
export function checkProposal(
  generation: CodeGenerationDto,
  overlay: ProposalOverlay,
  graph: FlowGraph | null,
): ProposalCheck[];
```

- [ ] **Step 1: Write the failing tests:**

```ts
it("passes a clean proposal", () => {
  const checks = checkProposal(GEN, OVERLAY, CHAIN);
  expect(checks.map((c) => [c.id, c.status])).toEqual([
    ["syntax", "pass"], ["scope", "pass"], ["chain", "pass"], ["fresh", "pass"],
  ]);
});

it("fails syntax when a proposed file is partial", () => {
  const checks = checkProposal(GEN, { ...OVERLAY, notes: ["a.ts: partial syntax"] }, CHAIN);
  expect(checks.find((c) => c.id === "syntax")?.status).toBe("fail");
});

it("warns when a modified file was not in the scope sent to Meta", () => {
  const gen = { ...GEN, scope: [] };
  expect(checkProposal(gen, OVERLAY, CHAIN).find((c) => c.id === "scope")?.status).toBe("warn");
});

it("warns about a chain with pending links, naming them", () => {
  const graph = { ...CHAIN, pending: [PENDING_NO_DESTINATION] };
  const chain = checkProposal(GEN, OVERLAY, graph).find((c) => c.id === "chain")!;
  expect(chain.status).toBe("warn");
  expect(chain.detail).toContain("POST /usuarios");
});

it("fails freshness on a stale generation", () => {
  const gen = { ...GEN, stale: true, staleReason: "the context changed." };
  expect(checkProposal(gen, OVERLAY, CHAIN).find((c) => c.id === "fresh")?.status).toBe("fail");
});
```

In `FlowInspector.test.tsx`: the panel shows the model name, token counts, the number of scope files sent to Meta, and each check with a text status, never color alone. Its heading is "Verification".

- [ ] **Step 2: Run** both test files. Expected: FAIL.

- [ ] **Step 3: Implement `checkProposal`** and the panel. The `scope` check compares `modify` files with `generation.scope`. Show Muse's `explanation`, `assumptions` and `questions` under "Muse says", separate from "Ruth verified".

- [ ] **Step 4: Run** both test files, then `npm test` and `npx tsc --noEmit`. Expected: PASS.

### Task 8: Stage 2 inspector facts (Task 8 of the Stage 2 plan, reduced)

**Files:**
- Modify: `src/features/code/archmap/archModel.ts`, `archModel.test.ts`, `src/features/code/archmap/ArchMapInspector.tsx`, `docs/architecture-map.md`, `docs/arquitectura.md`
- Create: `src/features/code/archmap/SymbolFacts.tsx`, `SymbolFacts.test.tsx`

Implement Task 8 of `docs/superpowers/plans/2026-10-30-code-xray-stage-2-extraction.md`, leaving out the component assertions and the Component section, because Tasks 5 to 7 of that plan are deferred. Document Flow mode and the Proposal X-ray in the same docs step, including the limits from spec 4.6. Run `npm test`, `npx tsc --noEmit` and `npm run build`. Expected: all pass.

### Task 9: Ask Muse to adjust (first to cut)

**Files:**
- Modify: `src-tauri/crates/meta/src/code.rs`, `src-tauri/src/commands/codegen.rs`, `src/features/code/client.ts`, `src/features/code/structure/CodeProposalDialog.tsx`, `CodeProposalDialog.test.tsx`, `src/features/code/archmap/FlowInspector.tsx`, `FlowInspector.test.tsx`
- Test: `src-tauri/crates/meta/tests/public_api.rs`

**Interfaces:**
- Produces: `CodeGenRequest.instruction?: string`; Rust request field `instruction: Option<String>` (serde default); `pub const MAX_INSTRUCTION_CHARS: usize = 2000` in `ruth-meta`; `pub fn append_instruction(input: String, instruction: Option<&str>) -> String`.

- [ ] **Step 1: Write the failing tests:**

```rust
#[test]
fn instruction_is_appended_as_a_person_request() {
    let out = append_instruction("BASE".to_string(), Some("add email validation"));
    assert!(out.starts_with("BASE"));
    assert!(out.contains("add email validation"));
}

#[test]
fn blank_instruction_changes_nothing() {
    assert_eq!(append_instruction("BASE".to_string(), Some("   ")), "BASE");
    assert_eq!(append_instruction("BASE".to_string(), None), "BASE");
}

#[test]
fn instruction_is_capped() {
    let long = "x".repeat(MAX_INSTRUCTION_CHARS + 50);
    let out = append_instruction(String::new(), Some(&long));
    assert_eq!(out.matches('x').count(), MAX_INSTRUCTION_CHARS);
}
```

```tsx
it("sends the adjustment as a new generation", async () => {
  const api = fakeApi();
  renderDialog({ api });
  await generate();
  fireEvent.change(screen.getByLabelText("Ask Muse to adjust"), { target: { value: "add email" } });
  fireEvent.click(screen.getByRole("button", { name: "Send adjustment" }));
  await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(2));
  expect(api.generate.mock.calls[1][0].instruction).toBe("add email");
});

it("keeps Send adjustment disabled when empty", async () => {
  renderDialog({});
  await generate();
  expect((screen.getByRole("button", { name: "Send adjustment" }) as HTMLButtonElement).disabled).toBe(true);
});
```

- [ ] **Step 2: Run** `cargo test -p ruth-meta` from `src-tauri/`, and the dialog tests. Expected: FAIL.

- [ ] **Step 3: Implement.** Append the instruction under a fixed heading after the built input, in both requirement and screen paths. The instruction also applies to `code_gen_context`, so the preview shows what is sent. The existing proposal stays stored; the new generation replaces the overlay. The inspector shows the same input through a button that reopens the dialog.

- [ ] **Step 4: Run** `cargo test --workspace`, `npm test` and `npx tsc --noEmit`. Expected: PASS.

---

### Task 10: Public repository readiness

**Files:**
- Modify: `README.md`, every tracked file naming the client project (tests, `docs/`, `structureTypes.ts`)
- Create: `.env.example`, `LICENSE` (only after the owner picks a license)

- [ ] **Step 1: Replace client names** in tests and docs with neutral ones (`acme`, `orders`), keeping every assertion's meaning. `git grep -il acme` must print nothing.

- [ ] **Step 2: Rewrite `README.md` in English, under 150 lines:** what Ruth does, how Meta models are used and for what, install, run, tests, the sample project, limits, and a statement separating the earlier exploratory prototype from work done during the event. Move the milestone history to `docs/`.

- [ ] **Step 3: Add `.env.example`** listing `META_API_KEY` and `META_MODEL` without values, with a comment that Ruth reads the process environment only.

- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build` and `cargo test --workspace`. Expected: all pass. Install from a clean clone following the README.

---

## Demo exit check (auditor)

On `examples/reservas`, in the desktop app, confirm:

- A chain runs from `ReservaFormComponent.submit` through the store and service, across HTTP, to the controller, service and `Reserva` entity.
- A requirement sent to Muse draws dashed fuchsia cards before any file changes on disk (`git status` stays clean).
- The Verification panel shows the model, the context sent, and Ruth's checks.
- Viewing the code shows the diff; Accept writes the file and the card turns solid.
- Discard and closing the dialog remove all fuchsia.
- Nothing in the demo path shows an error or an empty board.
