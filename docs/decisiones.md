# Ruth IDE decisions

Record of current and superseded decisions. Lengthy rules live in
their authoritative document (linked); only what rules and what no
longer rules is stated here.

## Current

- **Rust owns the domain.** `ruth-core` keeps versions,
  dependencies, validity, approvals and baselines; the UI presents
  and proposes, never decides. See [architecture §2–§4](arquitectura.md).
- **Ctrl+S saves without mandatory approval.** Saving, generating
  and continuing to design start from saved versions. See
  [live-design decision](decision-diseno-vivo.md).
- **Review is optional and informative.** The review (approve)
  action keeps its own rules (current and valid version, human
  authorship, explicit confirmation), but does not block other
  work. See [live-design decision](decision-diseno-vivo.md).
- **History and earlier baselines are preserved.** Nothing is
  rewritten; approved baselines keep their original invariants and
  work deliveries are a separate concept. See
  [architecture §15](arquitectura.md).
- **AI never overwrites manual edits.** Its results go to separate
  proposals that the person takes in; self-updating is opt-in per
  module and never recursive. See
  [architecture §15](arquitectura.md).
- **Structured mockups as source of truth.** The canonical JSON is
  authoritative; future image and HTML will be auxiliary. A visual
  field does not equal a column, nor a screen an entity: the data
  source is declared and nothing is created by assumption. See
  [architecture §16–§16.1](arquitectura.md).
- **Atomicity: validate → persist → publish.** No success is
  reported before confirming to disk; on failure there are no
  partials. See [architecture §6](arquitectura.md).
- **Transactional migrations that preserve the past.** Schema
  v12; each version opens earlier databases intact. See
  [architecture §6](arquitectura.md) and
  [continuity](continuidad.md).
- **The Meta key never crosses to the frontend.** It only lives in
  the Rust process memory; the terminal excludes it from its
  environment (`META_*`). See
  [architecture §7, §17](arquitectura.md).
- **No network in tests.** Fake generator and fixtures; real calls
  only leave from explicit buttons on desktop.
- **File confinement ≠ sandbox.** `ruth-code` confines the file API
  (root + relative, no escapes or links); the terminal keeps user
  permissions. See [architecture §20](arquitectura.md).
- **Code saving by fingerprint, never blind.** External change
  → explicit compare/reload/replace; atomic write with preserved
  permissions; the draft is never lost on its own. See
  [architecture §20](arquitectura.md).
- **Lazy and honest Monaco.** Deferred chunk outside the initial
  one; selectable highlighting (JSON with local service, TOML as
  INI), without presenting it as analysis. See [architecture §20](arquitectura.md).
- **Structure with real parsers, not regex.** TS 5.9 in a worker,
  Rust with `syn`; a single IR; the unverified goes to the
  inspector. See [architecture §21](arquitectura.md).
- **Strict resolution by uniqueness.** Repeated → ambiguous,
  missing → unresolved; no imports or jumps across languages;
  no inferred composition. See [architecture §21](arquitectura.md).
- **Semantically read-only diagram.** Rearranging never modifies
  code; no refactoring or two-way sync. See [architecture §21](arquitectura.md).
- **Editor presentation without touching saving.** Theme, breadcrumb,
  status, icons, tabs and read-only diff; preferences are visual
  only and live in the WebView. No LSP or global search in this
  phase. See [architecture §20](arquitectura.md).
- **Design and Code are perspectives of one project.** No exclusive
  switch: same selection, same drafts and a single terminal. The
  root points at the project (NULL = unlinked); removing never
  deletes. See [architecture §22](arquitectura.md).
- **Explicit links with evidence, never by name.** Manual
  module↔path and detected artifact↔symbol links (id, range,
  source hash); `inferred` reserved without creating any.
  Computed freshness, blocks with counts. See
  [architecture §22](arquitectura.md).
- **Read snapshots, without contents.** The stored IR never carries
  the `content` key; verifying compares per file; snapshots are
  not loaded into the diagram and create no dependencies. See
  [architecture §22](arquitectura.md).
- **`.ruth/` only as a portable contract.** `PortableExport` v1
  without writing or syncing; the local database is the only
  authority. See [architecture §22](arquitectura.md).
- **Traceability only from explicit links.** "Unlinked" never
  judges; covered code is only snapshot code; stored ranges never
  jump. See [architecture §22](arquitectura.md).
- **Code created from scratch at the hackathon.** Earlier work
  (Atelier / Ruth IDE) has not been read or reused. See
  [scope](alcance-hackathon.md).
- **Panel sizes only in the WebView.** Four measurements and
  nothing more (`ruth-ide:layout` v1, validated); SQLite stores no
  presentation. See [architecture §23](arquitectura.md).
- **Own icons, decorative, with a pack contract.** One SVG set
  (`src/components/`), `aria-hidden`, no third-party assets;
  future packs respect gaps and network silence. See
  [architecture §23](arquitectura.md).
- **Structure scope with a visible folder.** "+ Active folder" adds
  analyzable direct children with honest notices; the decision is
  pure and tested. See [architecture §23](arquitectura.md).
- **Dialogs that demand choosing before losing work.** The pending
  drafts one never closes by accident (neither Escape nor outside
  click); the rest close on outside click (Escape only in
  generate/archive/rename). See [architecture §23](arquitectura.md).
- **Detection by documented subsets, unions by method+path.** Each
  extractor declares which constructs it covers; the rest is not
  drawn. The union normalizes in a single place and the ambiguous
  is not connected. See [architecture §24](arquitectura.md).
- **Proposing code ≠ writing code.** The AI returns complete
  contents as a proposal; accepting is human, per file, with a
  fingerprint, and creating never overwrites. Changed context
  blocks and asks to regenerate. See [architecture §24](arquitectura.md).
- **Accepting refreshes without touching drafts.** After writing,
  clean tabs and the tree update on their own; with a pending edit
  nothing is touched (the save conflict will warn). See
  [architecture §24](arquitectura.md).
- **Mockup→code in one direction, with the same dialog.** The
  screen is another exact source (version + sources), not another
  system: same schema, diff, accept/discard and freshness. The
  data source rules (whatever exceeds the UI goes to questions,
  no backend is invented) and there is no automatic writing or
  continuous sync. See [architecture §24](arquitectura.md).

- **Structure replication: only visible directories, no AI.**
  Replicating folders as empty modules uses `readdir` (one level,
  with documented exclusions), never AST or generation:
  name = folder, no auto-requirements. Creation is atomic and
  idempotent per link (root, rel). See [architecture §25](arquitectura.md).
- **Project deletion without cascades.** Only empty projects, with
  no associated folders or references (baselines, deliveries,
  generations); projects with content are emptied module by
  module. Projects are never archived. The context menu only
  offers archive/delete where a backend exists. See
  [architecture §13](arquitectura.md).
- **English for new work; dialogue stays in Spanish.** All new
  code, comments, tests and docs are written in English. Existing
  Spanish code and docs are left untouched until their own
  migration milestone. See [architecture map](architecture-map.md).
- **Architecture map: code and views stay separate.** One
  Architecture view (boards plus manual scope analysis below);
  view→code bridges come afterwards for small refactoring
  tasks. Design-pattern detection is deferred until the map
  is stable.
- **Top-level boards show the project, not a picked scope.**
  One automatic board per detected project of the selected
  project (tree-owned scope and visibility, breadcrumb with
  a way back in the center). Partial results are labeled,
  never silent. See [architecture map](architecture-map.md).
- **Map perspective needs a project, not a module.** Roots link
  to projects, so the tab enables with a project alone; Ctrl+S
  there is a no-op like in Impact/Traceability.
- **Board edges surround the selection only.** Nothing draws
  without a selection; incoming/outgoing toggles and depth
  filter the neighborhood, and a legend names every kind.
  `references` is a type/value use, never a call. See
  [architecture §27](arquitectura.md).
- **Board navigation is hash-verified where it exists.** Ranges
  jump only while the file content still matches the analyzed
  FNV-1a hash; otherwise the file opens with a notice. The
  Structure view keeps `verifiedOpen.ts`; the board inspector
  does not navigate to code for now. See
  [architecture map](architecture-map.md).
- **Symbols select for evidence; members never fake a jump.**
  The inspector shows relation evidence first; methods/fields
  have no own IR ranges and list one per row with an honest
  note. Member ranges need an extractor + IR extension.

## Superseded (historical context)

1. "Generating designs requires approved sources" — superseded by
   live design: current saved versions are enough.
2. "Accepting updates requires approved sources" — superseded:
   existing and current sources are enough; review is reported.
3. "Re-approving a stale derivative is not enough" as a mandatory
   flow — superseded; review stays available but no longer blocks
   syncing.
4. "A baseline must include approved versions" as the single rule —
   current for approved baselines; the work/draft delivery is a
   new and separate concept.
5. "Temporary in-memory session" (milestone 3) — superseded by
   SQLite persistence since milestone 4.
6. "Selected approved sources" in the milestone 6 and 8 texts —
   historical wording; the current behavior is live design.
7. "Exclusive Design/Code areas with a switch" — superseded:
   `Code` is one more central perspective (§22).
8. "Code workspace separate from design projects" — superseded:
   explicit root↔project association, with no invented
   relationships (§22).
9. "One tab per map" (Boards/Scope) — superseded: a single
   Architecture view with boards plus manual scope analysis;
   the manual-scope board duplicated the journey (§27).
10. "Active project row with chips and eyes in the center" —
    superseded: the tree owns scope and visibility; the
    center keeps a compact breadcrumb with a way back (§27).
11. "Open in code from the board inspector" — removed for now:
    the explorer keeps file access and `verifiedOpen` stays
    with the Structure view (§27).
12. "Members open at their container" — removed with the
    inspector navigation: members list one per row with an
    honest no-ranges note (§27).
13. "One card per file with symbols inside" — superseded as
    the default: the board draws one card per symbol with
    its own layer verdict, and the file board stays as a
    secondary grouping toggle over the same model (§28).
14. "Collection batches continue the file walk only" —
    superseded: "Analyze more files" continues the analysis
    in batches, with per-batch resolution and
    discovered/analyzed/failed/excluded/pending counters
    (§28).

Full detail on 1–4 in the
[live-design decision](decision-diseno-vivo.md).
