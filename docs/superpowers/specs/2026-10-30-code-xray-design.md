# Code X-ray: composition, execution flow and change governance

Status: draft for review. Date: 2026-10-30.
Delivered in stages; each stage gets its own implementation plan.

## 1. Purpose

Developers now ship code through AI assistants faster than they can
read it. Ruth should act as an X-ray of an application: show what the
code is made of, what a process does end to end, and what the latest
change really touched, whichever AI (or person) wrote it. The product
owner calls this software governance.

Three questions drive the design:

| Question | Answer in Ruth |
| --- | --- |
| What makes up this screen? | Pages view (composition) |
| What happens when it runs? | Flow mode (execution chain) |
| What did my last prompt change? | Change comparison (A/M markers) |

### Success criteria

- From any Angular component, see the method-level chain down to the
  HTTP call, across to the NestJS route, service, repository and entity.
- See every page, its child components, and every page that uses a
  given component.
- See each component's TS, HTML and style files, and which pieces come
  from a library.
- After any AI prompt, see which symbols and methods were added or
  modified and follow them on the same boards.
- Nothing is drawn without code evidence. Anything unprovable is shown
  as unresolved, ambiguous or unknown.

### Non-goals

- Reading prompts or integrating with any AI assistant. Ruth sees code
  changes, not prompts.
- Runtime tracing. All of this is static analysis.
- Languages and frameworks other than TypeScript, Angular and NestJS.
  Concepts stay generic; extractors for React, Vue, Java and others
  are later work.
- Clean Architecture or MVC specific layer taxonomies (only the new
  Persistence layer is added here).
- Opening code from a box. Stage 2 stores member ranges so this next
  step is cheap, but the action itself is out of scope.
- Modeling the API gateway as a node.

### Constraints

- Saved content only; drafts are never analyzed.
- New analysis fields are optional, so older snapshots keep working.
- No network in tests; fixtures and fake backends only.
- All project-facing content in English.
- Stage 1 (application code collected before tests and config) is done.

## 2. Observed baseline

Facts verified on the ACME pilot, which shape the extractors:

- Frontend: Angular 21, no NgRx. State lives in 13 signal stores
  (`signal`, `computed`, plain methods). Their methods and signals play
  the role of actions and reducers.
- Dependencies use both `inject(X)` fields and constructor parameters.
  Today only constructors produce relations.
- 87 `this.http.<verb>` calls. URLs are often built from a class field,
  such as `environment.urlAcme + 'esquema-columnas'`. Today
  `this.http.get('/x')` is wrongly registered as a backend endpoint.
- 56 components: 55 with `templateUrl`, 22 with `styleUrl(s)`, none with
  inline templates, 13 with standalone `imports`.
- Interceptors via `withInterceptors([...])`; guards via `canActivate`
  with `CanActivateFn`; 22 lazy `loadComponent`/`loadChildren` uses.
- Backend: NestJS with `@Controller` + `@Get/@Post`, `@UseGuards`,
  `@UseInterceptors`, `APP_GUARD`, `APP_INTERCEPTOR`, TypeORM
  `@InjectRepository`.
- Analysis resolves names per 20-file batch, so links across batches
  stay unresolved today.

## 3. Architecture

Extraction and resolution are separated.

```
per file (worker)            whole scope (pure)         UI
tsAnalyze + tsFlowFacts  ->  flowModel.ts           ->  Flow mode
ngTemplate               ->  compositionModel.ts    ->  Pages view
Git / snapshot baseline  ->  changeModel.ts         ->  A/M markers
```

- Extractors emit name-based facts for one file and never resolve
  across files.
- Pure models merge the facts of every analyzed batch and every visible
  project in the Ruth project, then resolve with the existing strict
  rule: a name connects only when it identifies one symbol; several
  means ambiguous, none means unresolved.
- `tsAnalyze.ts` is already 900 lines, so new extraction goes in focused
  modules: `structure/tsFlowFacts.ts`, `structure/ngTemplate.ts`.
- URL normalization stays in one place, `apiLinks.ts`.

## 4. Stage 2: extraction engine

All additions are optional fields on `StructureResult`,
`StructureSymbol` and `StructureMember`. Every fact carries evidence
(`file:line` and construct).

### 4.1 Members

Each member gains its `range` and a `bodyHash` (FNV-1a of its normalized
text, using the existing shared hash). The hash enables method-level
"modified" in Stage 5; the range enables opening code later.

### 4.2 Execution facts

| Fact | Source |
| --- | --- |
| Injection: field to type name | `inject(X)` field, constructor parameter, `@InjectRepository(E)` |
| Call: member to receiver and method | `this.field.method()`, `this.method()`, in source order |
| Signal access: member reads or writes signal | `.set`, `.update`, `this.sig()` on `signal`/`computed` fields |
| HTTP call | `this.http.<verb><T>(url, body)` with verb, return type, URL parts |
| Route | `@Controller(p)` + `@Get/Post/Put/Patch/Delete(s)` with handler and `@Body()` type |
| Repository call | `this.repo.<method>()` where `repo` is `@InjectRepository(E)` |
| Data types | parameter and return type names of each member |

URL reconstruction handles literals, templates and class fields
initialized from those, with `environment.x` kept as a base token
(`{urlAcme}esquema-columnas/bulk`). Anything else records the verb and
marks the URL unresolved.

Fix: receivers that are `HttpClient` fields stop producing endpoints.

### 4.3 Pipeline facts

- Frontend interceptors: `provideHttpClient(withInterceptors([...]))`,
  in order, applying to all `HttpClient` calls of that app.
- Frontend guards: route records.
- Backend: `@UseGuards` and `@UseInterceptors` on class or method;
  global `APP_GUARD`/`APP_INTERCEPTOR` providers and
  `app.useGlobalGuards/useGlobalInterceptors`.
- Other route decorators, such as `@Public()`, are recorded by name and
  shown without interpretation.

### 4.4 Composition facts

- From `@Component`: `selector`, `templateUrl`, `styleUrl`, `styleUrls`,
  `imports`, `standalone`. `@Directive`/`@Pipe`: selector or name.
- From `@NgModule`: declarations, imports, exports (already partly
  available through `moduleRefs`).
- Route records: `path`, `component`, `loadComponent`, `loadChildren`
  (literal `import()` only), `canActivate`, `children`.
- `ngTemplate.ts`: a small tolerant scanner over the referenced HTML
  that returns element tags, attributes and pipe names with line
  numbers. No new dependency; it does not validate Angular syntax.

### 4.5 Reading files

The collector still walks TypeScript only. Files named by `templateUrl`,
`styleUrl` and `styleUrls` are resolved relative to the component and
read on demand: HTML is scanned; style files are only checked for
existence. A missing file is reported, never guessed.

### 4.6 Declared limits

Not followed, and shown as unresolved: dynamic calls (`obj[name]()`),
callbacks passed as values, RxJS operators beyond identifying the HTTP
call, components created through `ViewContainerRef` or
`ngComponentOutlet`, and non-literal lazy imports.

## 5. Stage 3: Flow mode

### 5.1 Model

`flowModel.ts`, pure: input is merged facts and a start (component, or
one of its methods); output is a `FlowGraph`:

- nodes: symbols with only their participating members;
- edges: member to member, ordered by source line, with evidence;
- HTTP links: call, route, interceptors and guards;
- signal reads and writes;
- DTO and entity nodes;
- `pending`: unresolved and ambiguous items.

Caps: depth 12 and 60 nodes by default, with a visible notice. Cycles
are cut and marked.

HTTP join: verb and normalized path must match after removing the base
token. Several candidates means ambiguous; none means "no destination".
The backend must be associated with the same Ruth project.

Gateway prefixes: ACME services call `{urlApiGateway}acme/ingesta`,
while the NestJS route is `/ingesta`, because the gateway owns the
`acme/` segment. An exact path match would leave those calls without a
destination. The Stage 3 plan must define this match using evidence
(gateway route configuration, or a per-root prefix the user confirms),
never by guessing from suffixes.

### 5.2 Analysis coverage

Flow mode needs the scope analyzed. With pending files it shows
"Partial chain: N files not analyzed" and offers "Analyze all", which
runs the existing batches in sequence with progress and cancel.
Results are cached like today.

### 5.3 Layers

The taxonomy gains **Persistence** (`*.repository.*`, `repositories/`,
`@Entity` classes), colored indigo as specified earlier. Composition
gives up indigo and moves to olive (`#b5c45a`). Existing manual
overrides remain valid.

### 5.4 Interface

- Entry: "Show flow" on component cards and member rows. The toolbar
  shows `Flow: Component.method() ×` to leave the mode.
- Cards outside the chain are hidden, not dimmed.
- Columns follow the chain: UI/State, HTTP, Controllers, Application,
  Persistence. HTTP is a new column between frontend and backend.
- Cards show participating methods; the rest collapse to "+N methods".
- Edges connect rows, and carry the call order number. Row anchors come
  from the layout pass, without DOM measuring.
- Solid line: proven. Dashed line: ambiguous or unresolved, ending in a
  "no destination" box.
- Inspector sections: Inputs, Output, Relations, Evidence.

## 6. Stage 4: Pages view

### 6.1 Model

`compositionModel.ts`, pure, resolves:

- **Page**: a component targeted by a route record. Never by name or
  folder.
- **Parent to child**: a template tag or attribute matches a selector
  visible to the parent (same `NgModule` scope or standalone `imports`).
- **Directive and pipe use**: same rule.
- **Used in**: reverse index from any component to its parents and pages.
- **Files**: TS, HTML, CSS or SCSS per component.
- **Unused**: components with no route and no parent. Shown as
  "No usage detected", because dynamic creation cannot be ruled out.

### 6.2 Library identification

A tag or attribute with no local selector is external.

- `ng-*` and `router-*` are Angular.
- A library name is shown only when the declaring module or standalone
  component imports that package and the match is unique.
- Otherwise: "External (library unconfirmed)".

A prefix alone is never proof.

### 6.3 Interface

- "Pages" joins Symbols and Files in the grouping toggle.
- Columns: Pages, then components by depth, then shared components
  (used by more than one page). Lines link parent to child.
- Cards show file chips and a "used in N pages" counter.
- Library pieces are grouped as chips inside the card that uses them.
- Selecting a card highlights its parents and lists them in the
  inspector. "Show flow" jumps to Flow mode.
- Nested `router-outlet`s are drawn from route `children`.

## 7. Stage 5: Change comparison

Selected option: Git HEAD by default, plus optional checkpoints.

- **Baseline HEAD**: a new read-only Rust capability in `ruth-code`
  lists changed files and reads file content at HEAD, confined to the
  root. No writes to the repository and no network. A root without Git,
  or a machine without Git, shows an honest "Git unavailable" state.
- **Checkpoint**: "Mark point" stores a structure snapshot through the
  existing snapshots. Comparison then shows only what changed after it.
  A checkpoint requires the scope to be fully analyzed.
- `changeModel.ts`, pure: extends the content-keyed logic of
  `diffStructure.ts` to members, using `bodyHash`. Output per symbol and
  member: added, modified, removed.
- Interface: A/M badges on cards, rows and edges; a "Changes" panel with
  counts; a "Changed only" filter on every board; a clear label for the
  active baseline. Removed items are listed in the panel.
- Honesty: the baseline mixes every edit made since it, human or AI.

Open points to settle in the Stage 5 plan: the Git access mechanism
(system `git` binary or a library), and whether current snapshots can
hold member hashes without a schema change. A schema change must follow
the migration rules.

## 8. Error handling

- Unreadable, missing or unparsable files never fail a batch: partial
  results plus a note in Details.
- Oversized results use visible caps, never silent truncation.
- Old snapshots without new fields degrade to "not available".
- Flow and Pages show why they are empty: nothing analyzed, not Angular,
  or no routes found.

## 9. Testing

- Unit tests with fixtures for every extractor, including each limit in
  section 4.6.
- Pure model tests for resolution, ambiguity, cycles, caps, HTTP join,
  library rule and change detection.
- Component tests with injected backends, no Tauri.
- Layout tests pinning row anchors to CSS constants, as `boardCss` does.
- Rust tests for Git reading on temporary repositories, no network.
- Pilot acceptance on ACME, recorded in the docs:
  - a chain from a component to `POST` and the TypeORM entity;
  - `CargaComponent` listed as a page with its children;
  - `LogoutService` linked to its three stores;
  - an edit reported as M at method level.

## 10. Stages and order

| Stage | Delivers | Depends on |
| --- | --- | --- |
| 1 | App code collected first | Done |
| 2 | Extraction engine | 1 |
| 3 | Flow mode | 2 |
| 4 | Pages view | 2 |
| 5 | Change comparison | 2, and uses 3 and 4 |

Stage 2 is invisible on its own, so its plan should end with the HTTP
fix and facts visible in the inspector, to validate them on real code.
