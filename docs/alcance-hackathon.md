# Competition scope — Ruth IDE (Indie category)

## Target product

A visual workspace turning requirements into linked design
artifacts. When a rule changes, it identifies affected dependencies
and proposes adjustments for a person to review (review is
optional, not a barrier: see [live-design
decision](decision-diseno-vivo.md)).

## Horizon

**Full vision:** requirements → design → architecture →
implementation → verification → code review.

**Competition goal:** requirements linked to flow and ER → rule
change → impact → proposals → review → export.

**Current milestone (delivery A, [see
document](architecture-map.md)):** real project → TypeScript
analysis → layered board → function selection → evidence → open
file. Builds on the top-level Map perspective (one automatic
diagram per associated folder): promoted inspector with symbol
detail (incoming/outgoing relations with kind, status and
evidence), members with honest opening at their container, and
hash-verified navigation in both maps. No AI, no guessing:
whatever cannot be verified shows as unresolved. New work is
written in English (code, tests and docs); the dialogue stays in
Spanish.

**Nested scope fix (same milestone):** a root holding several
frontend/backend projects maps each detected project on its own
board section: selecting a project folder shows that project's
architecture (never the whole root), siblings and nested
projects stay out unless explicitly scoped, every detected
project carries a persisted visibility eye, and truncated
collections continue in batches. See [architecture
§26](arquitectura.md).

**Board presentation (same milestone):** layers as columns with
content-derived card heights, selection-only edges with
direction/depth controls and a legend, wheel zoom with
background pan and per-board Fit, one shared
collapsible/resizable inspector, test/config filters with
honest counts, and a single merged Architecture view (the
Boards/Scope tabs and the duplicated center selectors are
gone; the tree owns scope and visibility). See [architecture
§27](arquitectura.md).

**Symbol granularity (same milestone):** one card per
class/interface/free function with its own layer verdict and
full members (modifiers, signatures), the file board kept as
a secondary grouping toggle, per-symbol manual overrides in
the inspector, symbol-only resolved edges, and
discovered/analyzed/failed/excluded/pending counters with
batch continuation. See [architecture
§28](arquitectura.md).

## Target walkthrough

Open an existing frontend+backend as one Ruth project → analyze
scope → see OOP per side, detected data and API unions (plus the
unused from each side) → add a requirement → propose code →
review per-file diffs → accept → re-analyze and see which unions
appeared or broke → close/reopen and check proposals and
associations.

## Scope of this milestone (structure replication as modules)

Visible structure only (`readdir`, one level, schema v14
unchanged): each folder gets a working shell ready for
requirements, with a folder chip and module↔code jump in the
project tree.

- Preview with a suggested base (`src/app` when it exists with
  subdirectories, else `src`, else the root for sibling
  microservices) or one chosen by the user; entries with their
  previous link when there is one, policy-excluded ones, and
  truncation/over-cap notices. Previewing creates nothing.
- Target: new project (editable name, no AI) or existing one;
  checked folders (the free ones, by default).
- Atomic validate→persist→publish creation: domain + roots +
  links, or nothing. Idempotent per (root, rel): already-linked
  items are reported, never duplicated or deleted.
- Max 50 modules per replication (blocks, never truncates); a
  root linked to another project blocks with an explicit message.
- After creating: project + first module selected, perspectives
  enabled, tree refreshed.

Still working: living code diagrams, unified perspectives and
everything below.

## Scope of this milestone (living code diagrams)

The project is born from existing folders; the diagrams are the
board of what was built. One local truth (schema v13), without
rewriting editors or terminals:

- APIs detected with documented subsets: Express/Hono routes and
  `fetch`/`axios` calls (TS); Actix attributes, Axum `.route`
  and `reqwest` (Rust). Static literals; outside a subset
  nothing is drawn.
- Front↔back unions by normalized method+path (`ALL` joins with
  everything; dynamic `:id`/`{id}`/`${…}` count the same):
  joined, exposed-but-unused, consumed-but-undefined, external
  and ambiguous (never connected).
- Structure with Classes/Data/APIs tabs: syntactic data
  (interfaces, structs, enums; not an ER), fingerprint
  navigation and honest empty and cap notices.
- Propose code from requirement or screen + scope: preview,
  generation with Meta, current↔proposed diff per file, accept
  (safe fingerprint write; creating never overwrites, modifying
  requires the captured fingerprint) or discard; staleness
  blocks and asks to regenerate.
- Screen source (one direction): saved screen with its exact
  sources; minimal edits that respect manual code and never
  invent backend from the data source; warning with an unsaved
  draft.
- Improvement loop: re-analyzing after accepting compares
  against the opening (symbols, relations, endpoints, calls and
  unions); clean tabs and the tree refresh on their own.
- v14 persistence: generations with an exact source
  (requirement or screen + sources), proposed contents and
  per-file state; transactional migration from v13.

Still working: unified perspectives, code structure, code
workspace, mockups as the main input, density and window,
assistant and header, integrated terminal, live-design stages A
and B, renaming, archiving and deletion, milestone-10 visual
editing, milestone-9 export, milestone-8 update proposals,
milestone-7 impact map, milestone-6 linked design, milestone-5
requirement generation, milestone-4 persistence, milestone-3
requirement space, milestone-2 core and the connection test.

## Previous milestone (unified perspectives, done)

Open Ruth itself as a project (⤴ from folder) → explore `src`
and `src-tauri` under the same context → analyze and link a
symbol to an artifact → save a snapshot → edit outside →
verify staleness → close/reopen and check associations.

## Scope of that milestone (unified perspectives)

Without rewriting analyzers, editors or terminals; one local
truth (schema v12) and `.ruth/` only as a future contract:

- Perspective navigation: `Code` at the center next to
  Requirements/Design/Impact/Mockups; same selection, same
  drafts, single terminal. No exclusive switch.
- Project↔roots: create from folder, link/unlink per root
  (removing never deletes), missing ones without losing the
  project.
- Manual links (module↔path), detected ones
  (artifact↔symbol with source range and hash) and reserved
  `inferred`; computed freshness, blocks with counts.
- IR snapshots (without contents): save, list, verify per file
  and delete; read-only.
- Per-module traceability from explicit links: linked and
  unlinked artifacts plus orphan snapshot symbols, with
  computed freshness and no judgments.
- Portability: `PortableExport` v1 as a contract, without
  writing or syncing.

Still working: code structure, code workspace, mockups as the
main input, density and window, assistant and header, integrated
terminal, live-design stages A and B, renaming, archiving and
deletion, milestone-10 visual editing, milestone-9 export,
milestone-8 update proposals, milestone-7 impact map,
milestone-6 linked design, milestone-5 requirement generation,
milestone-4 persistence, milestone-3 requirement space,
milestone-2 core and the connection test.

## Previous milestone (code structure, done)

Select TypeScript or Rust workspace files and explore their real
structure through an interactive diagram connected to the code.
In two stages: A (TypeScript) and B (Rust). Walkthrough: open
Ruth's folder → add `model.ts` and `CodeTree.tsx` to the
analysis → **Analyze selection** → see classes/functions and
their relations → click a symbol → open in code at its range →
edit outside → check stale → **Recalculate** → repeat with a
`.rs` file (struct/enum/trait/impl).

## Scope of that milestone (code structure)

Explicit and bounded analysis with real parsers (no regex as an
analyzer, no Meta, no code execution), over a shared IR:

- TypeScript (stage A): classes, interfaces, functions and
  components (marked heuristic), inheritance, `implements` and
  references; deferred worker; partial on errors.
- Rust (stage B): structs, enums, traits and `impl` via `syn`;
  `impl Trait` as `implements`; per-file errors.
- Global-uniqueness resolution; ambiguous/unresolved to the
  inspector, never invented on the canvas.
- Structure view: scope, read-only diagram, evidence inspector,
  filters, search, legend, caps with notice and fingerprint-
  verified navigation.

Still working: code workspace, mockups as the main input,
density and window, assistant and header, integrated terminal,
live-design stages A and B, renaming, archiving and deletion,
milestone-10 visual editing, milestone-9 export, milestone-8
update proposals, milestone-7 impact map, milestone-6 linked
design, milestone-5 requirement generation, milestone-4
persistence, milestone-3 requirement space, milestone-2 core
and the connection test.

## Previous milestone (code workspace, done)

Open frontend and backend as folders of the same workspace,
browse and edit files with safe saving, and open contextual
terminals. In two stages: A (opening and reading) and B
(editing). Walkthrough: open frontend folder + add backend →
browse → same name disambiguated → edit → Ctrl+S → terminal
here in each root → external change →
compare/reload/replace → close/reopen and check roots.

## Scope of that milestone (code workspace)

Several local roots per workspace (distinct repositories,
never merged), separate from design projects. With the file
rules in `ruth-code`, roots in SQLite (schema v11) and disk
only from Rust:

- Explorer: open/add/remove folders (removing never deletes),
  on-demand loading, `.git`/`node_modules`/`target`/`dist`
  excluded, 500-entry cap with notice, context menu (open
  file, terminal here, remove). No create/delete/move/rename
  yet.
- Reading: tabs per root + path, UTF-8 up to 256 KiB,
  binaries and over-size rejected; missing roots with a clear
  error.
- Editing (on-demand Monaco): one model per tab, selectable
  highlighting, local search, per-tab Ctrl+S and an honest
  fallback if Monaco fails to load.
- Safe saving: fingerprint per read, conflict on external
  change (compare/reload/replace), atomic write with
  preserved permissions, draft intact on failures.
- Contextual terminal in the shared panel, with the same
  lifecycle and without `META_*`.

Still working: mockups as the main input, density and window,
assistant and header, integrated terminal, live-design stages
A and B, renaming, archiving and deletion, milestone-10 visual
editing, milestone-9 export, milestone-8 update proposals,
milestone-7 impact map, milestone-6 linked design, milestone-5
requirement generation, milestone-4 persistence, milestone-3
requirement space, milestone-2 core and the connection test.

## Later refinement (windows, icons and scope, §23)

Presentation and navigation only, without touching domain,
SQLite or analyzers:

- All four zones resize (handle + keyboard) and their sizes
  persist in the WebView (`ruth-ide:layout` v1).
- Own unified icons in `src/components/`, decorative, with a
  documented contract for future packs.
- Structure: "+ Active folder" and a three-step guide with an
  empty scope; audited window map.

## Later refinement (editor presentation, phase 1)

Presentation and local navigation of the Code area only,
without touching safe saving, terminals, Structure or live
design:

- Ruth theme for Monaco, optional minimap, line wrap, guides
  and bracket pairs, optional fixed header, font size and
  visible whitespace; visual-only preferences in WebView
  storage (never content or credentials).
- Root/folders/file breadcrumb with tree reveal, own per-type
  icons, status bar (cursor, selection, lines, UTF-8,
  language) and tabs with icons, keyboard (arrows/Home/End)
  and scroll to the active one.
- Conflicts with the real Monaco diff (read-only, side by side
  or inline) and a text fallback when it fails to load.
- No LSP, debugging, visual Git, refactoring, global search or
  quick open: later phases.

## Previous milestone (mockups as the main input, done)

Start from saved requirements, propose screens with Meta, take
them in as editable mockups and relate them to processes and
data, with no mandatory approvals. Walkthrough: user-signup
requirements → propose screens → take one in → add a field,
button and icon → define actions and data source → Ctrl+S →
propose flow and ER → review relations and questions →
close/reopen and check persistence.

## Scope of that milestone (mockups as the main input)

The structured mockup is authoritative; future image and HTML
will be auxiliary. Visual field ≠ column, screen ≠ entity.
With the rules in `ruth-core`/`ruth-api`, the contract in
`ruth-meta` and Meta calls only from Rust:

- Proposals: "Propose screens" from saved requirements (with a
  context preview and an offer to save drafts); at most 3
  screens per request, each individually takable as a new and
  idempotent mockup. Without replacing existing screens;
  changed sources → stale proposal.
- Model: container (ordered children, direction), icon (own
  catalog), logical name and declarative validations on
  fields, declarative actions with state on buttons, types and
  preview on tables, per-screen interface states. Earlier
  content readable without rewriting versions.
- Editor: extended palette, duplicate with new IDs, align,
  optional grid, zoom/pan/fit, undo/redo, Ctrl+S and
  historical reading. No third-party HTML/JS.
- Design from mockups: flow/ER elements quote
  `mockup/component` to show what justifies them; technical
  attributes only with justification and never by default;
  updates preserve the manual ones.
- Persistence with migration to schema v10 (screen-proposal
  tables) and export including the mockups as JSON plus a
  summary; historical baselines come out byte-identical.

Still working: density and window, assistant and header,
integrated terminal, stage B (person-drawn mockups), stage A
(barrier-free saving, work deliveries), renaming, archiving
and deletion, milestone-10 visual editing, milestone-9
export, milestone-8 update proposals, milestone-7 impact map,
milestone-6 linked design, milestone-5 requirement generation,
milestone-4 persistence, milestone-3 requirement space,
milestone-2 core and the connection test.

## Previous milestone (live design, stage B, done)

Versioned mockups on par with requirements and designs, drawn
by a person: visual editor, Ctrl+S and Meta flow/ER
generation using requirements and mockups as context. See
[live-design decision](decision-diseno-vivo.md).

## Previous milestone (density and window, done)

Visual refinement without functionality changes: radii and
spacing at 50%, minimum 1 px borders, −2 px typography with a
12 px floor (canvases, nodes, terminal and interaction areas
intact), and a window without a native bar with own controls
in the header (drag, double click, cancelable close with
drafts and terminals). See [architecture
§19](arquitectura.md).

## Previous milestone (assistant and header, done)

Honest header with real per-document save state and a drafts
gate on export, plus a Meta Assistant panel reusing the
existing AI flows with explicit actions (no silent
classifier). Without touching AI services, proposals or
persistence. See [architecture §18](arquitectura.md).

## Previous milestone (integrated terminal, done)

Bottom panel with up to three real shell sessions (PTY via
`portable-pty`, xterm.js): tabs or side by side, initial
folder via native dialog, `META_*`-scrubbed environment, and
lifecycle with confirmations. Nothing persists or restores.
See [architecture §17](arquitectura.md).

## Previous milestone (live design, stage A, done)

Saving, generating and continuing to design without approval
barriers, with the rules in `ruth-core`/`ruth-api` and Meta
calls only from Rust:

- Generating and updating start from current saved versions;
  review is optional and informative. Identities, exact
  versions, provenance, conflicts and structural validation
  still hold. "Stale" = needs syncing, not forbidden.
- Central Ctrl+S (and Save button) to the active editor; no
  changes create no versions; a failure preserves the draft.
  Derived views (canvas/Mermaid/impact) local without API.
- Opt-in per-module AI self-updating, off at start: 2.5 s
  debounce, one run per module, at most 5 proposals per
  cycle, results to separate proposals, no recursion; if Meta
  fails, the save stays valid.
- Exportable work/draft deliveries (`entrega-N`), honest:
  they identify pending items, optional reviews and obsolete
  sources; never "coherent" or "verified". Historical
  baselines keep their meaning and come out byte-identical.
  Schema v9.

Still working: renaming, archiving and deletion, milestone-10
visual editing, milestone-9 export, milestone-8 update
proposals, milestone-7 impact map, milestone-6 linked design,
milestone-5 requirement generation, milestone-4 persistence,
milestone-3 requirement space, milestone-2 core and the
connection test.

## Previous milestone (renaming, done)

Renaming projects, modules, requirements and diagrams without
touching IDs: organizational names and metadata titles with
signed history, optimistic concurrency (`stale_name`),
baselines pinning current titles and historical ones keeping
theirs (schema v8). Renaming invalidates no reviews and
creates no impacts. See [architecture
§14](arquitectura.md).

## Previous milestone (archiving and deletion, done)

Reversible archiving and safe deletion of modules and
requirements, with the rules in `ruth-core` and no Meta calls:

- "…" menu on modules and requirements: archive, restore and
  permanently delete (the latter only when nothing mentions
  it). Advisory prior summary with content, dependents
  (inside/outside the module), baselines and generations;
  execution revalidates in Rust.
- Archiving: hides from active lists ("Show archived" toggle),
  preserves versions, approvals, dependencies, baselines and
  generations, and blocks edits, generations and approvals
  until restored. Archiving a module hides by context without
  touching individual files; history stays consultable.
- Dependencies: archiving satisfies no dependencies;
  approving or delivering with archived sources blocks until
  the source is restored or the version revised. Historical
  baselines stay exportable.
- Deletion: only empty modules without generations or
  baseline scope, and draft requirements without approvals,
  dependents, baselines or generation mentions. No cascades
  or history rewriting; explicit confirmation with name and
  consequences. Schema v7.

Still working: milestone-10 visual editing, milestone-9
export, milestone-8 update proposals, milestone-7 impact map,
milestone-6 linked design, milestone-5 requirement generation,
milestone-4 persistence, milestone-3 requirement space,
milestone-2 core and the connection test.

## Previous milestone (milestone 10, done)

Interactive visual editing of Flows and Data over the
milestone-6 subset, with no Meta calls and without widening
the contract:

- Interactive canvas (deferred React Flow) for both types:
  cursor-centered wheel zoom, drag panning, zoom-in/out/fit/
  center-100% buttons with percentage, selection and moving,
  connection creation by drag or keyboard, and read mode for
  historical versions.
- Data editor: entities (create, rename, delete), attributes
  (name and PK mark, what the contract represents) and
  relations with cardinalities, with an inspector and
  consequence-showing delete confirmations. Edits the model,
  not real rows: no SQL.
- Flow editor: steps, decisions, start and end, labels and
  branches, preserved requirement quotes and structural
  notices without forbidding valid cycles.
- Elevated draft with semantic undo/redo, guiding frontend
  validation and authoritative Rust validation, and saving
  as a new version with human provenance, current declared
  sources and layout in the same transaction (schema v6);
  reordering without changing semantics only saves layout.
  Navigation guard, approval block with pending edits and
  Impact recalculation.

Still working: milestone-9 export, milestone-8 update
proposals, milestone-7 impact map, milestone-6 linked design,
milestone-5 requirement generation, milestone-4 persistence,
milestone-3 requirement space, milestone-2 core and the
connection test.

## Previous milestone (milestone 9, done)

Approved baseline and reproducible export, reusing the
`ruth-core` baseline mechanism and with no Meta calls:

- Export button with a deliveries dialog: preparation with
  exact versions, dependency closure, approvals, concrete
  blocks and out of scope; preparation never mutates and
  creation revalidates (`changed_since_preview` on
  intermediate changes).
- Explicit human creation with name and description:
  immutable and persisted baseline (schema v5), consultable
  and exportable even as the project moves on; the listing
  flags later progress.
- Reproducible ZIP with local code: README, specification,
  versioned manifest with SHA-256, original contents, Mermaid
  diagrams and honest implementation context; no keys,
  SQLite, chats or discards. Only from the baseline, with
  normalized order, paths and metadata.
- Safe saving with a native dialog: canceling writes nothing,
  replacement with confirmation, temp file and atomic rename;
  created baseline and exported file as separate steps. In a
  browser it reports that exporting requires desktop.

## Previous milestone (milestone 8, done)

Meta update proposals over pending designs, reusing the
generation system (same schema, validation, registry and
acceptance) and with no real calls in tests:

- "Propose update" action from the inspector: snapshot with
  target, current design, sources with both versions, source
  change, paths and blocks (in milestone 8, unapproved
  sources and stale intermediates; since live design,
  approval is informative and existing current sources are
  enough: see [live-design
  decision](decision-diseno-vivo.md)).
- Explicit generation for one design at a time, with the same
  limits, timeout and one-generation-per-module mark as
  creation.
- Comparison: switchable diagrams, deterministic structural
  diff, old and new sources, explanation and questions;
  JSON editor with revalidation, re-render and re-diff.
- Atomic and idempotent acceptance over the same artifact and
  snapshot version, with current sources; blocking discard.
- Preserved stale proposals with explicit new generation; no
  version created with a pending proposal on failures.
- Impact with differentiated "pending approval" and
  recalculation preserving pendings; v4 persistence with a
  preserving migration.

Still working: milestone-7 impact map, milestone-6 linked
design, milestone-5 requirement generation, milestone-4
persistence, milestone-3 requirement space, milestone-2 core
and the connection test.

## Previous milestone (milestone 7, done)

Change impact map, with `ruth-core` as the only domain
authority and no Meta calls:

- `core_impact_report` query: source with version comparison,
  direct and indirect dependents, used vs. current sources,
  explanatory paths and computed status. No mutations.
- Impact tab: header, Before/Now, map, paged table, inspector
  and derived unique-pendings counter.
- Own read-only SVG graph with selection, zoom and fit;
  explicit truncation; text and icons besides color; no new
  dependencies.
- Honest states (historical approval + staleness coexist) and
  resolution only through a new reviewed version.
- Inspector with View differences, Open design/requirement
  and View sources; recalculation after mutations; context
  preserved on return.

Still working: milestone-6 linked design, milestone-5
requirement generation, milestone-4 persistence, milestone-3
requirement space, milestone-2 core and the connection test.

## Previous milestone (milestone 6, done)

Requirement-linked design and visual layout, with `ruth-core`
as the only domain authority:

- Mockup-inspired composition: dark theme, compact header,
  left with modules and artifacts (requirements + designs),
  center with Requirements/Design views, right with
  generation, sources and review; no buttons faking the next
  milestone's impact map.
- Per-module and per-type generation (flow or ER) from
  selected saved requirements (in milestone 6 they had to be
  approved; since live design, current saved versions are
  enough); each type with an independent action, never
  regenerating on navigation.
- Initial structured subset (bounded JSON) validated in
  Rust, with references inside the sent set; a flow cycle is
  valid and never confused with the forbidden cycles of the
  dependency graph.
- Local Mermaid rendering via a deterministic serializer
  with escaped labels, on-demand loading and
  `securityLevel: strict`; the JSON is authoritative and
  Mermaid derives, never edited.
- Review with a validated JSON editor and idempotent "Accept
  as draft" (creates the artifact or a new version with the
  expected version); approving requires human confirmation,
  validated and rendered content, and revalidating validity
  and current version in Rust.
- Exact dependencies on the versions used; obsolete sources
  block acceptance and the core computes the pending review.
- v3 persistence with a migration preserving v1/v2:
  generations, proposals and design provenance; atomicity
  domain → database → UI.
- Tests with fixtures and a fake generator, no network or
  real key.

Still working: milestone-5 requirement generation,
milestone-4 persistence, milestone-3 requirement space,
milestone-2 core and the connection test.

## Previous milestone (milestone 5, done)

Meta-assisted requirement generation, with `ruth-core` as the
only domain authority:

- Per-module panel: description, context preview, generation
  button, editable proposals, separate questions and
  individual accept or discard. No replacements or automatic
  saves.
- Privacy: only the active module's description and
  requirements travel; explicit notice; key and request only
  from Rust; no calls on start, typing or navigation.
- Structured output (`text.format` with a JSON schema, v1
  template) and authoritative Rust validation (at most 8
  proposals and 5 questions).
- One simultaneous generation per module, no retries, no
  locks during the network, with visible model and tokens
  and distinguishable errors.
- v2 persistence with a migration preserving v1:
  generations, proposals and their state; computed expiry
  blocking accept.
- Atomic and idempotent acceptance as an AI draft, with no
  invented dependencies; human approval stays intact.
- Tests with a fake generator and fixtures, no network or
  real key.

Still working: milestone-4 persistence, milestone-3
requirement space, milestone-2 core and the connection test.

## Previous milestone (milestone 4, done)

Reliable local persistence with SQLite: versioned schema,
atomic mutations validated before saving, validating startup
with a recoverable error, serialized writes and detected
second instance.

## Previous milestone (milestone 3, done)

Define and review requirements from the UI, with `ruth-core`
as the only domain authority: Tauri boundary (`ruth-api` +
`core_*` commands), requirement space with editor and
review, Zustand only for selection and panels, and a
temporary in-memory session (now superseded by persistence).

## Previous milestone (milestone 2, done)

Core of artifacts, versions, dependencies and approvals in
Rust, independent of Tauri, React, Meta and storage. See
[architecture](arquitectura.md).

## Previous milestone (milestone 1, done)

Desktop base and minimal real connection test with Meta:

- Minimal Tauri 2 + Rust + React + TypeScript + Vite
  structure, created from scratch.
- Initial UI with brand, description, connection status and
  a **Test connection** button.
- Minimal Meta Model API call from Rust with distinguished
  error handling and without exposing the key.
- Browser notice that the native test requires Tauri.
- Documentation, `.gitignore` and an initialized Git repo,
  without publishing.

## Out of scope for this milestone

Coming stages, not implemented: screenshot import and
interpretation, HTML or framework export, running a backend,
real SQL or authentication, and a Figma-equivalent editor.
Also out: individual archiving or deletion of designs and
mockups (they only archive by module context), attribute
types, per-attribute requiredness and FK (outside the design
subset; the editor offers name and PK mark), mockup style
editor, Figma import, per-screen-state variants, canvas
minimap, collaborative editing, automatic change execution,
automatic code writing without accepting, editing proposals
inside the dialog, backend/SQL generation, multi-screen
batches, compiling or running the analyzed project, LSP,
debugging, visual Git integration, advanced refactoring
(including automatic refactoring from the diagram),
diagram↔code or mockup↔code two-way sync, import
resolution, full-repo analysis, AI architecture explanation,
automatic architecture analysis, creating/deleting/moving/
renaming files from Ruth, repo import, multiple agents
(inside Ruth; the terminal does allow running external
agents), remote sync, publishing and deployment. Also out:
`.ruth/` sync (only the v1 portable contract exists),
AI-inferred links, loading snapshots into the diagram, and
rebuilding requirements from code.

Note: the integrated terminal IS implemented (see
[architecture §17](arquitectura.md)), as are automatic
per-module update proposals (stage A, opt-in). What does not
exist is automatic execution of changes on the artifacts.

## Transparency note on earlier work

Before the event there was an earlier exploration under the
names Atelier / Ruth IDE. Declared here transparently: **its
code has not been read, copied or reused** in this repo.
Everything in this folder was created from scratch during the
hackathon for the Indie category.
