# Architecture — Ruth IDE

## 1. Horizon

**Full vision.** Visual workspace covering the whole cycle:
requirements → design → architecture → implementation →
verification → code review, with linked artifacts, impact on
changes and human approval.

**Competition goal.** A reduced but complete walkthrough:
requirements linked to flow and ER → rule change → impact →
proposals → review → export (review is optional since live
design, §15; approved export still requires a coherent
baseline).

**Current milestone (unified perspectives).** Design and Code
as perspectives of one project: linked roots, module↔path and
artifact↔symbol links with evidence, and snapshots of the
detected analysis. See [scope](alcance-hackathon.md) and §22.
(The previous milestone, code structure, stays in §21.)

## 2. Architecture

Modular monolith with an independent core and adapters at the
boundaries:

- **Core (`ruth-core`, Rust).** Authority for versions,
  dependencies, approvals and baselines. Independent of Tauri,
  React, Meta and storage. Reads no clock, environment, files
  or network.
- **Meta adapter (`ruth-meta`, Rust).** Small contract behind
  which the real Meta Model API calls live: connection test
  and structured generation with authoritative validation in
  Rust.
- **Tauri commands (`src-tauri`).** Boundary between the
  desktop and Rust.
- **Boundary (`ruth-api` + `core_*` commands).** Serializable
  DTOs, stable errors, identifiers and dates generated outside
  the domain. Atomic mutations via `transact` (validate →
  persist → publish), always through use cases, never
  duplicating rules. The core still has no Tauri or Serde.
- **Persistence (`ruth-store`, Rust).** SQLite adapter separate
  from the domain: versioned schema, actor with a dedicated
  thread and validation before every write. The core knows no
  SQLite; the adapter validates no rules, only reads and
  writes verbatim.
- **Code (`ruth-code`, Rust).** Workspace roots, path
  confinement, file listing and reading/writing. No Tauri or
  SQL. See §20.
- **Terminal (`ruth-term`, Rust).** Real PTY sessions
  (`portable-pty`) with dedicated reader threads, Rust-
  generated IDs and a secret-scrubbed environment. See §17.
- **React (`src`).** Workspace (tree, center with
  Requirements/Design/Impact/Mockups/Code perspectives,
  review, assistant and a single terminal): presents
  authoritative Rust snapshots and keeps local drafts.
- **Zustand.** Only shared selection (project, module,
  requirement or design), central perspective and panel
  visibility, with specific selectors.

Dependency rules: the core knows nothing of Tauri, React,
Meta or SQLite. Adapters call the core, never the reverse.

## 3. Core: model

Entities (`crates/core/src/domain/model.rs`):

- **Project and module**, explicitly identified. The module
  organizes; it does not isolate: dependencies may cross
  modules of the same project.
- **Artifact**: stable identity and type (`Requirement`,
  `Flow`, `DataModel`, `Mockup`; the latter since §16).
- **Immutable version**: identity, consecutive number,
  non-empty textual content, provenance and exact sources.
- **Provenance**: human author or AI proposal.
- **Dependency**: derived version → exact version of a
  source. Only generation dependencies, no cycles. No
  semantic relations in this milestone.
- **Approval**: exact version, human author and supplied date.
- **Impact report**: affected artifacts and justifying paths.
- **Baseline**: coherent set of approved versions for future
  export; immutable and reproducible.

Use cases (`crates/core/src/application/store.rs`, in
memory): create project, module and artifact; create version;
accept AI draft; register sources when creating the derived
version; compute validity and impact; approve; create
baseline.

**Human provenance is not authentication.** That a version or
approval records a human author is domain data; identity
control will live at the corresponding boundary (Tauri/UI),
not in the core.

## 4. Core: invariants

These rules belong to the domain and still hold. The live-
design decision ([decision](decision-diseno-vivo.md), §15)
does NOT relax them: what changed is that generating,
saving, updating and delivering drafts no longer require
prior approval. Where this old document said "you must
approve to…", read "review is optional unless stated".

- An edit creates a new version; history never changes.
- A new version inherits no approvals; historical ones are
  never deleted.
- Review (approve) still requires a current and valid
  version, human authorship and explicit confirmation:
  those are the review action's own rules, not a barrier to
  generating, saving or delivering drafts.
- An AI proposal cannot approve itself: only people approve.
- Accepting AI content takes it in as a draft; it never
  equals approving it.
- Dependencies with exact versions, never "latest".
- Missing references, cross-project links and cycles are
  rejected.
- A generation with old sources is preserved but computes as
  not current; to approve, a reviewed version with current
  sources must be created. Re-approving the stale
  derivative is not enough.
- Validity computes from dependencies; there are no stored
  flags.
- Recalculating validity or impact modifies neither versions
  nor approvals.
- Impact is transitive and includes the dependency paths.
- Sensitive operations receive the expected version and
  reject changes when it is no longer current (optimistic
  concurrency).
- An approved baseline requires approved, current and
  source-closed entries; once created, it stays immutable
  even as the project moves. The work/draft delivery (§15)
  is a separate concept and never inherits that requirement.
- On error there are no partial mutations: everything
  validates before mutating.

## 5. Decisions

- **Zero dependencies in `ruth-core`**: no async, no serde, no
  clocks. Identifiers and dates arrive as inputs.
- **Explicit types and domain errors** over ambiguous strings.
- **No traits, injection containers or empty modules**: the
  design does not need them in this milestone.
- **Registering sources = creating the version that declares
  them.** Since versions are immutable, exact sources pin at
  each version's creation; there is no "attach sources later".
- **Draft = version without approval.** No extra state: it
  derives from the recorded approvals.
- **The Sales example** (`crates/core/tests/sales.rs`) is the
  milestone's verifiable test, without calling Meta.

## 6. Persistence (milestone 4)

Minimal contract (`crates/store/src/lib.rs`): the stored unit
is the full snapshot (`Snapshot` + `next_id`); each mutation
rewrites the database in one transaction (O(size) cost,
enough for hackathon volume). Identities, versions, sources,
approvals and baselines persist verbatim: identifiers and
dates are never regenerated on load.

- **Location.** `ruth.db` in the Tauri-resolved data
  directory (`app_data_dir`): Linux
  `~/.local/share/ide.ruth.app/`, macOS `~/Library/Application
  Support/ide.ruth.app/`, Windows `%APPDATA%\ide.ruth.app\`.
  Never the repo or fixed paths; development `*.db` files are
  excluded in `.gitignore`.
- **Schema.** v12 in `schema.rs`, with `user_version` and
  transactional idempotent migrations: v1 base; v2
  requirement generations; v3 design generations; v4 target
  columns; v5 `baseline_meta`; v6 `design_layouts`; v7
  `archived` flags; v8 names and title history; v9 work
  deliveries; v10 screen-proposal tables; v11 `code_roots`
  table; v12 `code_roots.project_id` column + `code_links`
  and `structure_snapshots` tables (+ persisted `next_id`
  counter for generations, roots, links and snapshots).
  Each migration preserves earlier databases intact. It
  stores no keys, drafts or selection (nor file contents).
- **Atomicity.** `transact` clones in memory, validates with
  the core, persists in a transaction and only then publishes;
  `IdGen` uses checkpoint/restore to never advance on
  failures.
- **Startup.** Load and revalidate with `Store::reconstitute`
  (every §4 invariant, plus closed Baselines and intact
  approvals); empty state only on a fresh install. On
  corruption, a future schema or a read error, `core_status`
  exposes a recoverable error and the app opens in degraded
  mode without deleting or repairing anything.
- **Concurrency.** One in-process `Mutex`, one dedicated
  thread with a single connection, `IMMEDIATE` transactions
  and a persistent `EXCLUSIVE` lock: a second instance gets a
  clear error instead of corrupting the database. Locks are
  never held during network (core commands do no network and
  Meta commands never touch this state).
- **UI.** "Local persistence active" banner with
  draft/saving/saved/error state; the draft survives failures
  and unsaved-change warnings stay. An unsaved draft does not
  survive closing.

## 7. Assisted generation (milestone 5)

Per-module flow: describe → context preview → generate →
editable proposals + questions → individually accept or
discard.

- **Privacy.** Only the description and the current versions
  of the active module's requirements travel (with
  deterministic caps); the UI shows what will be sent and
  warns it goes to Meta. Key and request only in Rust; no
  calls on start, typing or navigation.
- **Structured output.** Responses API with `text.format`
  (`type: "json_schema"`, verified at
  `https://dev.meta.ai/docs/structured-output`) and a v1
  template asking to flag ambiguities and never to invent
  decisions as approved. Authoritative validation is
  `ruth-meta`: fields, types, non-empty, unique temporaries,
  at most 8 proposals and 5 questions. The rest is rejected
  without creating artifacts.
- **Execution.** One simultaneous generation per module
  (in-memory mark), 90 s timeout, `max_output_tokens` 4096,
  256 KiB body cap, no retries. The command snapshots the
  context, drops every lock during the network and records
  after. Model and tokens visible when the API provides
  them; no invented prices. Distinguishable errors: key,
  billing, rate limit, timeout, incomplete and invalid.
- **Registry.** Each generation persists identity (`gen-N`),
  project and module, model, description, exact context
  versions, template, usage, questions and proposals with
  state. No keys, headers or raws.
- **Expiry.** Computed when served: some source changed →
  stale generation, linked to its original context, with
  acceptance blocked until regenerating. Nothing current is
  discarded or overwritten.
- **Acceptance.** Final app ids; the core's `accept_ai_draft`
  with agent `ruth-gen/{model}`, no sources (context is not
  a dependency) and no approval; canonical content composed
  from the edited and revalidated fields. Atomic (domain +
  state in one transaction) and idempotent (retrying returns
  the existing).
- **UI.** Separate `proposals` feature (panel, coordination,
  adapter): local drafts, Rust snapshots, per-module mounting
  (late responses never touch another module) and querying
  the saved ones on return. Zustand stays for shared
  selection only.

## 8. Requirement-linked design (milestone 6)

Per-module and per-type flow: select saved requirements →
generate flow or ER → view, review and edit the JSON →
accept as a draft with exact dependencies → optional human
review. (In milestone 6 the sources had to be approved;
since live design, stage A, current saved versions are
enough: see §15 and
[decision](decision-diseno-vivo.md).)

- **Layout.** Mockup-inspired composition (dark theme,
  compact header, mint/amber): panel rail, left with modules
  and artifacts (requirements + designs), center with
  Requirements/Design views, right with generation, sources
  and review, and a status bar with saving. No React Flow
  and no faking the impact map.
- **Initial subset.** Bounded JSON: flow with nodes
  (`start|step|decision|end`, identity/type/label) and edges
  (source/target/optional label); ER with entities
  (name/attributes with optional key) and relations (ends
  and `1|0..1|N|0..N` cardinalities). Per-element
  requirement references, always inside the sent set. A flow
  cycle may be valid; the forbidden cycles are only the
  core dependency-graph ones.
- **Validation.** Authoritative in `ruth-meta` (`design.rs`):
  types, limits, unique identifiers, existing references,
  admitted cardinalities and set membership. The stored
  content is the canonical JSON; Mermaid derives with a
  deterministic serializer that escapes labels (no HTML,
  scripts, directives or model links).
- **Rendering.** Local, no API: on-demand Mermaid with
  `securityLevel: strict`, validated syntax and contained
  errors that never break the app. The UI shows diagram,
  read-only Mermaid source, sources, explanation and
  questions, clarifying that valid syntax never guarantees
  design correctness.
- **Review.** Editing revalidates and re-renders, keeping the
  last valid result. "Accept as draft" creates the artifact
  (`flujo-N`/`mer-N`) or a new version with the expected
  version, atomic and idempotent, without approving.
  Approving requires human confirmation, no pending edits,
  validated and rendered content, and revalidating validity
  and current version in Rust.
- **Dependencies.** Exact to the versions used. Source
  changed during generation → stale proposal with blocked
  acceptance; after accepting → the core computes pending
  review. Late responses filtered by module and mount key.
- **Persistence.** v3 schema with a transactional migration
  from v1/v2: generations, proposals and design provenance;
  atomicity domain → database → UI and one simultaneous
  generation per module, as in milestone 5. Key only in
  Rust; model and tokens visible with no invented costs.
- **UI.** Separate `design` feature (types, client,
  coordination, panel, detail, diagram): local drafts, Rust
  snapshots and per-module mounting. Zustand adds the
  selected design and the central view.

## 9. Impact map (milestone 7)

Change a requirement and see the real impact, with no Meta
calls: the core already computed affected items, validity
and paths; this milestone only exposes and visualizes them.

- **Query.** `ruth-api::impact_report` + `core_impact_report`
  command (read with a short lock, no `transact`): source
  with a Before/Now comparison (eligible base, the previous
  one by default), affected items with `requires_review`
  negating the core's validity, used-vs.-current pins, the
  current's approvals + `approved_before`, and full paths.
  Deterministic and mutation-free.
- **Distinctions.** Dependency (recorded relation), impact
  (the change reaches through it) and staleness (the current
  one uses old sources): an updated design stays related but
  not pending, and a historically approved design shows both
  at once.
- **View.** Center Impact tab + right inspector: header with
  requirement and versions, Before/Now, graph, paged table
  with the full total and a derived unique-pendings counter.
  Entering is a pure view switch (touches neither selection
  nor drafts); leaving and navigating use the usual
  protection.
- **Graph.** Own read-only SVG in `src/features/impact`:
  deterministic layered layout (`layout.ts`, tested),
  click and keyboard selection, wheel/button zoom and fit to
  content; no React Flow (oversized) and no Mermaid (no
  selection/zoom). 60-node cap with an explicit notice;
  dragging only pans the view.
- **Inspector.** Why it is affected (every path, navigable),
  pinned vs. current sources, the artifact's own
  differences (real history) and opening the
  design/requirement. No chat or faked repair.
- **Freshness.** Recalculation after saving, accepting or
  approving; late responses filtered by query key; context
  (source, base, node) in the workspace to preserve it on
  return; ephemeral zoom never persisted. No redundant
  impact flags anywhere.

## 10. Updating pending designs (milestone 8)

From Impact to the reviewed draft, with no second system:
update proposals live in the same table and cycle as
creation, additionally pinning the target and its version.

- **Snapshot.** `update_context_preview` (advisory) and
  `snapshot_update_context` (authoritative, `update_blocked`
  when there are reasons): target with its current design,
  sources with used and current version plus contents,
  source change, paths and blocks. The source set is
  preserved and its versions updated. (In milestone 8 a
  current unapproved source blocked; since live design,
  stage A, review is informative and existing current
  sources are enough: see §15. The stale intermediate
  updates first: skipping no stages.)
- **Generation.** `core_propose_design_update` command with
  the same discipline as creation (snapshot, per-module
  mark, lock-free network, later registry): tweak prompt
  (`build_update_input`, v1 update template), same
  `text.format` schema, same limits and timeout. When the
  target or a source moves during the network, the proposal
  is born stale and cannot be accepted.
- **Comparison.** Pure `core_design_diff` over two validated
  specs: added/removed/modified nodes, edges, entities,
  attributes and relations, deterministic order; changed
  IDs are add+remove, never invented equivalences. The UI
  switches current/proposed diagrams (local safe Mermaid),
  shows the diff, the old and new sources, explanation and
  questions, and clarifies that the explanation is not
  evidence.
- **Acceptance.** Same `accept_design`: over the same
  artifact and snapshot version, snapshot sources still
  current and valid (approval stopped being required in
  stage A); AI provenance, no inherited approval; atomic
  (domain + proposal in one transaction) and idempotent;
  discard blocks. Disk failure = nothing half-done.
- **Impact.** After accepting it recalculates from the core:
  "pending approval" (sources current, no current approval;
  since stage A presented as optional review: "up to date",
  "unreviewed", "obsolete sources") differs from "needs
  review" in table, inspector and graph; the other pendings
  persist. Elevated JSON edits to the workspace so they
  never get lost navigating; late responses filtered by
  target.
- **Persistence.** v4 schema: target columns in
  `design_generations` (null on creations), transactional
  and idempotent migration from v1/v2/v3, v3-tolerant load
  and target-reference verification. On reopen, proposals
  resume with their diff.

## 11. Approved baseline and reproducible export (milestone 9)

Closing the competition walkthrough: from the approved to a
verifiable delivery, with no AI along the way. Everything
exportable comes from the baseline, never from `latest`.

- **Preparation.** `prepare_baseline` (advisory, no
  mutations): selection inside a module, transitive closure
  over exact current versions, approvals, provenance and
  concrete blocks (`draft`, `stale_sources`, `stale_expected`,
  `missing_sources`, `not_in_scope`), plus the out of scope.
  It never promises an approved project when the scope is a
  module.
- **Creation.** `create_baseline` revalidates
  `changed_since_preview` and delegates coherence to the
  core (`Store::create_baseline`); the actor persists domain
  + metadata in one transaction and the API publishes after.
  No partials: on conflict or incoherence, memory, disk and
  IDs stay intact. The listing computes `advanced` by
  comparing with the current versions.
- **Metadata.** `baseline_meta` table (v5 schema,
  transactional and idempotent migration from v1–v4): name,
  description, scope module and date. No FK toward the
  domain —same pattern as generations and designs—, with
  verification on load. Coherence still lives in the domain
  tables.
- **Package.** `build_export_files` resolves each entry
  against the pinned version: README, `specification.md`,
  `manifest.json` (`ruth-baseline-export` v1, with per-file
  SHA-256 except the manifest itself), verbatim
  `artifacts/`, `diagrams/` via the existing Mermaid
  serializer (unstructured content = a comment pointing at
  the original, never an invented diagram) and
  `implementation-context.md` with no invented stack or
  decisions. No keys, SQLite, chats, raw responses or
  discards.
- **Reproducibility.** Stable order, names from sanitized
  IDs, safe relative paths, limits (500 artifacts, 1
  MiB/file, 16 MiB total) and a ZIP with fixed date,
  permissions and compression: same baseline + exporter =
  same bytes, verified across processes.
- **Saving.** `core_export_preview` (content-free inventory)
  and `core_export_save` commands (native-dialog target,
  `tauri-plugin-dialog` with `dialog:default` permission and
  no general writing to the frontend): exists + no
  confirmation = `export_exists`; sibling temp-file write
  and atomic rename with cleanup. The state lock releases
  before touching disk; canceling never reaches the
  command.
- **UI.** Header Export button and a wide dialog with
  Prepare/Baselines tabs: create and save ZIP as separate
  actions, an error naming which artifact to review, late
  responses filtered per query and a desktop notice in the
  browser.

Fixed along the way: full saving emptied `projects` before
`baselines` (child→parent FK); with real baselines the
second save failed. Never noticed because the table stayed
empty until this milestone. Covered by
`repeated_saves_keep_baselines_and_meta`.

Competition walkthrough completed: requirements linked to
flow and ER → rule change → impact → proposals → approval →
export.

## 12. Visual design editing (milestone 10)

Interactive canvas to edit flows and ER models without
leaving the milestone-6 subset. The structured JSON stays
authoritative; the canvas is a derived editable view, and
Mermaid stays as a derived view and source for consulting,
approving and exporting.

- **Technology.** React Flow (`@xyflow/react` v12) for both
  editors, in deferred chunks (`DesignEditor` + `DesignCanvas`,
  with their CSS) downloaded only when opening the
  canvas/editor tab. No own interaction engine was built;
  the impact graph (read-only SVG) stays because it needs no
  editing. Decision documented here as the frontend's first
  big interaction dependency.
- **Semantic/presentation split.** `specModel.ts` (pure, no
  React): tolerant parsing, canonical serialization with
  the same key order as Rust, total operations
  (create/rename/delete nodes, edges, entities, attributes
  and relations) and deterministic automatic layout
  (breadth layers in flows, grid in ER). Positions live in
  `Layout`, apart: moving, zooming or panning never touches
  the spec (covered by tests).
- **Bounded honest subset.** The editor offers exactly what
  the contract represents: entities with name/attributes
  (name + PK mark) and relations with cardinalities.
  Attribute types, requiredness and per-attribute FK are NOT
  represented (outside the subset) and hence absent from
  the UI; documented in the inspector and here, without
  widening the contract in this milestone.
- **Elevated draft.** The draft (spec + layout + undo/redo
  history capped at 50 + pins) lives in the workspace with
  `useReducer`, not in the canvas: it survives tab switches.
  Undo/redo covers semantic changes only, with Ctrl+Z/Ctrl+Y
  outside fields. Deletions with consequences (edges,
  attributes, relations) ask for explicit confirmation; the
  canvas delete key is disabled on purpose.
- **Two-level validation.** Guiding in the frontend
  (`specValidation.ts`, documented mirror of the Rust caps,
  with structural notices that never forbid valid cycles)
  and authoritative in Rust on save. Errors block saving;
  notices do not.
- **Versioned manual saving.** `core_save_design_version`:
  creates a version of the SAME artifact with human
  provenance (never AI), no inherited approval, with
  expected version and explicit declared sources that must
  exist and be current; obsolete ones block naming
  artifacts (`design_stale_sources`) and the person adopts
  the current ones explicitly. Traceability to the source
  generation persists through the version chain + the
  existing registry (no new table). Layout travels in the
  same transaction; on reorder-only,
  `core_save_design_layout` saves layout alone without
  creating empty versions. Approval still requires explicit
  review and Rust revalidation, and blocks with pending
  edits.
- **Persisted layout.** `design_layouts` table (v6 schema,
  transactional idempotent migration): positions per
  artifact and version, sanitized on save and tolerant on
  read (an unreadable row equals "no layout", never breaks
  opening). Pure presentation: outside the domain, validity
  and export.
- **Navigation and guard.** Switching tabs never loses the
  draft; leaving the design with changes (semantic or
  layout) opens the save/discard/cancel dialog, chained
  after the requirement one when both are dirty. A version
  conflict reloads the current one and keeps the draft
  separate with its JSON to decide. Saving recalculates
  Impact like any other mutation.
- **Canvas.** Cursor-centered wheel zoom (0.2–2×),
  background dragging, zoom-in/out/fit/center-100% buttons
  with percentage (live region), element selection and
  moving, connection creation by drag or with equivalent
  keyboard forms, and read mode for historical versions
  (browse and select, never edit). Verification finding:
  the initial fit waits for measured nodes (dimensions flow
  back to the controlled prop) and runs once; neither the
  `fitView` prop nor a blind `onInit` works, because they
  race measuring and steal the user's zoom.

## 13. Reversible archiving and safe deletion

Lifecycle management for modules and requirements (designs
only archive by module context), plus safe deletion of
empty projects. Rules live in `ruth-core`; the UI
summarizes, confirms and respects; Rust revalidates on
execute.

- **Model.** Reversible `Module.archived` and
  `Artifact.archived`. An artifact's effective archived
  state is its flag or its module's, computed on every
  query (no redundant flags). Archiving a module never
  touches individual files; restoring it never restores
  them.
- **What the core blocks.** Creating artifacts in archived
  modules; new versions, AI drafts and approvals over
  effectively-archived items; approving versions with
  archived sources (`ArchivedSource`, before validity:
  restoring may suffice); baselines with archived entries
  or sources. Everything reaches designs, proposals and
  deliveries because those paths reuse the same use cases.
- **Generations.** Nothing generates over archived items:
  contexts exclude archived requirements and `record_*`
  revalidates the module (it may have archived during the
  network). Accepting into an archived module fails in
  `create_artifact`. The baseline and update previews show
  honest blocks (`archived`, `archived_source`,
  `target_archived`, `source_archived`); the update
  snapshot already failed with blocks, so protection is
  authoritative there too.
- **Deletion.** Only without references: the core requires
  zero approvals, zero dependents from other artifacts and
  zero baselines (typed errors naming what blocks) plus an
  empty module; the API additionally requires zero mentions
  in generations (own, context, acceptance, target) and
  never being baseline scope. No silent cascades, no
  disabling foreign keys, no history rewriting: when
  something references it, it blocks and recommends
  archiving. Drafts created by accepted AI are never
  deleted (their proposal references them): they archive.
- **Prior summary.** `core_archive_preview` is advisory:
  content, dependents with their module (inside/outside),
  named baselines, generations with role, approvals and
  versions, plus `can_delete` with blocks. Execution
  revalidates everything inside the same critical section
  as the mutation.
- **Project deletion.** `Store::delete_project` only
  removes projects without modules (active or archived);
  the API (`delete_project_checked`,
  `core_delete_project` command) additionally requires
  zero linked folders (`delete_has_roots`: unlink first),
  zero baselines, zero deliveries and zero generation
  mentions. The summary (`kind: "project"`) lists the
  modules and the blocks; projects never archive (there is
  no "archive instead"). No cascades: a project with
  content empties module by module. After deleting, all
  selection and the impact source clear.
- **Code links (§22).** Archiving invalidates no sources
  and breaks no links: `link-N` items persist and consult
  the same. What does block is creating new links over
  effectively-archived items (restore first) and final
  deletion with links (`delete_has_code_links`, with count,
  also in the prior summary). Removing a root with links
  blocks the same (`code_root_has_links`): unlink first, no
  cascades.
- **Persistence.** v7 schema: `archived` columns defaulting
  to 0 (idempotent migration; the existing stays active).
  Saving and loading carry the flags; a non-0/1 value
  rejects as tampering without overwriting. Archive,
  restore and delete go through `transact` (validate →
  persist → publish).
- **UI.** "…" menu per row, session "Show archived" toggle,
  badges and dimmed rows, honest empties ("No requirements
  (2 archived)"), dialog with summary and explicit
  confirmation with the name. Archived items consult
  (history, generations, diagrams) but never edit,
  generate or approve. With a dirty draft, the
  save/discard/cancel dialog precedes the summary (chained
  requirement→visual); after deleting, incompatible
  selection clears; on failure everything persists; late
  responses ignore by epoch. Historical baselines stay
  consultable and exportable. The context menu only offers
  what is implemented: Delete (+ Rename) for projects,
  Rename-only for designs and mockups (their individual
  archiving does not exist; they archive by module
  context).

## 14. Renaming projects, modules, requirements and diagrams

Organizational names (project, module) and metadata titles
(requirement, diagram). Renaming touches no IDs, rules,
sources, relations or content: it invalidates no approvals
and creates no impacts. Identity is the ID; duplicates are
allowed and disambiguated with context or ID.

- **Model.** Validated `Name` (trimmed, non-empty, ≤120
  characters). The title lives in `Artifact.title`
  (`Option`, separate from content) and its history in
  `TitleChange { artifact, title, by, at }` (human
  signature). Without its own title, the UI derives the
  first line as presentation, without touching the domain
  or calling AI.
- **Concurrency.** Every rename receives the expected
  revision (`expected_name` / `expected_title`, `None` =
  still untitled) and Rust rejects with `stale_name` when
  it changed outside. Archived items never rename without
  restoring (`Archived*`, before anything else).
- **Baselines.** On creation, each entry pins the current
  title (`Baseline.titles`, `title_of`); historical ones
  are immutable and never consult `latest`. New ones
  capture the current names. Export uses the pinned title
  in `specification.md`, `implementation-context.md` and
  `manifest.json` (`entries[].title`); file names still
  come from safe IDs. Project/module names never pin in
  the baseline and never export.
- **Persistence.** v8 schema: `name`/`title` columns and a
  `title_history` table (idempotent v7→v8 migration; the
  existing keeps ID as name and `NULL` as title). Saving
  and loading carry names and history; invalid values
  reject without overwriting. Everything goes through
  `transact` (validate → persist → publish).
- **UI.** "Rename" action in the tree "…" menu (all four
  types) and in the requirement and diagram detail. Small
  dialog with the current name, Save/Cancel, Enter/Escape,
  guiding validation and authorship for the title history.
  Renaming never asks to save drafts (touches no content)
  and loses none; on failure it keeps the earlier name and
  allows retrying; late responses ignore by epoch. Tree,
  breadcrumb, headers, selectors, inspectors, impact map
  and baselines show the name with the ID as secondary or
  tooltip. Finding: the historical-detail TS type was flat
  but Rust serves nested entries (empty cells at runtime);
  it realigned to nested and the historical table tells
  the pinned title from the current one.

## 15. Live design (stage A: saving without barriers)

Authorized product decision (see [live-design
decision](decision-diseno-vivo.md)): saving, generating and
continuing to design need no approval. Review is optional
and informative; AI never silently overwrites manual
content. Historical approvals and baselines keep their
original meaning: stage A never retroactively relaxes
their invariants.

- **Policy.** Generating and updating start from current
  saved versions, without requiring approval
  (`snapshot_design_context` replaces the old selection
  that asked for approval; the
  `not_approved`/`source_not_approved` errors were
  removed). "Stale" means "needs syncing", not forbidden.
  Still current: identities, exact versions, provenance,
  concurrency conflicts, structural validation and
  structural blocks (missing references, invalid content,
  disk errors).
- **Central Ctrl+S.** `resolveSaveTarget` (pure, tested)
  picks the active editor (requirement, flow or data;
  mockup arrives in stage B); the global shortcut and the
  Save button emit `saveSignal` and each editor saves
  through its transactional flow. No changes create no
  identical versions; a failure preserves the draft; late
  responses never switch the document. In dialogs, Ctrl+S
  does nothing but avoids the WebView dialog.
- **Derived views.** JSON → canvas/Mermaid/impact
  recalculates locally without API. AI self-updating is
  opt-in per module/session, off at start: 2.5 s debounce
  grouping saves (only the last pending one), one run per
  module, at most 5 proposals per cycle, from persisted
  versions, no recursion (its results never schedule
  another run). Results go to separate proposals in
  Impact; when Meta fails, the save still succeeds. Tokens
  shown when present.
- **Work deliveries.** New `WorkDelivery` (`entrega-N`)
  next to `Baseline`: scope, saved versions, optional
  reviews and identified staleness; never presented as
  "coherent" or "verified" (a test watches it). Titles
  pinned at creation, like baselines. ZIP export reusing
  the assembler (`ExportKind::{ApprovedBaseline,
  WorkDelivery}`): baselines come out byte-identical to
  before; deliveries add `kind: "work_draft"`,
  `stale_sources` and pending counts. v9 schema
  (`work_deliveries`, `work_delivery_entries`).
- **UI.** The Deliveries dialog defaults to "Work"
  (prepare/create/list/export) with an "Approved" mode for
  baselines. "Review" presents as optional; the Impact
  status tells "up to date", "unreviewed", "obsolete
  sources".

## 16. Mockups as first-class artifacts (stage B)

Person-drawn versioned drawings, on par with requirements,
flows and ER: with stable identity, versions, exact
sources, provenance and optional reviews (live design). A
mockup never presents as a real design: the view tells
draft from reviewed, and generating flow/ER from mockups
produces reviewable proposals, not truths.

- **Model.** `ArtifactType::Mockup` in core, store, API,
  export, impact and update. The authoritative content is a
  canonical JSON (`ruth-meta/src/mockup.rs`, tested
  contract): stably-identified screens and `text | field |
  selector | button | table` components. Documented caps:
  12 screens, 40 components, 24 options, 12 columns, 8
  quotes per element; titles and labels bounded in
  characters. Component IDs unique inside the mockup.
- **Semantics vs. layout.** Position and size live apart, in
  `design_layouts` (generic, with optional `w/h`); moving
  or resizing never creates versions or touches reviews.
  The canvas uses the same epoch guards as the rest
  (`shouldApplyResponse`).
- **Source of each field.** Every field/selector declares
  its source: `persisted | calculated | temporary |
  external | undefined`. A visual field never implies a
  database column: nothing creates tables or attributes by
  assumption. Quotes to requirements and designs are
  informative (shown with excerpt), not core dependencies;
  generation dependencies, exact and cycle-free, declare
  apart and adopt explicitly.
- **Editor.** Mockups view with a small palette, canvas
  (deferred React Flow, declarative nodes without
  third-party HTML/JS) and inspector. Elevated draft with
  semantic undo/redo, guiding frontend validation and
  authoritative Rust validation, central Ctrl+S (semantic
  or layout-only depending on what changed) and
  confirmation when navigating with changes. Deleting with
  consequences asks for confirmation; renaming a component
  reassigns its layout. Historical versions consult
  read-only.
- **Design from mockups.** The design panel mixes saved
  requirements and mockups as sources; with mockups it
  uses `core_generate_design_from_mockups` (template
  `DESIGN_MOCKUP_TEMPLATE_VERSION=1`; the requirement one
  stays at `DESIGN_TEMPLATE_VERSION=2`). Mockups travel as
  a readable summary (screens, components, sources,
  quotes), no positions. From a mockup's detail the dialog
  opens with that mockup pre-checked; generating from
  mockups alone is also possible, flagging the missing
  information in questions and assumptions. Acceptance
  reuses the design-proposal circuit (same generations
  table, same diff, same atomicity); the proposal keeps
  its context and expires when a source changes.
- **Persistence.** No new migration: the schema stays at v9
  because `kind` is already free text and the version,
  layout, generation and delivery tables are generic.
  Earlier databases open intact; mockups save and recover
  with the same validate → persist → publish cycle.
- **Export and impact.** Deliveries and baselines include
  their in-scope mockups as authoritative JSON plus a
  readable summary (no invented diagrams); historical ones
  come out byte-identical. Impact derives links from the
  recorded exact sources, telling direct from transitive.

### 16.1. Mockups as the main design input (extension)

The structured mockup is authoritative. Image and HTML
will, in future milestones, be auxiliary representations or
inputs: never parallel sources of truth. Current decisions:

- A visual field never equals a column; a screen never
  equals an entity or class. The data source (`persisted |
  calculated | temporary | external | undefined`) declares
  per field and nothing creates tables, columns or entities
  by silent assumption.
- Saving needs no approval (live design). AI proposes
  screens; taking them in creates new artifacts and never
  overwrites manual changes or replaces existing screens.
- Neutral aesthetics: the editor prioritizes structure and
  behavior (hierarchy, actions, navigation, states) over
  visual style.

Extended model (`ruth-meta/src/mockup.rs`, authoritative
validation):

- `text | field | selector | button | table | container |
  icon` components. Containers group (ordered children,
  vertical/horizontal direction, no container nesting);
  icons use a bounded own catalog (stored id, the
  project's own, no third-party assets or arbitrary AI
  SVG).
- Field: logical name, type, requiredness, declarative
  validations (text list; the inherited `validation`
  accepts as one element) and an optional data reference
  (`artifact/element[.attribute]`) besides the quotes.
- Button/action-icon: declarative action (`navigate |
  submit | open_dialog | cancel | business`), optional
  operation or target, and state (`enabled | disabled |
  loading | error`). The inherited free action persists as
  a business operation.
- Table: per-column types, example rows for preview and
  row actions; it edits no real records.
- Screen: named interface states (informative list; no
  per-state variants in this milestone). Navigation
  between screens may cycle; generation dependencies stay
  cycle-free and separate from semantic links.
- Compatibility: earlier content reads intact
  (normalization in the parser, no version rewriting);
  layout stays in `design_layouts` and moving/resizing
  never creates versions.

Meta screen proposals: they reuse the existing consumption
(one generation per module, limits, timeout, no locks
during the network, provenance and computed expiry) with
own tables (`mockup_generations`, migration to schema v10)
because the payload is structured per screen, not
requirement text or a single design. Per request, at most 3
screens; each is individually taken in as a new mockup
(idempotent), with a context preview before sending and an
offer to save the relevant drafts. When sources change, the
proposal is born or stays stale and its acceptance blocks.

Design from mockups: flow/ER elements may quote
`mockup/component` (template
`DESIGN_MOCKUP_TEMPLATE_VERSION=2`), showing which fields
or actions justify each element. Technical attributes
(`created_at` and friends) only propose with justification
and never by default; updates preserve manual technical
attributes even when missing from the screen (template
`DESIGN_UPDATE_TEMPLATE_VERSION=2`).

## 17. Integrated terminal (real PTY)

Bottom panel with real shell sessions, for shells,
programming agents, servers and Git. Nothing is faked: when
something fails, it fails in view with its error.

- **Rust (`ruth-term`, `portable-pty`).** `TerminalManager`
  opens up to 3 PTYs with a dedicated reader thread per
  session (off the UI thread). Rust generates the IDs
  (`term-N`, monotonic); the shell (`$SHELL` or `/bin/sh`;
  PowerShell on Windows) launches as a process with
  program and arguments separated. The UI picks no
  programs: `term_create` only receives an initial folder
  and size.
- **Events.** Output travels over `ruth-terminal-output` in
  8 KiB chunks decoded to incremental UTF-8 (split
  multibyte recomposed, invalid replaced); ending over
  `ruth-terminal-exit` with the real code. Closing the
  window with running sessions holds the close
  (`CloseRequested` + `prevent_close`) and emits
  `ruth-terminal-close-requested`; `term_quit_app` kills
  the sessions and exits. All with minimal Tauri
  permissions (own commands + dialog).
- **Scrubbed environment.** The child inherits the
  environment minus the `META_*` family (`scrub_env`,
  tested pure and end to end with `env`). No secrets in
  messages, logs, SQLite or Ruth history.
- **UI (`features/terminal`).** xterm.js 6 + FitAddon per
  session, always mounted (hiding preserves scrollback,
  capped at 2000 lines); output enters xterm directly with
  no React state. Debounced resizing that notifies the PTY
  (`SIGWINCH`), pastes chunked at 60 KiB, Ctrl+S exempted
  inside the panel (it is the PTY's XOFF), copy/paste with
  Ctrl+Shift+C/V, initial folder via native dialog (open
  ones keep theirs) and confirmations to close a running
  session and to quit the app. Subscriptions use a
  collector that unsubscribes even what resolved after
  unmount (the cause of the duplicated prompt in dev).
  Tabs and side-by-side are the same structure with
  different CSS, with stable keys: switching never
  unmounts views or loses output.
- **Lifecycle.** Closing kills the child, waits for its end
  (~1 s max), reaps the thread and releases the PTY;
  clearing only wipes the view. Nothing terminal-related
  persists or restores on reopen.

## 18. Honest header and Meta Assistant

Presentation refinement without touching AI services,
proposals or persistence: saving and generating still need
no approval.

- **Per-document state.** Each editor publishes its state
  (`docStatus` in the store: `req/design/mockup:{id}` →
  dirty, saving, error, label). The header derives the
  active document from selection + view and counts the
  others apart; never a global flag. Reducers compare
  against the saved (re-typing it clears) and results
  carry generation/snapshot: edits made during a request
  survive the earlier result (in designs/mockups they stay
  marked as separate for the conflict, never lost).
- **Exporting with drafts.** With drafts, a gate explains
  that the package only includes persisted versions and
  offers save-all-and-continue (sequential, through
  transactional flows, inventing no authorship), export
  the saved, or cancel. No discards.
- **Meta Assistant.** Right column with Review/Assistant
  tabs (resizable with handle and keyboard, hideable;
  without it the center gains the width). Visible context
  (module, artifact, version) and a notice for drafts
  outside the context. Three explicit actions mounting
  the existing panels (proposals, design, update from the
  current impact report); used areas stay mounted to never
  lose ongoing generations or reassign proposals when the
  selection changes. Combined bounded history (8), on
  demand; a composer whose text only feeds Propose
  requirements (the other actions ignore it with a
  notice). No calls on open or typing; model and tokens in
  view.
- **Header.** Brand + context on the left; state, Save,
  Export (mint, with a visible reason when disabled) and
  the ⋯ menu (Connection) on the right; responsive
  without overlaps.

## 19. Compact density and undecorated window

Visual refinement without functionality, logic or
persistence changes.

- **Density.** Radii at 50% via tokens (`--r-xs/sm/md/lg`,
  2/3/4/5 px; the 999px/50%/0 idioms stay), spacing
  (padding/margin/gap) at 50% and borders already at the
  1 px minimum (tab indicators go from 2 to 1 px and the
  notice accent from 3 to 2 px). Canvases, nodes, handles
  and splitters keep their dimensions; buttons keep ≥ 24
  px areas.
- **Typography.** −2 px per category with a 12 px floor
  (whatever sat below rises to the minimum); body base at
  14 px, same line height. The terminal (13 px) and
  diagram zoom never change; tree titles keep a full
  tooltip.
- **Window.** `decorations: false` with an 880×600 minimum
  size. The header integrates
  minimize/maximize-restore/close after the ⋯ menu, with
  minimal permissions (`minimize`, `toggle-maximize`,
  `is-maximized`, `close`, `start-dragging`); close only
  tints red on hover. The drag zone is the context's free
  space (double click maximizes); buttons, fields and
  menus never drag. Closing goes through the drafts gate
  (save all, explicit close without saving, cancel) and
  then through the normal `close()`, which still holds on
  active terminals; no forced exits. In a browser there
  are no native controls.

## 20. Multi-folder code workspace

Open frontend and backend as roots of the same workspace,
browse files, edit them with safe saving and open
contextual terminals. Not a full IDE: no LSP, debugging,
visual Git, refactoring or code generation. Delivered in
two separately verified stages (A: opening and reading; B:
editing).

- **Model.** `ruth-code` (no dependencies): `CodeRoot`
  (`root-N`, absolute path, name) and an in-memory
  `CodeWorkspace`. Each root stands alone: no repo merging
  or assumed Git. The code workspace stays separate from
  design projects/modules (no automatic association).
- **Persistence.** `code_roots` table (v11 schema,
  idempotent migration): id, path, name and order. Only
  that: never credentials or content. Adding/removing
  persists before publishing (full rewrite in a
  transaction). When a folder no longer exists on reopen,
  it marks missing with a clear error and keeps the row.
- **Boundary.** `code_*` commands: roots, `code_list_dir`,
  `code_read_file`, `code_write_file`. The frontend sends
  root ID + relative path; Rust resolves. Bounded
  operations, no network or SQL under the lock.
- **Confinement.** `resolve_within` rejects absolute paths,
  escaping `..` and any symlink in the path (without
  following it). It is file-API confinement, NOT a
  sandbox: it never limits what the terminal runs
  (documented in the UI).
- **Reading.** On-demand listing (never the whole tree):
  excludes `.git`, `node_modules`, `target` and `dist` by
  name, stable order, 500-entry cap with notice. Files:
  UTF-8 up to 256 KiB; binaries (NUL in the first 8 KiB),
  invalid UTF-8 and over-size reject without overloading.
  Every read returns a fingerprint (size + modification;
  not a hash).
- **Safe writing.** Existing files only (never created).
  Except on explicit replace, the fingerprint must match
  or `code_conflict` without touching anything. Same cap
  and NUL rejection. Atomic: temp file in the same
  directory + rename, with cleanup on failures and the
  original's permissions preserved (Unix mode). Hard
  links: the rename replaces the entry, so other links
  keep the previous content (documented, not supported).
- **Editor.** On-demand Monaco 0.57 (MIT): `editor.api` in
  a deferred chunk (~2.7 MB outside the initial one) +
  lazy per-language grammars. One model per tab (keeps
  undo and position). Highlighting selector (not
  analysis): 13 entries; JSON brings Monaco's local
  service (highlighting + validation, own worker); TOML
  highlights as INI (no grammar in this version).
  Monaco's own Ctrl+F as local search. When Monaco fails
  to load, an honest text area as fallback.
- **Presentation (phase 1).** Own `ruth-dark` theme (token
  colors, inherited highlighting), optional minimap, line
  wrap, guides and pair colorization, optional sticky
  scroll, font size/line height and visible whitespace;
  all live via `updateOptions`, without recreating the
  editor or touching models. Visual-only preferences
  (`editorPrefs.ts`, validated) in WebView storage: never
  content or credentials.
- **Local navigation.** Root/folders/file breadcrumb
  revealing tree nodes without changing the selection;
  own per-type icons (tree, tabs, breadcrumb); status bar
  with cursor, selection, lines, UTF-8 and language
  selector; tabs with icons, keyboard (arrows/Home/End,
  roving tabindex) and scroll to the active one. The tree
  keeps expansions when reloading roots (selective prune
  + per-root epochs).
- **Conflicts.** Comparison with Monaco's real diff
  (read-only, side by side or inline per preference, with
  disposable temp models); when Monaco fails to load, it
  keeps the text comparison. No LSP, debugging, visual
  Git, refactoring, global search or quick open.
- **UI.** Separate Code area (header switch), always
  mounted but hidden: switching areas preserves tabs and
  drafts (since §22 it is the `Code` perspective, no
  switch). Tabs per root + path with visible
  disambiguation. Ctrl+S saves the active tab through an
  independent path (in the terminal it stays with the
  PTY). Conflicts: side-by-side compare, reload or
  explicit replace; the draft is never lost on its own.
  Closing tabs, removing roots and quitting Ruth confirm
  with drafts; save-all includes files. No creating,
  deleting, moving or renaming files yet.
- **Terminals.** "Open terminal here" creates a session
  with that `cwd` in the shared panel (never duplicating
  controls); open ones keep their directory. Same limit
  (3), lifecycle and `META_*` scrubbing.

## 21. Detected code structure

Structure view in the Code area (`Code` perspective since
§22): explicit file scope (or a folder bounded to direct
children), analysis with real parsers and an interactive
semantically-read-only diagram connected to the editor. It
runs no code and calls no external services; Meta never
steps in.

- **Contract.** One IR (`structureTypes.ts`) for both
  languages: symbols (stable id, language, type, name,
  file, 1-based range, members), relations
  (`extends`/`implements`/`references` with evidence) and
  files (fingerprint, bytes, state). Model separate from
  the domain: it creates no requirements, dependencies or
  approvals.
- **TypeScript.** `ts-compiler@5.9` (npm alias: the repo's
  7 is the native port without compiler API) in a deferred
  Web Worker (~3.5 MB outside the initial one), falling
  back to direct analysis without workers. Classes,
  interfaces, functions and components (capital in `.tsx`,
  marked heuristic), inheritance, `implements` and used
  types. Tolerates syntax errors (partial state).
- **Rust.** `syn` 2 with `span-locations` in `ruth-code`:
  `code_analyze_rust` reads the saved content (same read
  caps) and returns the IR. Structs, enums (variants as
  members), traits and `impl` (methods to the single type;
  `impl Trait` as `implements`, never as inheritance).
  `syn` tolerates no errors: the broken file stays in
  `error` without hiding the others.
- **Strict resolution.** A name only connects with ONE
  analyzed symbol; repeated → ambiguous, missing →
  unresolved. No import resolution or jumps across
  languages: the unverified lives in the inspector, not on
  the canvas. No inferred composition or lifecycle.
- **UI.** Visible scope with adds/removes, Analyze button,
  notice with drafts (the saved is analyzed), deferred
  React Flow diagram (zoom, pan, selection, fit;
  visually-draggable cards), legend, per-type filters,
  search, evidence inspector and file list with states.
  Caps: 20 files, 300 symbols, 500 relations, 50 members,
  with truncation notices.
- **Navigation.** Open in code re-reads and compares the
  FNV-1a fingerprint (identical in TS and Rust, shared
  vectors): when it changed, it opens without jumping,
  marks stale and offers to recalculate. Old ranges are
  never used as exact.
- **Out of this milestone.** Refactoring, two-way sync,
  import resolution, full-repo analysis and AI explanation
  (reserved as future inference).

## 22. Unified project: Design and Code as perspectives

One Ruth project links several code folders; modules
connect requirements, mockups, diagrams and files. Opening
existing code never requires creating requirements. It
replaces the header's exclusive Design/Code switch (§20):
now `Code` is one more center perspective, with the same
selection, the same drafts and the single shared terminal.

- **One local truth.** No duplicated project entities
  between workspace and domain: the root points at the
  project (`code_roots.project_id`, NULL = loose folder),
  never the reverse. Removing an association never deletes
  files; an unreachable folder shows missing without
  losing the project. No metadata writes into the repo.
- **Links.** `code_links` (`link-N`): manual module↔path
  ones (from the active tab) and detected artifact↔symbol
  ones (from the Structure inspector, with the analyzer's
  id, range and source hash as evidence). `inferred`
  exists as a reserved value and is never created; no
  name-match correspondences. One file may link to
  several artifacts. Archiving blocks linking (restore
  first); removing a root or deleting a module/artifact
  with links blocks with the count (`code_root_has_links`,
  `delete_has_code_links` in the archive preview).
  Freshness computes by re-reading and comparing the
  hash, never with persisted flags.
- **Snapshots.** `structure_snapshots` (`snap-N`): they
  store the analysis IR (files with source hash, symbols
  and relations), never the `content` key. Verifying
  compares each file with its source
  (`fresh`/`stale`/`missing`/`error`). Read-only: never
  loaded into the diagram, never creating dependencies.
- **Boundary.** `code_set_root_project`,
  `code_add_module_link`, `code_add_symbol_link`,
  `code_remove_link`, `code_list_links`,
  `code_project_links`, `code_save_snapshot`,
  `code_get_snapshot`, `code_list_snapshots`,
  `code_delete_snapshot`, `code_verify_snapshot` commands.
  Validation in `ruth-api::code_links`, atomicity
  validate→persist→publish, `resolve_within` confinement
  + real existence to link.
- **UI.** Project from folder (explorer ⤴: creates, names,
  adds and links, with notices when a step fails); ◈
  badge + link/unlink menu per root; the module's link
  panel at the center; in Structure, link symbol, the
  project's links with freshness and a snapshots section.
  No links without a project; "Open" jumps to the code
  perspective without touching drafts.
- **Split layout.** The left is contextual (projects in
  design, folders in code; both mounted, one hidden, to
  preserve expansion) and the center carries tabs +
  content (in code, only the editor). Tree and editor
  share ONE session via `CodeWorkspaceProvider`
  (`useCodeWorkspace.tsx` + `CodeTreePane`/`CodeMainPane`;
  `CodeWorkspace` stays as a composition for tests).
- **Traceability (`features/trace/`).** Perspective
  crossing the module's artifacts with explicit links and
  snapshot symbols: linked, unlinked and orphans, with
  derived counts and computed freshness. Pure model
  (`traceModel.ts`, 300-orphan cap with notice) + view
  with an injected backend. "Unlinked" never judges;
  unlinked code covers snapshots only, never the whole
  repo; stored ranges never jump (rangeless opening).
- **Future portability.** `PortableExport` v1 in
  `ruth-api::code_links` (roots, links and snapshots
  without contents or secrets; unknown version or invalid
  piece = rejection) defines the future shared `.ruth/`
  contract. In this milestone nothing writes or syncs:
  the local database stays the only authority.

## 23. Resizable windows, own icons and visible scope

Presentation refinement with no domain, SQLite-persistence
or analyzer changes: sizes surviving restart, one icon set
and the analysis folder one click away.

- **Sizes in the WebView, not in SQLite.**
  `useRequirementsUi` persists only four measurements
  (`ruth-ide:layout`, v1): `navigatorWidth`, `rightWidth`,
  `terminalHeight` and `terminalPaneWidths`.
  `validateLayoutPartial` returns the corrupt or
  out-of-range to null (= CSS default); storage tolerates
  environments without `localStorage`. No domain, drafts,
  selection or keys leave the process.
- **Handles in all four zones.** Left navigator in both
  contexts (projects and folders), right column
  (Review/Assistant), terminal height and splitters
  between side-by-side terminals. All with mouse and
  keyboard (arrows ±16 px / ±5%, Home = default) and a
  `separator` role with name and minimum/maximum; the
  center absorbs the rest.
- **Unified own icons.** `src/components/icons.tsx` +
  `fileIconNames.ts` hold the set: folders (open/closed),
  files per extension with a text badge, artifacts
  (project, module, requirement, design, mockup), state
  and wildcard. They are decorative (`aria-hidden`): the
  row text provides the accessible label. Every tree row
  carries its own (groups previously had none). Contract
  for future packs: same decorative, same gaps, no
  network or third-party assets; the row never depends on
  the icon to be understood. The whole set is own drawing
  (inline SVG), with no licenses to document.
- **Scope with a visible folder.** Structure adds "+
  Active folder": it lists the active tab's folder and
  adds its analyzable direct children
  (`.ts/.tsx/.mts/.cts/.rs`), up to the cap, never
  duplicating or descending into subfolders. The notice
  decision is pure and tested (`parentDir`,
  `folderScopeOutcome` in `model.ts`): full scope,
  folder without direct analyzables, or already included.
  With an empty scope, a three-step guide (add → analyze
  → open symbol) replaces the earlier paragraph.
- **Window map (audited).** `App` (header + export/close
  gates) → `RequirementsWorkspace`: panel rail,
  contextual left slot (projects/folders, both mounted),
  center with a perspective strip
  (Requirements/Design/Impact/Mockups/Code/Traceability),
  right column (Review/Assistant), full-width bottom
  terminal and status bar. The modal dialogs are:
  export/close gates (App), pending drafts, generate
  design, archive, rename and baselines. All but the
  drafts one close on outside click (with a `busy` guard
  where it applies); Escape only exists in
  generate/archive/rename. The drafts one demands an
  explicit choice to never lose work. Minor pendings
  found: the ⋯ menu never closes on outside click, no
  focus traps in modals, and the Review tab stays empty
  in Code (see [continuity](continuidad.md)).

## 24. Living code diagrams (APIs and proposals)

The Ruth project is born from existing folders
(frontend+backend); the diagrams show what was built and
AI proposes code that the person reviews file by file. Two
stages in one milestone: A (APIs and views) and B (code
proposals). v13 schema.

- **Extended IR, same authority.** `endpoints` and `calls`
  join files/symbols/relations in `structureTypes.ts`,
  `RsStructure` and the DTOs; the merge concatenates and
  snapshots accept the new keys (optional, capped at
  200/200) with no format migration.
- **Detection subsets (documented in each extractor).** TS
  (`tsAnalyze`, AST): `<obj>.<verb>('/…')` routes
  (Express/Hono shape, `all` included) and `fetch`,
  `axios.<verb>` and `axios({url,method})` calls with a
  literal or template URL (preserved `${…}`). Rust
  (`structure.rs`, `syn` + `visit`): Actix `#[verb("/…")]`
  attributes, Axum `.route("/…", get/post/…)` (multi-
  method strings included) and `reqwest::verb("…")`, plus
  `.verb("…")` with an unverified-receiver note. URLs by
  concatenation/variable, `app.route().get()`,
  `#[route(method=…)]`, `format!` and other clients: out,
  never drawn or invented.
- **Unions in one place (`apiLinks.ts`, pure).** The key is
  normalized method+path: uppercase, no query or trailing
  slash, dynamics (`:id`, `{id}`, `${…}`) → `{}`. `ALL`
  joins with any method on its path; one call joins with
  ONE endpoint (several = ambiguous, never connected);
  absolute ones (`http…`) = external, never the local
  back.
- **Structure view with tabs.** Classes (current diagram),
  Data (interfaces/structs/enums with members; syntactic,
  not ER) and APIs (joined, exposed-but-unused,
  consumed-but-undefined, external and ambiguous, with
  derived counts). Everything navigates with a verified
  fingerprint; honest empties and caps.
- **Propose code (stage B).** `ruth-meta::code`:
  `text.format` with a `code_proposal` schema (1–5 files
  with COMPLETE content, explanation, assumptions,
  questions), v1 (requirement) or v2 (screen) template,
  shape validation, sent roots and safe lexical paths.
  `ruth-api::codegen`: frozen context (exact source +
  fingerprinted scope), registry and computed expiry
  (moved/deleted source, changed scope). Accepting
  validates pending state + intact context + coherent
  target, writes (disk first) and marks; creating uses
  `ruth-code::create_file` (existing parent, atomic
  `create_new` reservation, never overwrites); modifying
  requires the generation-time fingerprint (`write_file`,
  atomic). Double accept never writes twice; discarding
  is idempotent.
- **Screen source (mockup→code, one direction).** The same
  dialog with a source selector; the context freezes the
  mockup's current version, ONE existing screen with its
  summary (components, sources, no positions) and its
  quoted requirements at exact version (missing, foreign
  or archived ones block). The instruction asks for
  MINIMAL editing, respect for manual code and no
  invented backend/DTOs/SQL from the data source (whatever
  exceeds the UI goes to questions). With a draft in the
  mockup it warns and offers Save all; the context always
  uses the saved.
- **Review and loop.** The dialog shows a context preview,
  current↔proposed diff per file (reused Monaco, text on
  failure), accept/discard with a block reason, earlier
  proposals and re-analysis with `diffStructure`
  (content-keyed, never ordinal). After accepting, clean
  tabs and the tree refresh (`notifyFileChanged`; with a
  draft nothing touches: the save conflict will warn).
- **v14 persistence.** `code_generations` (exact source:
  requirement OR screen, model, template, usage,
  explanation), `code_gen_scope` (fingerprints),
  `code_gen_notes` (assumptions/questions),
  `code_gen_screen_sources` (the screen's sources) and
  `code_proposal_files` (proposed content + per-file
  state). No FK to the domain (the source may have been
  deleted: it marks stale); dangling roots tolerated;
  v13→v14 migration adds columns (NULL = requirement
  source) and one table. `cgen-N` IDs.
- **Honest limits.** No running or installing the project;
  no rebuilding requirements/ER/rules from arbitrary code;
  no writing without explicit acceptance; no continuous
  sync or editing the proposal inside the dialog; `.ruth/`
  stays a future contract.

## 25. Structure replication as modules

From a workspace root, create in one transaction the
project (when new) with one empty module per child folder
of the base, the root↔project association and the manual
module↔folder links. Visible structure only (`readdir`,
one level, no AST or AI): each folder gets a working shell
ready for requirements.

- **Preview before creating (`ruth-api::replicate`).**
  `code_replicate_preview(rootId, base?)`: the base
  suggests (`src/app` when it exists with subdirectories
  —Angular—, else `src` —Nest/generic—, else the root
  itself when there is no `src` —sibling microservices,
  monorepo—) with a readable reason, or the user picks it;
  the dialog may change, reload or pin the root ("Use the
  root"). Base `""` = root throughout the flow; each
  direct child is one module. It returns entries (name,
  rel, already-linked module when there is one),
  policy-excluded ones (hidden, `node_modules`, `dist`,
  `build`, `target`, `coverage`, `__pycache__`, `.git`,
  plus documented extras) and truncation/over-cap
  notices.
- **Atomic link-idempotent apply.**
  `code_replicate_execute` validates (base inside the
  root, valid names, max 50 modules per replication
  —blocks, never truncates—, root never linked to
  ANOTHER project) and persists in one
  validate→persist→publish transaction (`save_replication`:
  domain + roots + links, or nothing). Idempotence is per
  (root, rel): already-linked items report in
  `alreadyLinked`, never duplicated or deleted.
- **No migration.** It reuses the existing domain,
  `code_roots`, `code_links` and transaction pattern; v14
  schema unchanged. After creating, it selects the
  project and its first module (stable order) to enable
  the perspectives; the project tree refreshes
  (`explorerToken`) and module rows show a folder chip +
  "Open in code" jump (one on-demand `listProjectLinks`
  per selected project).
- **Limits.** No auto-requirements, no AI naming (name =
  folder), no moving tabs; the renamed module shows its
  new name in the chip. Bases deeper than one level
  require picking the base by hand.

## 26. Nested code projects and the Architecture scope

A workspace root is a container: the ACME root holds
frontend, backend and gateway folders, each its own
application. Ruth separates the concepts: workspace (open
roots), detected project (manifest-backed application,
service or package), picked folder (tree location) and
active Architecture scope (joint view, project, or explicit
folder). Code projects never mix with Ruth business
modules: the domain `Selection` stays untouched.

- **Discovery (`detectProjects.ts`, no backend changes).**
  Bounded manifest walk per root (the `manifestScan` caps:
  depth 3, 200 folders, 40 files) plus small `package.json`
  reads for names and workspace globs. A directory with a
  strong manifest (`angular.json`, `nest-cli.json`,
  `pom.xml`, `build.gradle[.kts]`, `Cargo.toml`, Python
  manifests) is a project; `package.json` counts unless it
  declares workspaces (a container, never a service);
  `tsconfig*.json` alone never creates one. Session cache
  with in-flight sharing; no execution, no Meta. Manual
  corrections: "Analyze this folder" overrides boundaries
  and per-project eyes exclude from the joint view (kind
  relabeling is out).
- **Selection (tree).** Split rows: the chevron expands
  without touching the scope; the project name activates
  it (`archScope` in the store); plain folders select for
  exploring; files open without replacing the scope.
  Detected rows carry a kind badge with manifest evidence
  in the tooltip and an active marker; breadcrumbs mark
  the matching segment.
- **Visibility (persisted).** One eye per detected project
  (nested included), right-aligned before the row menu,
  with "Show/Hide in/from architecture" labels,
  `aria-pressed` and no click propagation. It only filters
  the joint view: never opens, activates, cancels or
  closes anything. Preferences persist in the WebView
  (`ruth-ide:layout`, `mapHiddenProjects` keyed
  `rootId::rel`, validated, capped at 200 entries).
- **Contextual boards.** Each scope collects only its
  subtree (`collectTsScope` with `startRel`, nested
  `excludeRels` and build-folder skips), excludes siblings
  and nested independent projects, and reports scope, caps
  and coverage per section. Explicit folder scopes analyze
  the whole subtree beneath. Truncated collections
  continue in batches ("Load more files" re-runs with a
  bigger cap); runs cancel cleanly; scope switches discard
  stale responses by epoch. Cached maps survive toggles
  and restores without re-analyzing. Sections key by
  `rootId::rel`, so equal names across services never
  collide. Empty scopes say "No supported source files";
  detected-but-unanalyzed projects (Java/Rust/Python) say
  so instead of mapping.

## 27. Board presentation (columns, edges, inspector)

One Architecture view, no tabs: the automatic project boards
first, the manual scope analysis (`StructureView`) below, a
single toolbar owning filters, zoom and edge controls. The old
Boards/Scope tabs and the manual-scope board rendered the same
journey twice and were removed; no analysis capability went
with them.

- **Columns (`boardLayout.ts`, `ArchMapBoard.tsx`).** Layers
  run left to right with badge, title, count and a sticky
  header; cards stack vertically with heights derived from
  the rows actually rendered (symbols, open member lists,
  the "Show all N" toggle). One pure pass positions cards
  and edge endpoints in a single coordinate system, with no
  DOM measuring; a test pins the stylesheet constants to
  the layout math. Cards truncate with full-path tooltips
  and carry language/marker badges (`test`, `config`, `no
  symbols`, counts). Test and config files have toolbar
  filters and are counted when hidden, never dropped
  silently.
- **Edges.** Only the selected card neighborhood draws
  (nothing without a selection), filtered by incoming /
  outgoing toggles and depth (1 direct, 2 plus one context
  hop). Paths anchor to facing card borders and render
  behind cards; a legend names every kind, and
  `references` stays a type/value use, never a call.
- **Viewport (`BoardViewport.tsx`).** The wheel scrolls; Ctrl+wheel zooms around
  the cursor (shared level, per-board scroll anchoring),
  dragging the background pans, and each board carries a
  Fit button. Without a zoom setter the wheel scrolls
  natively; inspector and form scrolling is never
  intercepted.
- **Inspector (shared).** One collapsible, resizable panel
  serves every board (width persisted in `ruth-ide:layout`,
  collapse session-only); sections collapse, symbols show
  member counts instead of concatenated paragraphs, and
  members read one per row. It never opens code: the
  explorer keeps file access and `verifiedOpen` stays with
  the Structure view. Scope switches clear the selection;
  zoom and card expansion survive them.
- **Center cleanup.** The "Active project" row, project
  chips and their eyes are gone: the tree owns scope and
  visibility, and the center keeps a compact breadcrumb
  with a way back to the joint view.

## 28. Symbol cards and board granularity

The default board draws one card per symbol (`ArchMapNode` in
`archModel.ts`): classes, interfaces, enums, components and free
functions are first-class cards with their own layer verdict
(`classifySymbol`: the symbol's decorator, then kind, then name
suffix, then the file path as context). The file is location
metadata, never the forced grouping; a toolbar "Card grouping"
toggle renders the file-grouped board (`ArchMapBoard`) as a
secondary projection of the same model, so no symbol is
duplicated.

- **Members.** The extractor captures visibility, static,
  async, readonly, trimmed signatures and constructor
  parameter properties. Cards list every member with an
  explicit collapse toggle (never a silent "+N"), one
  bordered row each; the card grows to hold every row
  (the wheel scrolls the board, so an inner scroll area could
  not be scrolled). Heights derive from rendered rows in one
  pure pass (`layoutSymbolBoard`, shared stacker, no DOM
  measuring); see §28.1 for the card anatomy.
- **Symbol edges.** `symbolEdges` aggregate resolved symbol
  relations only (`extends`, `implements`, `instantiates`,
  `references`); file imports stay on the Files board, so an
  import is never mistaken for a call. Unresolved refs keep
  name + kind + status on the card badge and in the
  inspector; no destination is invented.
- **Overrides.** The inspector's per-symbol Layer section
  reclassifies one card; overrides persist per workspace in
  `ruth-ide:layout`, are guarded by the symbol name, cap at
  200 entries, and degrade to automatic when stale.
- **Coverage.** Each section reports discovered / analyzed /
  failed / excluded / pending. Analysis runs by itself in
  batches of 20 files, with progress and Cancel; a cancelled
  run resumes with "Continue analysis". Collection
  puts application code first and tests, test folders and
  config last (`isSecondaryFile` in `projectMaps.ts`), so the
  first batches cover the application structure. Resolution stays per batch: relations across batch
  boundaries remain unresolved, and syntax errors yield
  partial symbols for that file only.

### 28.1. Card anatomy and visual states

Presentation facts come from `memberRoles.ts`, a pure module
that only reads the extraction; the extractors are unchanged.

- **Card.** Kind tile, name and the language badge of the real
  file extension (TS, TSX, JS, HTML, CSS, SCSS, Java, Rust,
  XML, SQL; "Unknown" without one), then the project chip,
  every decorator and the file name, then readable counters
  ("10 methods · 1 property", "⚠ 3 unresolved"). Badges that
  do not fit wrap onto a clipped line, so none is cut mid-label.
- **Member rows.** One 28px bordered row per member (6px gap,
  one `ARCH_MEM_ROW_H` slot): role icon, name, secondary
  signature as written, and badges only for what the code
  wrote (visibility, static, async, readonly). Roles: the
  extracted kind decides method vs property; `constructor`
  on a class is the constructor; a field is "holding a
  function" only when its written type or initializer shows
  one (`=>` or `function`; truncated text stays a property).
  Rows are buttons: selecting one shows role, visibility
  ("Not written" when absent), modifiers, parameters and
  return ("Unknown (not annotated)" when absent) in the
  inspector.
- **Lifecycle hooks.** Never by name alone. Angular
  (`ngOnInit`…): the file imports `@angular/core` and the
  class `implements` the hook interface or carries
  `@Component`/`@Directive`. NestJS (`onModuleInit`…): the
  file imports `@nestjs/common`/`@nestjs/core` and the class
  implements the interface. The evidence is shown with the
  hook. Other frameworks are not detected.
- **Colors.** Architectural role tints the column tile and
  the card kind tile (Controllers blue, Services teal, State
  violet, Data Contracts amber, Composition indigo, UI orchid,
  Cross-cutting slate, Unassigned neutral). There is no
  Repository/Persistence layer in the taxonomy, so no card
  receives that hue. Visibility badges are tinted (private
  red, protected orange, public blue) and never tint the card.
  Hooks are green, constructors amber. Selection is mint
  (card and row); keyboard focus is a separate light outline;
  unresolved is an amber badge with an icon. Every color
  comes with a glyph or a label.
- **Layers.** One stacking context per board: column panels,
  edges, cards, edge labels, sticky column headers. Edges run
  behind cards; labels sit at the gap between neighbor
  columns, or beside the target column for longer edges.
- **Not shown.** Template and stylesheet files of a
  component: the extraction keeps decorator names only (no
  `templateUrl`/`styleUrls`), and pairing files by similar
  names would invent a relation.

