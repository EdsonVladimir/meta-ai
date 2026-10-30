# Architecture Map (Code)

> New work in this repository is written in English (code, comments, tests,
> docs); only the conversation with the user stays in Spanish. Older
> documents remain in Spanish until their own migration milestone.

The architecture map answers "what did we build, in which layers, and how is
it connected?" for an opened codebase. It analyzes real files (never guesses),
groups them into documented layers, and draws the connections between them, so
that spec-driven changes can later be located graphically on the same map.

Scope of this milestone: **code map for TypeScript** (NestJS / Angular /
generic TS). The views map (HTML/CSS), view→code navigation, design-pattern
detection, the Rust map and the SDD change overlay are documented follow-ups,
not implemented features.

## How it works

1. The user opens the **Architecture** perspective: one view with the
   automatic project boards on top and the manual scope analysis
   (`StructureView`) below. No tabs, no duplicated maps.
2. Scope and visibility come from the explorer tree (detected
   project names, "Analyze this folder", per-project eyes); the
   center only shows a compact breadcrumb with a way back.
3. Saved content is analyzed with the TypeScript compiler API
   (`tsAnalyze`, off the UI thread through the existing worker client).
   Drafts are never analyzed; they only raise a warning.
4. `archModel` groups files into layers and aggregates file-level edges.
5. The board renders layers as left-to-right columns; each card is
   a file with its symbols and expandable members inside. Clicking
   a card shows it in the single shared inspector (symbols, Used
   by/Uses, unresolved, externals, out-of-scope). The inspector
   never opens code: files stay reachable from the explorer.

## Layer taxonomy

Path-based, deterministic, total: every file gets exactly one layer plus
the rule that decided it (`archLayers.ts`). Suffix beats directory;
decorators refine the verdict and say so.

Call order, top to bottom:

- **UI Components**: `*.component.*`, `*.page.*`, `*.view.*`, `components/`,
  `pages/`, `views/`, `@Component`/`@Directive`.
- **Controllers**: `*.controller.*`, `controllers/`, `@Controller`.
- **State**: `*.store|state|signals|reducer|effects.*`, `store(s)/`,
  `state/`.
- **Services**: `*.service|provider.*`, `services/`, `providers/`,
  `@Injectable`.
- **Data Contracts**: `*.dto|entity|interface|model|types|schema|enum|const(ants).*`,
  `dto(s)/`, `entities/`, `interfaces/`, `models/`, `types/`,
  `enums.ts`, `constants.ts`, `@Entity`.
- **Composition**: `*.module|routes|routing.*`, `main|server|app|index.ts`,
  `@Module`.
- **Cross-cutting**: `*.guard|interceptor|middleware|pipe|filter|decorator|util(s)|helper(s).*`,
  `guards/`, `interceptors/`, `middlewares/`, `common/`, `config/`,
  `environments/`, `utils/`, `helpers/`, `shared/`.
- **Unassigned**: tests (`*.spec|test.*`) and anything matching no rule.
  Listed honestly, never forced into a layer.

## Edges and evidence

- **imports**: static `import` / `export from`, resolved against the
  analyzed rels of the same root (extension and `index` probing,
  `.js` → `.ts`). Packages, aliases, assets and out-of-scope files
  stay unresolved with their raw specifier as evidence.
- **extends / implements / references**: the existing strict
  global-uniqueness rule, plus constructor parameters (the NestJS
  injection pattern) as `references`.
- **instantiates**: `new X()` inside symbol bodies, same strict rule.
  Top-level `new` outside any symbol is covered by the import edge.
- Edges never cross roots and never loop to the same file; kinds merge
  with counts (`imports×2, references×1`) and keep one evidence sample.
- Edges draw only around the selected card (nothing without a
  selection), filtered by incoming/outgoing toggles and depth
  (1 = direct, 2 = plus one context hop). A toolbar legend names
  every kind; `references` is a type/value use, never a call.

Anything unverifiable (ambiguous names, builtins, externals) is shown as
unresolved in the inspector, never connected.

## Board presentation

- Layers are columns left to right, each with a badge, a title, a
  file count and its description as a tooltip. Cards stack
  vertically; column headers stick while scrolling.
- Card heights derive from the rows actually rendered (symbols,
  open member lists, the "Show all N" toggle row): one pure pass
  (`boardLayout.ts`) positions cards and edge endpoints in a
  single coordinate system, with no DOM measuring. A test pins
  the CSS constants to the layout math.
- Cards show the file icon and name (truncated with full-path
  tooltips), language and marker badges (`test`, `config`, `no
  symbols`, symbol counts), and one row per symbol with kind
  badges. Long symbol lists expand in place; member lists open
  per symbol, one row per member.
- Test files (`.spec.`/`.test.`) and config files
  (`*.config.ts`, `environments/`) carry their own toolbar
  filters and are counted when hidden, never dropped silently.
- The viewport zooms with the wheel around the cursor, pans by
  dragging the background, and fits the board with a per-board
  Fit button; the shared zoom level survives scope switches.
- One collapsible, resizable inspector serves every board (width
  persisted, collapse session-only); its sections collapse and
  the selection clears on scope switches.

## Card anatomy

- Cards: kind tile, name and the real-extension language badge;
  project chip, decorators and file; readable counters. Column
  panels carry the role hue on their tile; selection is mint and
  independent of the role; focus is a separate light outline.
- Members: one bordered row each with a role icon (method,
  constructor, lifecycle hook, property, property holding a
  function, variant), the written signature, and badges for written
  visibility and modifiers only. Selecting a row shows its full
  detail in the inspector; anything not extracted reads "Unknown"
  or "Not written".
- Lifecycle hooks need framework evidence (import + `implements`,
  or an Angular component/directive decorator), never a name match.
- Related template/stylesheet files are not shown: the extraction
  has no `templateUrl`/`styleUrls` data.

## Limits

- TypeScript only in map v1; other scope files are listed as skipped.
- Analyzer caps still apply (20 files, 300 symbols, 500 relations
  per batch); the map additionally caps at 200 files and 300
  file edges, 1000 symbols and 300 symbol edges, with explicit
  notices. Narrow the scope for the full picture.
- One Rust-side style addition (`instantiates` edge color) keeps the
  existing Structure graph rendering the new relation kind; new IR
  fields are optional so Rust results and old snapshots keep working.

## Pilot (real project, headless)

ACME NestJS backend + Angular frontend (`CODIGO ACME-code`), 268
`.ts` files via a temporary script (deleted afterwards):

- Backend (126): contracts 53, services 24, composition 22,
  controllers 17, cross-cutting 7, unassigned 3 (`excel-legacy.ts`,
  `motor-regla.ts`, `tracing.ts` — unconventional names, honestly kept).
- Frontend (142): ui 56, services 31, contracts 21, composition 20,
  cross-cutting 10, unassigned 0, state 1.
- Sample scope (`contrato-datos`, 9 files): 19 edges, externals
  (`@nestjs/*`, `typeorm`, `class-validator`…) with user counts, and a
  clean unresolved list (builtins and externals only).

The pilot drove two analyzer fixes: TypeScript `enum` extraction and
constructor-parameter references.

## Top-level project maps

The selected project shows its own diagrams without any picking:

- An **Architecture** perspective next to Requirements …
  Traceability. It needs a project (roots link to projects), not
  a module. Boards first, manual scope analysis below, one
  toolbar: the old Boards/Scope tabs and the manual-scope board
  were merged away as the same journey.
- One automatic board per detected project (or per whole folder
  when a root holds none): files are collected breadth-first
  (TypeScript only, backend exclusions apply, 200 files and 2000
  directories caps per scope) and analyzed with the same worker
  and layer taxonomy. Application code is collected first and fills
  the cap; tests (`.spec.`/`.test.`), test folders (`e2e/`, `test/`,
  `tests/`, `__tests__/`, `__mocks__/`, `cypress/`) and config
  (`*.config.ts`, `environments/`) follow with the room left
  (`isSecondaryFile`), so the first batches map the real structure. Cached maps survive eye toggles; nothing
  re-analyzes without a reason.
- **Eye toggles** live in the tree: one per root and one per
  detected project. Whole roots without manifests keep a section
  eye as well. Hidden scopes are skipped, not analyzed.
  Root visibility is session-only; project visibility persists.
- Honest partial states: collection/analyzer truncation, unreadable
  files (skipped, listed), per-section errors with retry, and a draft
  warning naming only analyzed files with unsaved changes.

## Delivery A: function selection, evidence, verified open

Vertical slice over the existing maps (no new analyzer, no new
product): real project → TypeScript analysis → layered board →
select a function → evidence → open the file.

Acceptance criteria (all met):

- The top-level Map shows one inspector per root diagram with the
  same content as the code-area Map (symbols, Used by/Uses,
  unresolved, externals, out-of-scope).
- Clicking a symbol (class, interface, function, component) shows
  its detail: kind, line range, decorators, outgoing/incoming
  relations with kind, resolution status and evidence text.
  Relation targets navigate: same-file symbols select in place,
  other files switch the inspector and select there.
- Members (methods/fields) expand with an honest note: they have
  no own ranges in the IR, so they open at their container.
- Every "Open in code" from either map re-reads the file and
  compares the FNV-1a hash with the analyzed one: match jumps to
  the range, change/unreadable opens the file with a notice. The
  Structure view shares the same helper (`verifiedOpen.ts`).
- Opening from the top-level Map lands in the Code perspective
  with the tab open; cached maps are kept per mount.

Note (board presentation milestone): the inspector buttons that
opened code were removed; the verified-open helper stays in the
Structure view and the explorer keeps file access. Delivery A
above is kept as the historical record.

## Nested projects and the active scope

A root is a container, not necessarily a project. Each root is
scanned for nested projects through supported manifests
(`package.json`, `angular.json`, `nest-cli.json`, `pom.xml`,
`build.gradle`, `Cargo.toml`, Python manifests): a folder with a
manifest is a detected project with its kind, evidence and
analysis support. A `package.json` declaring workspaces is a
container, never a service; `tsconfig*.json` alone never creates
a project. Java, Rust and Python projects are detected and shown,
but maps analyze TypeScript only (detection ≠ support).

- Clicking a detected project name in the tree activates it as
  the Architecture scope; the chevron only expands. Plain
  folders select for exploring and offer "Analyze this folder".
  Opening a file never replaces the scope.
- The joint view ("All projects") shows one section per detected
  project, siblings excluded; nested projects map on their own
  sections. Roots without manifests keep one whole-folder
  section. Every project eye (tree only) filters the joint
  view only; hiding never cancels analysis or closes anything,
  and "Show all" restores. The center keeps a compact scope
  breadcrumb with a way back, never a second selector.
- Analysis runs per scope with cached results, honest
  truncation ("Load more files" continues in batches) and
  cancel; switching scopes discards stale responses.
- Identities carry root and relative path, so equal names in
  different services never collide.

Real limits (causes, not just symptoms):

- Analysis re-runs when returning to the Map perspective: results
  live in view state, and switching perspectives unmounts it.
  Incremental re-analysis (per §3 of the evolution brief) is a
  follow-up, not silently faked.
- Analyzer caps still bound each analysis (20 files, 300 symbols,
  500 relations per batch): big scopes render partial maps with
  explicit notices, and "Analyze more files" continues the
  analysis in batches (resolution stays per batch, documented
  below). Relations across batch boundaries stay unresolved.
- Member signatures are now captured (visibility, static, async,
  readonly, trimmed signatures, constructor parameter properties);
  member ranges are still not in the IR, so members open at their
  container.
- TypeScript only in maps; Rust/Java are separate coverage work.

## Symbol cards and granularity

The default board draws one card per class, interface, enum,
component or free function — the file is shown as location, never
as the forced grouping. A toolbar toggle ("Card grouping")
switches to the file-grouped board as a secondary view; both
projections read the same model, so no symbol is duplicated.

- Each symbol carries its own layer verdict (`classifySymbol`:
  the symbol's decorator, then kind, then name suffix, then the
  file path as context). A DTO interface next to an
  `@Injectable` class stays a contract; column counters read
  "(N symbols)" and files are counted separately.
- Cards list every detected member (constructor, parameter
  properties, fields, methods) with modifiers and signatures;
  large classes collapse behind an explicit, keyboard-reachable
  toggle — never a silent "+N". Each member is its own row and
  the card grows to hold them all (the layout pass reserves the
  height, so a 20+ method class pushes the next card down instead
  of overlapping it; the wheel zooms, so nothing scrolls inside).
- Symbol edges link resolved symbol relations only
  (`extends`, `implements`, `instantiates`, `references`).
  File imports stay file-level edges on the Files board, so an
  import is never mistaken for a method call. Unresolved
  references keep their names with kind and status, in the card
  badge and in the inspector; nothing invents a destination.
- Manual reclassification lives in the inspector (per-symbol
  "Layer" section, with the automatic verdict and its reason
  beside it). Overrides persist per workspace, are guarded by
  the symbol name (a recycled id never inherits them), and
  degrade back to automatic when stale.
- Coverage is shown as discovered / analyzed / failed / excluded
  / pending counters per section. The first batch analyzes 20
  files; "Analyze more files (N pending)" continues on demand.
  Syntax errors yield partial symbols for that file only and
  never fail the batch.

The acceptance fixture (`archSymbolAcceptance.test.tsx`) pins
this contract: a 4-symbol file landing in 4 layers, a 24-member
class with public/private/static/async modifiers, same-named
classes in different files, 26 files across two batches,
a broken file, and an unresolved `new` reference — with
extracted quantities checked against rendered cards.

## Follow-ups (not implemented)

- Views map (HTML/CSS/templates) as a separate tab sharing the
  inspector; then view→code bridges for small refactoring tasks.
- Design-pattern detection (deferred by decision: needs its own
  milestone once the map is stable).
- Rust map reusing the same view contract.
- SDD overlay: NUEVO/MOD badges from the re-analysis diff.
- Raise analyzer caps (or incremental analysis) for full-repo fidelity.
- Kind relabeling of detected projects (only hide/show and
  explicit folder scopes exist as manual corrections).
