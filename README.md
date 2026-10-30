# Ruth IDE — Design and code as perspectives of one project

Visual workspace turning requirements into linked design
artifacts. When a rule changes, it identifies affected
dependencies and proposes adjustments for a person to review.

This milestone unifies Design and Code as perspectives of the
same project: associated roots, module↔path and
artifact↔symbol links with evidence, and snapshots of the
detected analysis, with one local truth (schema v12) and
`.ruth/` only as a future portable contract. Built on the
detected structure, the code workspace, mockups and live
design. Opening code never requires creating requirements; AI
never invents correspondences. See
[docs/alcance-hackathon.md](docs/alcance-hackathon.md) for the
competition scope, [docs/decision-diseno-vivo.md](docs/decision-diseno-vivo.md)
for the decision, [docs/decisiones.md](docs/decisiones.md) for
the record, [docs/continuidad.md](docs/continuidad.md) to resume
work and [docs/arquitectura.md](docs/arquitectura.md) for the design.

> Confirmed data is stored in `ruth.db` inside the application
> data directory (Linux: `~/.local/share/ide.ruth.app/`;
> macOS: `~/Library/Application Support/ide.ruth.app/`;
> Windows: `%APPDATA%\ide.ruth.app\`). Unsaved drafts still
> live only in memory and do not survive closing.

## Requirements

- Node.js 18+ (tested with Node 24) and npm.
- Stable Rust (tested with 1.97) and Cargo.
- On Linux, Tauri 2 system dependencies (see the
  [official prerequisites](https://v2.tauri.app/start/prerequisites/)):
  `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`,
  `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
- A Meta Model API key (only for the real test; see below).

## Install

```sh
npm install
```

## Run

Development web UI (no native commands: the test will report it
requires Tauri):

```sh
npm run dev
```

Desktop app (compiles Rust and opens the native window):

```sh
npm run tauri dev
```

Production web build:

```sh
npm run build
```

## Environment variables (without leaving the key in history)

The test reads **only** the native process environment. Never put
the key as a command-line argument or in repo files.

Recommended option (the key stays out of history and screen):

```sh
read -rsp 'META_API_KEY: ' META_API_KEY && export META_API_KEY && echo
```

Variables:

| Variable      | Required | Effect                                              |
| ------------- | -------- | --------------------------------------------------- |
| `META_API_KEY`| Yes      | Meta Model API key. Without it there is no request. |
| `META_MODEL`  | No       | Model to use. Default `muse-spark-1.3`.             |

Then launch, in the same session:

```sh
npm run tauri dev
```

When done, you may clear the variable with `unset META_API_KEY`.

Notes:

- `read -s` does not echo what you type and, since the key never
  passes as an argument, it stays out of `~/.bash_history`.
- Never use `export META_API_KEY=sk-...` directly: the key would
  land in history.
- There is no `.env` file: the frontend reads no environment and
  the backend only reads the process one.

## What was implemented (density and window)

- Compact density: radii and spacing at 50%, borders at 1 px,
  −2 px type with a 12 px floor. Canvases, nodes, terminal and
  interaction areas intact.
- Window without a native bar: header controls (minimize,
  maximize/restore, close with red only on hover), dragging
  from free space and double click to maximize. Closing warns
  about drafts (save all, close without saving, cancel) and
  respects the active-terminals brake.

## What was implemented (assistant and header)

- Header: brand + context on the left; save state, Export
  (compact, mint border) and the ⋯ menu (with Connection) on
  the right.
- Real per-document state: no document, unsaved changes
  (amber), saving, saved or error with retry; separate counter
  for others with drafts. Edits made during a save survive the
  earlier result; re-typing the saved content clears; layout
  never presents as a semantic change.
- Exporting with drafts opens an honest gate: save all and
  continue, export the saved, or cancel. The package only
  includes persisted versions.
- Meta Assistant: right column with Review/Assistant tabs
  (resizable, hideable), visible context, three explicit
  actions reusing the existing flows, bounded on-demand
  history and a composer. No classifier: the text only feeds
  Propose requirements.

## What is implemented (delivery A: function → evidence → open)

- Inspector promoted to the top-level maps: file boxes show
  symbols, Used by/Uses, unresolved, externals and out-of-scope,
  per root diagram (see [docs/architecture-map.md](docs/architecture-map.md)).
- Symbol selection with evidence: kind, line range, decorators,
  incoming/outgoing relations with kind, resolution status and
  evidence text; relation targets navigate in place or across
  files; members expand and open at their container (no own
  ranges in the IR, honestly labeled).
- Hash-verified "Open in code" in both maps and the Structure
  view (shared `verifiedOpen.ts`): match jumps to the range,
  change/unreadable opens the file with a notice. Opening from
  the top-level Map lands in Code with the tab open.
- Limits: maps re-run when returning to the perspective (no
  incremental analysis yet); analyzer caps per root analysis;
  TypeScript only in maps.

## What is implemented (top-level project maps)

- New **Map** perspective: the selected project shows one automatic
  diagram per associated folder — no scope picking. Needs a project,
  not a module (see [docs/architecture-map.md](docs/architecture-map.md)).
- Eye toggle per root (tree rows and diagrams, session-only); hidden
  roots are skipped, analyzed maps are cached across toggles.
- Breadth-first TypeScript collection per root (200 files / 2000 dirs
  caps, backend exclusions apply), same worker, layers and lane
  rendering; truncation, unreadable files, per-root errors with retry
  and draft warnings are all labeled.
- Step 1 shows the diagram; inspector, layer filters and search stay
  in the code-area Map for now.

## What is implemented (architecture map, TypeScript)

- New **Map** mode in the code area: analyzes the shared scope and draws
  layered file boxes with their connections (see
  [docs/architecture-map.md](docs/architecture-map.md)).
- Documented path-based layer taxonomy (UI, controllers, state,
  services, contracts, composition, cross-cutting, unassigned) with
  decorator refinement; per-file rule shown in the inspector.
- Analyzer additions: static import resolution, class decorators, `new`
  as `instantiates`, constructor-parameter references, TS `enum`
  extraction. Strict rules kept: nothing unverifiable is connected.
- Inspector with members, incoming/outgoing edges, unresolved refs,
  externals and code navigation; layer/search filters, stale-scope and
  draft warnings, explicit truncation notices.
- Piloted headless against a real NestJS+Angular project (268 files).

## What was implemented (structure replication as modules)

- "Replicate structure as modules" in each root's menu: preview of
  the base's child folders (suggested `src/app`, `src`, or the root
  when there is no `src`; editable), with previous links,
  policy-excluded ones and truncation/over-cap notices.
- New target (name = root folder, editable, no AI) or existing one;
  only checked folders (max 50 per replication).
- Atomic creation: project + empty modules + association + manual
  links, or nothing. Idempotent per folder: already-linked items
  are reported, never duplicated.
- After replicating, the project opens with its first module; the
  tree shows a folder chip and an "Open in code" jump.
- No migration (schema v14) and no Meta calls.

## What was implemented (living code diagrams)

- Structure with Classes/Data/APIs tabs: OOP per side, syntactic
  data (interfaces, structs, enums; not an ER) and front↔back
  unions by method+path (joined, exposed-but-unused,
  consumed-but-undefined, external and ambiguous).
- Bounded and documented detection: Express/Hono + fetch/axios in
  TypeScript; Actix + Axum + reqwest in Rust. Static literals;
  outside a subset nothing is drawn.
- "Propose code" from a saved requirement or screen + scope:
  context preview, generation with Meta, current↔proposed diff
  per file, accept (safe, with fingerprint; creating never
  overwrites, modifying requires the fingerprint) or discard;
  earlier ones consultable.
- Re-analyzing after accepting compares against the opening and
  shows which symbols, relations, endpoints, calls and unions
  changed; tabs and the tree refresh on their own.
- v13 persistence (`cgen-N`): exact context, proposed contents
  and per-file state, with migration from v12.

Walkthrough: open an existing frontend+backend as a project →
analyze → see unions and unused → add a requirement → propose
code → accept → re-analyze → close/reopen.

## What was implemented (unified perspectives)

- `Code` as a central perspective next to Requirements, Design,
  Impact and Mockups: same selection, same drafts and one
  shared terminal. No exclusive switch or empty features.
- Project from folder (⤴ in the explorer): creates the project,
  names it after the folder, adds it to the workspace and links
  it, warning when a step fails. Link/unlink per root from its
  menu (◈ badge); removing never deletes files.
- `link-N` links (schema v12): manual module↔path ones from the
  active tab; detected artifact↔symbol ones from Structure with
  id, range and source hash. No links without a project;
  archived ones are consult-only; removing roots or deleting
  with links blocks with the count.
- Computed freshness by re-reading the file (never persisted
  flags); per-file snapshot verification
  (`fresh`/`stale`/`missing`/`error`).
- `snap-N` IR snapshots (without contents): save, list, verify
  and delete; read-only, they create no dependencies.
- Per-module traceability: which artifact uses which code and
  what stays unlinked, with computed freshness; "unlinked"
  never judges and only covers saved snapshots.
- v1 portable contract (`PortableExport`) for the future shared
  `.ruth/`: no writing or syncing in this milestone.

## What was implemented (code structure)

- Explicit scope: loose files or a bounded folder (direct
  children), up to 20 files; never the whole repo. A notice
  when there are drafts: what is analyzed is the on-disk
  saved content.
- TypeScript with the real AST (`ts-compiler@5.9` in a deferred
  Web Worker): classes, interfaces, functions and components
  (capital in `.tsx`, marked heuristic), `extends`,
  `implements` and references; partial on syntax errors.
- Rust with `syn` (`code_analyze_rust`, same read caps):
  structs, enums, traits and `impl` (`impl Trait` as
  `implements`, methods to the single type); per-file errors
  hiding nothing else.
- Strict global-uniqueness resolution: repeated → ambiguous,
  missing → unresolved; no imports or jumps across languages.
  The unverified lives in the inspector with its evidence.
- Deferred React Flow diagram (zoom, pan, selection, fit),
  visually-draggable cards, legend, per-type filters, search,
  inspector and caps with notice (300/500/50).
- Verified navigation: re-reads and compares the FNV-1a
  fingerprint (identical in TS and Rust); when it changed, it
  opens without jumping, marks stale and offers to recalculate.

## What was implemented (code workspace)

- Several local roots per workspace (`root-N`, native dialog),
  persisted in SQLite (schema v11, v12 since unification)
  without credentials or content. Removing never deletes; the
  missing one is marked with a clear error. Without merging
  repos; since unification they link explicitly to projects
  (no invented relations).
- On-demand explorer: excludes `.git`, `node_modules`,
  `target` and `dist`; 500-entry cap with notice; context menu
  (open file, terminal here, remove). No create/delete/move or
  rename yet.
- Rust confinement (`ruth-code`, no dependencies): root ID +
  relative path; rejects escapes and links. Not a terminal
  sandbox (documented).
- UTF-8 reading up to 256 KiB with binary and over-size
  rejection; tabs per root + path with visible disambiguation.
- Editing with Monaco 0.57 (MIT) in a deferred chunk: one
  model per tab, 13 selectable highlightings (JSON with a
  local service; TOML as INI), Ctrl+F search and an honest
  fallback when it fails to load. Highlighting is not
  language analysis.
- Safe saving: fingerprint per read; external change →
  explicit compare, reload or replace; atomic temp-file +
  rename write with preserved permissions; draft intact on
  failures. Ctrl+S saves the active tab (inside the terminal
  it stays with the PTY); closing, removing and quitting
  confirm; save-all includes files.
- "Open terminal here" in the shared panel (limit 3, no
  `META_*`, same lifecycle); frontend and backend at once.
- Editor presentation (phase 1): Ruth theme, optional
  minimap, breadcrumb with reveal, per-type icons, status
  bar, keyboard tabs and real diff on conflicts; visual-only
  preferences. No LSP or global search yet.

## What was implemented (mockups as the main input)

- Propose screens with Meta from saved requirements (selection
  or whole module, no mandatory approval): context preview,
  draft warning, at most 3 screens per request, each takable
  as a new and idempotent mockup.
- Extended model: containers, own-catalog icons, declarative
  validations, stateful actions, typed tables with preview,
  per-screen states. Earlier content reads intact; layout
  stays separate.
- Editor: duplicate with new IDs, align, optional grid,
  semantic inspector, undo/redo and Ctrl+S. No third-party
  HTML or JS.
- Design from mockups: flow/ER quote `mockup/component` to
  show what motivates them; technical attributes only with
  justification; updates preserve the manual ones.
- Screens in the module tree (derived, never duplicated) with
  the active screen preserved across perspectives. Migration
  to schema v10; export and historical baselines intact.

## What was implemented (live design, stage B)

- Versioned mockups: stably-identified screens; text, field,
  select, button and table components; layout separate from
  semantics (moving never versions); per-field declared source
  (persisted, computed, temporary, external or undefined).
- Visual editor: Mockups view with palette, canvas and
  inspector; zoom, undo/redo, Ctrl+S, guiding validation and
  authoritative validation in Rust, and read-only historical
  versions.
- Design from mockups: mixed requirement + mockup sources
  (readable summary, no positions) with Meta; reuses design
  proposals, diff and atomic acceptance. Generating from
  mockups alone flags the missing instead of inventing
  certainties.
- No new migration (schema v9) and export including the
  in-scope mockups as JSON plus a summary; byte-identical
  historical baselines.

## What was implemented (live design, stage A)

- No approval barriers: generating and updating start from
  saved versions; "stale" means "needs syncing". Identities,
  exact versions, provenance and conflicts intact.
- Central Ctrl+S (and Save button) to the active editor:
  requirement, flow, data or mockup. No changes create no
  versions; a failure preserves the draft; late responses
  never switch the document.
- Local derived views without API; opt-in per-module auto-AI
  (off at start): 2.5 s debounce, one run per module, at most
  5 proposals per cycle, no recursion, to separate proposals.
- Work/draft deliveries (`entrega-N`) with pinned titles,
  visible pendings and obsolete sources, exportable to a
  reproducible ZIP (schema v9). Baselines stay intact and
  come out byte-identical. The Deliveries dialog opens on
  "Work".

## What was implemented (renaming)

- "Rename" action in the tree "…" menu (projects, modules,
  requirements and diagrams) and in the requirement and
  diagram detail: small dialog with the current name,
  Save/Cancel and Enter/Escape.
- Non-empty names up to 120 characters; duplicates allowed
  (identity is the ID). Expected review with `stale_name`
  rejection; no renaming archived items without restoring.
  No HTML or paths from titles.
- Titles with person-signed history; without its own title,
  the UI derives the first line without touching the domain.
  Renaming invalidates no reviews, creates no impacts and
  loses no drafts.
- New baselines capture the current titles; historical ones
  keep theirs and export without consulting `latest`
  (schema v8). Project/module names are neither pinned nor
  exported.
- Visible names in tree, breadcrumb, headers, selectors,
  inspectors, impact map and baselines, with the ID as
  secondary or tooltip. The historical table distinguishes
  pinned and current title.

## What was implemented (archiving and deletion)

- "…" menu on modules and requirements with archive, restore
  and permanently delete; prior advisory summary (content,
  dependents inside/outside the module, baselines,
  generations) and explicit confirmation with the name.
  Execution revalidates in Rust.
- Reversible archiving: hides from active lists ("Show
  archived" toggle), preserves versions, approvals,
  dependencies, baselines and generations, and blocks edits,
  generations and approvals until restored. History stays
  consultable.
- Deletion only when nothing mentions it: empty modules
  without generations or baseline scope; draft requirements
  without approvals, dependents, baselines or mentions. No
  cascades; when something references it, it blocks and
  recommends archiving (schema v7).

## What was implemented (milestone 10)

- Interactive canvas with React Flow (loaded on demand, only
  when opening the editor): cursor-centered wheel zoom, drag
  panning, zoom-in/out/fit/center-100% buttons with announced
  percentage, element selection and moving, drag or keyboard
  connections, and read mode on historical versions.
- Data editor: entities, attributes (name and PK) and relations
  with cardinalities via inspector and consequence-showing
  delete confirmations. Flow editor: steps, decisions,
  start/end, branch labels, requirement quotes and notices
  without forbidding cycles. Only what the contract
  represents: no per-attribute types, requiredness or FK.
- Elevated draft with semantic undo/redo and immediate
  guiding validation; saving as a new human version
  (`core_save_design_version`) with expected version, current
  declared sources and layout in the same transaction, or
  layout-only (`core_save_design_layout`) with no semantic
  changes. No inherited approvals, with Impact recalculation.
- Work protection: the draft survives tabs, navigation asks
  save/discard/cancel, conflicts keep the draft separate and
  approval blocks with pending edits. Reopening preserves
  content and layout (schema v6).

## What was implemented (milestone 9)

- **Export** button in the header with a wide deliveries
  dialog: **Prepare delivery** tab (in-scope module, eligible
  artifacts, preview with exact versions, dependency closure,
  approvals, concrete blocks and out of scope) and **Baselines**
  tab (listing with detail and historical export).
- Advisory preparation without mutations: creation revalidates
  in Rust inside the transaction and, when the project changed
  since the preview, reports the conflict without creating
  another delivery (`changed_since_preview`).
- Explicit human creation with optional name and description:
  stores identity, format, project, scope, date, exact
  versions, dependencies, approvals and provenance. Later
  changes never alter the baseline; the listing flags whether
  the project moved on.
- Reproducible ZIP built with local code, no AI: `README.md`,
  `specification.md`, versioned `manifest.json` with per-file
  SHA-256 (the manifest excludes itself to avoid
  self-reference), `artifacts/` with the original content,
  `diagrams/` with Mermaid from the existing serializer and
  `implementation-context.md` without an invented stack or
  decisions. No keys, SQLite, chats or discarded proposals.
- Reproducibility: only from the baseline (never `latest`),
  stable order, safe ID-derived paths, size/count limits and
  normalized ZIP metadata (same baseline + exporter = same
  bytes). Hashes verify integrity; they are not a digital
  signature.
- Safe saving: native dialog to pick the target (`tauri-plugin-
  dialog` plugin, no general writing to the frontend),
  canceling writes nothing and reports no success,
  confirmation before replacing, temp file and atomic rename
  with cleanup on failures. Creating the baseline and saving
  the ZIP are separate and distinguishable steps.
- v5 persistence with a transactional and idempotent migration
  from v1–v4 (`baseline_meta` table without FK, like
  generations and designs); the historical baseline exports
  even when no longer current. Fixed the child→parent delete
  order in full saves (with real baselines, emptying
  `projects` before `baselines` violated the FK).

## What was implemented (milestone 8)

- **Propose update** action in a pending design's inspector:
  snapshot preview (target, current design, sources with both
  versions, source change, paths and blocks), explicit
  generation for one design at a time, and review with
  comparison.
- Honest blocks before generating: no generation without
  approved sources; when a design source stays stale, it must
  be updated first (the chain resolves in order, skipping no
  stages).
- Same generation system (never duplicated): same output
  schema, validation and Mermaid; the registry also pins
  target and version, and acceptance requires both unmoved
  plus approved current sources.
- Comparison: switchable current/proposed diagrams,
  deterministic structural diff (added, removed and modified
  nodes/edges or entities/attributes/relations), old and new
  sources, explanation and questions. The explanation never
  replaces the diff.
- Proposal JSON editor with revalidation, re-render and
  re-diff; edits preserved across navigation. Accepting
  creates a version of the same artifact with AI provenance
  and exact sources: atomic, persisted and idempotent,
  without inheriting approval. Discarding blocks later
  accepting.
- When the design or a source changes during generation or
  review, the proposal is preserved stale, its acceptance
  blocks and a regenerate is offered; no failure leaves a
  created version with a pending proposal.
- Impact distinguishes "pending approval" (sources current)
  from "needs review", recalculates on accept and preserves
  the other pendings.
- v4 persistence with a transactional migration from
  v1/v2/v3 (target columns); on reopen, proposals recover
  with their diff.

## What was implemented (milestone 7)

- Impact query (`core_impact_report`): source requirement and
  version, comparison with an eligible earlier version, direct
  and indirect dependents, used vs. current sources,
  explanatory paths and computed status (current, needs
  review, historical approval). `ruth-core` computes it all;
  the query neither mutates nor persists anything.
- **Impact** tab next to Requirements and Design: header with
  requirement and change, Before/Now comparison, dependency
  map, paged artifact table, right inspector and derived
  unique-pendings counter.
- Own read-only SVG graph (no new dependencies): selection,
  zoom, fit to content, deduplicated nodes with every path in
  the inspector, explicit truncation at 60 nodes with the full
  table aside, and text plus icons besides color. No dragging
  that modifies dependencies.
- Honest states: a historically approved design shows its
  approval and its staleness together; the already-updated
  stays related but not pending. No checkboxes that
  "resolve" the impact: only a new reviewed version lifts it.
- Inspector with real actions: View differences (the
  artifact's own history), Open design/requirement
  (navigation with draft protection) and View sources (pinned
  vs. current). No chat or faked repair.
- Recalculation after saving versions, accepting or approving
  designs; late responses filtered per query; map context
  preserved when returning to the tab; zoom is ephemeral and
  never persists.

## What was implemented (milestone 6)

- Mockup-inspired layout: dark theme with mint and amber
  accents, compact header with project/module and collapsible
  connection, panel rail, left with modules and artifacts
  (requirements + designs), center with Requirements/Design
  views, right with generation, sources and review, and a
  status bar with saving. No React Flow and no faking the
  impact map.
- Per-module and per-type design generation: flow or ER
  selector, approved-requirement selection with context
  preview, independent per-type buttons and a Meta-send
  notice. Never regenerating on navigation.
- Initial structured subset validated in Rust (`ruth-meta`):
  flow with `start|step|decision|end` nodes and edges; ER
  with entities, attributes and `1|0..1|N|0..N`
  cardinalities; references inside the sent set. A flow cycle
  is valid; never confused with the core's forbidden cycles.
- Local Mermaid rendering with a deterministic serializer and
  escaped labels (the model injects no HTML or scripts),
  on-demand loading and `securityLevel: strict`. Diagram,
  read-only source, sources, explanation and questions show;
  valid syntax never guarantees design correctness.
- Review with a validated JSON editor: editing revalidates
  and renders while keeping the last valid result; "Accept as
  draft" creates the artifact (`flujo-N`/`mer-N`) or a new
  version with the expected version, atomic and idempotent,
  without approving. Approving requires human confirmation,
  validated and rendered content, and revalidation in Rust.
- Exact dependencies on the versions used; obsolete sources
  block acceptance and the core computes the pending review
  after accepting. Late responses filtered per module.
- v3 persistence with a transactional migration from v1/v2
  (generations, proposals and design provenance); atomicity
  domain → database → UI and one simultaneous generation per
  module, as in milestone 5.

## What was implemented (milestone 5)

- Per-module assisted generation: "Describe the module" field,
  preview of the context to send, "Propose requirements"
  button and a notice that the content travels to Meta. Only
  the module's description and current requirements are sent;
  nothing of files, secrets or other projects.
- Structured output verified against official docs: Responses
  API with `text.format` (`type: "json_schema"`), v1
  instruction template asking to flag ambiguities and never
  to invent decisions as approved.
- Authoritative Rust validation: fields, types, non-empty,
  unique temporaries, at most 8 proposals and 5 questions;
  the invalid or incomplete is rejected without creating
  artifacts. One simultaneous generation per module, no
  retries, with timeout, input/response caps and
  distinguishable errors (key, billing, rate limit, timeout,
  incomplete, invalid).
- Persistent generation registry (schema v2, transactional
  migration preserving v1 databases): identity,
  project/module, model, description, exact context versions,
  template, usage and questions.
- Computed expiry: when a source changes, the generation is
  flagged stale and its acceptance blocks until regenerating.
- Atomic and idempotent acceptance as a draft with AI
  provenance (`accept_ai_draft`, no sources, no approval);
  final app ids and later human approval unchanged.
- UI: generation panel with editable proposals, separate
  questions and per-proposal actions; saved ones consult on
  returning to the module. In a browser it notes that
  desktop is required.

## What was implemented (milestone 4)

- Local SQLite persistence (`ruth-store`, adapter separate
  from the domain): versioned v2 schema with a transactional
  and idempotent migration, validating load at startup and
  full rewrite per mutation (O(database size) cost, fit for
  hackathon volume).
- Every mutation is atomic: validate with the core → persist
  in a transaction → publish the state; success is never
  reported before saving (`ruth-api::transact`).
- Degraded startup: when the database is corrupt, uses a
  future schema or cannot open, the app shows a recoverable
  error without deleting or replacing anything
  (`core_status`).
- Writes serialized off the UI thread (actor with a dedicated
  thread) and a detected second instance with a clear error.
- UI: "Local persistence active" banner with save state
  (local draft / saving / saved / error); the draft is
  preserved when saving fails.
- The core revalidates everything on load
  (`Store::reconstitute`): duplicates, membership, cycles,
  sources, version order, approvals and baselines.
- No keys, drafts or panel selection are stored.

## What was implemented (milestone 3)

- Requirement space with an IDE layout: browser (projects,
  modules, requirements), central editor and review panel
  with history.
- Create project and module; create requirements; edit as a
  local draft; save new versions; consult earlier ones
  read-only; confirm the review and approve the current
  version with explicit human authorship.
- Tauri boundary over `ruth-core` (`ruth-api` + `core_*`
  commands): Tauri-managed in-memory state, serializable
  DTOs and stable errors. The core still has no Tauri,
  Serde, clock or network.
- Zustand only for shared selection and panel visibility;
  drafts in local state and authoritative snapshots from
  Rust.
- In-memory work protection: temporary-session notice,
  save/discard/cancel dialog on unsaved drafts, and draft
  preservation on concurrency errors.
- In a browser it reports that core operations require
  desktop; no saving or approval is faked.

## What was implemented (milestones 1–2)

- Tauri 2 desktop window with a React + TypeScript + Vite UI.
- Ruth IDE brand, product description and connection panel
  with `not configured / checking / available / error`
  states and an explicit **Test connection** button.
- Native `test_meta_connection` command: a single `POST` to
  `https://api.meta.ai/v1/responses` with the exact request
  `Responde solo: Ruth IDE listo`, `max_output_tokens: 64`
  and a 30 s timeout. No calls at startup, no retries and a
  single simultaneous test.
- Response returned as text + model + token usage (when the
  API provides it). No invented costs and no raw-response
  dumps.
- Distinguished errors: missing key, authentication (401),
  billing (402), forbidden (403), rate limit (429, with
  `Retry-After`), missing model (404), server (5xx), network
  and timeout.
- `meta_status` command: local read of key presence and
  model, no network.
- In a browser it reports that the native test requires
  Tauri; no proxy or simulation.
- Rust tests for the protocol and errors with fixtures,
  without real consumption (`src-tauri/crates/meta`).

## Integrated terminal

Bottom panel with up to three real shell sessions (PTY via
`portable-pty`, xterm.js presentation): fits shells,
programming agents like `$HOME/.local/bin/muse`, local
servers and Git. Icon at the rail foot; hiding preserves
sessions and scrollback. Each session has a name, state and
own icons for clear (view) and close; the global bar gathers
new terminal, toggle tabs/side-by-side, folder and hide. Side
by side, resizable splitters with a minimum width and marked
focus; switching layout loses no output and restarts nothing.

- **Permissions**: the terminal runs with your user
  permissions. It is not a sandbox nor confined to the
  initial folder: documented, never promised otherwise.
- **Environment**: the child inherits your environment
  **minus** the `META_*` family (including `META_API_KEY`):
  no inference Ruth knows about crosses into the terminal,
  and no secret is written to Ruth's logs, SQLite or
  history. When your shell loads credentials from your own
  configuration (`~/.bashrc` and friends), Ruth cannot stop
  it.
- **Lifecycle**: clearing only wipes the view; closing asks
  for confirmation with a running process and ends it;
  closing Ruth with open terminals asks for confirmation and
  never restores processes on reopen. Nothing terminal-
  related persists.
- **Limits**: three sessions; evented output in 8 KiB chunks
  with 2000-line scrollback per view; pastes in 60 KiB
  pieces (256 KiB cap per write); Ctrl+C interrupts (PTY),
  Ctrl+Shift+C/V copy/paste, Ctrl+S inside the terminal is
  the PTY's XOFF (never saves the editor). Windows compiles
  the same code but is unverified here. In a browser, the
  panel notes it requires desktop and fakes nothing.

## What is pending (out of this milestone)

Automatic change execution, rendered images or PDF in the
export, AI impact analysis, code generation, LSP, debugging,
visual Git, refactoring, creating/deleting/moving/renaming
files, repo import, multiple agents, remote sync, publishing
and deployment. Also out: `.ruth/` sync, AI-inferred links,
loading snapshots into the diagram and rebuilding
requirements from code. Unsaved drafts (including the module
description and proposal, design, mockup and file edits)
still have no protection against window close or process
failure: only what is confirmed in Rust reaches disk.

## Key decisions

- **Modular monolith per feature**, no microservices or ORM.
- **Independent domain**: the frontend separates pure types
  (`types.ts`) from the Tauri adapter (`tauri.ts`); the
  backend separates the `ruth-meta` crate (contract +
  protocol + errors) from the Tauri commands.
- **State**: Zustand only for shared selection and panels;
  drafts in local React state and domain snapshots served by
  Rust.
- **Meta behind a small contract**: `MetaConfig::from_env()`
  and `test_connection()`, with endpoint and model verified
  in the official docs (`https://dev.meta.ai/docs`):
  Responses API and `muse-spark-1.3`.
- **The key never crosses to the frontend**: it only lives in
  Rust process memory (`SecretString` with redacted `Debug`),
  with no logs or files.

## Verification

```sh
npm test                                    # frontend coordination (vitest)
npx tsc --noEmit                            # frontend types
npm run build                               # production web build
npx tauri info                              # Tauri environment diagnostics
```

Rust commands run from `src-tauri/` (where the Cargo
workspace lives):

```sh
cd src-tauri
cargo test --workspace                      # full Rust (no real network)
cargo clippy --workspace --all-targets      # lints
cargo fmt --check                           # formatting
cargo check                                 # full Tauri app (needs system deps)
```

Real Meta calls only fire with the **Test connection**,
**Propose requirements** and **Generate flow/ER** buttons
inside the desktop app. Automated tests never consume the
API.

Manual case (perspectives, no network): ⤴ in the explorer →
pick Ruth's folder → check the named project and linked root
(◈ badge) → **Code** perspective → open a file → back to
**Requirements** with a module → link the active tab →
**Structure** → analyze and link a symbol to an artifact →
save a snapshot → edit the file outside → verify the
snapshot (stale) → **Traceability** → check linked, unlinked
and orphans → close/reopen → check associations, links and
snapshots.

Manual case (structure, no network): **Code** perspective →
open Ruth's folder → `model.ts` menu → **Add to the
analysis** → repeat with `CodeTree.tsx` → **Analyze
selection** → check cards, one relation and the legend →
click `CodeTree` → **Open in code** (jumps to its range) →
edit the file outside → reopen the symbol → check the stale
notice → **Recalculate** → add a `.rs` file and check
struct/impl.

Manual case (code, no network): **Code** perspective →
**Open folder** (frontend) → **+ Add folder** (backend) →
expand and open the same name in both (disambiguated in the
tab) → edit → Ctrl+S → check Saved in the header → **Open
terminal here** in each root → change a file outside Ruth →
Ctrl+S → **Compare**, **Reload** or **Replace** →
close/reopen → check roots, closed tabs and content.

Manual case (assistant, with `META_API_KEY` set): open the
Assistant tab → check context and the drafts notice → pick
Propose requirements → Send a description → review the fed
field and generate → accept a proposal → pick Generate flow
→ mark sources and generate → accept the draft → open
Impact with a source → back to the assistant → Propose
updating an affected design → compare and take in → expand
the history and check model, tokens and pendings.

Manual case (screens, with `META_API_KEY` set): user-signup
requirements → **Mockups** view → **Propose screens**
(review context and save drafts when there are any) → take
a screen in → add a field, button and icon → define actions
and data source → Ctrl+S → **Generate design** with
requirements and mockup → review `mockup/component` quotes
and questions → close/reopen → check persistence and export
a work delivery.

Manual case (stage B, with `META_API_KEY` set): **Mockups**
view → create a "New booking" screen → add customer, product
and quantity fields plus a Confirm button → Ctrl+S →
**Generate design** from the mockup (add requirements by
hand when needed) → review the flow and ER proposal → edit
a field → Ctrl+S → open **Impact** → take the update in
with no mandatory approval → close and reopen → check
mockup, history and sources → export a work delivery and
verify the ZIP carries the mockup JSON plus its summary.

Manual case (renaming, no network): "…" menu of an untitled
requirement → check its first line shows → Rename → set a
title → check tree, header and inspectors → create a
baseline → rename again → open the historical detail and
check pinned vs. current title → export the ZIP and compare
headers and `manifest.json` → rename project and module
from the tree → close and reopen → check everything
persists.

Manual case (archiving, no network): create a draft
requirement → "…" menu → Delete permanently (empty summary,
confirmation with the name) → check it is gone → create
another, individual archive → check it hides → "Show
archived" → restore it → archive the module → check honest
empty lists and blocked editing → restore.

Manual case (milestone 10, no network, from already-approved
designs): open a design → **Canvas/Editor** tab → drag, wheel
zoom and buttons (fit, 100%) → move elements and check no
semantic "unsaved" appears → add a step/attribute with the
inspector, undo/redo → **Save version** → check human
provenance without inherited approval → reorder positions
only → save layout → close and reopen → check content and
positions.

Manual case (milestone 9, no network): create sales
requirements, flow and ER and approve them → **Export** →
**Prepare delivery** → pick artifacts → **Create baseline**
A → change the booking rule and approve it → prepare again
and check the stale-sources block → update, review and
approve flow and ER → create baseline B → **Save ZIP** of B
with the native dialog → also export A and check it keeps
the earlier versions → open the ZIPs and compare
`manifest.json` with `sha256sum`.

Note for the milestone 6–8 cases: they were written when
generating required approving. Since live design, review is
optional: the "approve" steps may be skipped and the
walkthrough stays valid.

Manual case (milestone 8, with `META_API_KEY` set): approve
sales requirements, flow and ER → change and approve the
booking rule → open **Impact** → **Propose update** of the
flow → compare diagrams and diff → **Accept as draft** →
review and approve → check the ER stays pending → update
the ER the same way → close and reopen → check history,
sources and proposals.

Manual case (milestone 7, no network): create and approve
sales requirements → generate and approve flow and ER →
change the rule to "Reserve units before confirming;
canceling frees the reservation" → open **Impact** →
check pending designs with old sources → review a design
and create another version → check its pending disappears
while the other continues.

Manual case (milestone 6, with `META_API_KEY` set): approve
sales requirements → **Design** view → select sources →
**Generate flow** → review diagram and JSON, edit when
needed → **Accept as draft** → approve from Review →
repeat with **Generate ER** → close and reopen → check
diagrams, sources and history.

## Transparency

Before the event there was an earlier exploration (Atelier /
Ruth IDE) whose code **has not been read or reused** in this
repo: all code here was created from scratch during the
hackathon. See
[docs/alcance-hackathon.md](docs/alcance-hackathon.md).
