# Continuity — resuming Ruth IDE

Entry point for whoever continues (AI or developer) without access
to earlier conversations. State at 2026-10-29, verified against the
code; anything unverified is marked explicitly.

## Product goal and competition delivery

Visual workspace turning requirements into linked design artifacts
(flow, ER, mockups). When a rule changes, it identifies affected
dependencies and proposes adjustments for a person to review.
Competition delivery: linked requirements → rule change → impact →
proposals → review → export. See
[scope](alcance-hackathon.md).

## Feature status, verified

Verified = automated suites green in this session (see "Executed
tests"). Interactive desktop walkthrough: pending (headless
environment).

- Core (versions, dependencies, validity, approvals, baselines):
  implemented and tested, including the Sales example.
- Requirements (create, edit, version, review): implemented.
- SQLite persistence with validating startup: implemented (v13).
- Meta requirement proposals: implemented (idempotent acceptance,
  computed expiry).
- Meta flow/ER design, local Mermaid, diff, update from Impact:
  implemented.
- Impact map (SVG graph, table, inspector): implemented.
- Approved baselines + work deliveries + reproducible ZIP export:
  implemented.
- Visual flow and ER editing (deferred React Flow): implemented.
- Reversible archiving and safe deletion: implemented (modules,
  requirements and empty unreferenced projects; designs and
  mockups have no individual archiving: the menu does not offer
  it).
- Renaming with title history: implemented.
- Live design (barrier-free Ctrl+S, opt-in auto-AI): implemented.
- Versioned mockups + screen proposals + `mockup/component`
  quotes: implemented.
- Multi-folder code workspace: persisted roots, on-demand tree,
  Monaco tabs with safe saving and conflicts, contextual
  terminal. Stages A and B verified.
- Editor presentation (phase 1, frontend only): Ruth theme,
  optional minimap, breadcrumb with reveal, per-type icons,
  status bar, keyboard tabs and real diff on conflicts;
  visual-only preferences. Without changing saving, terminals,
  Structure or live design.
- Detected code structure: explicit scope, TS extractors
  (`ts-compiler` in a worker) and Rust (`syn`), shared IR,
  read-only React Flow diagram, inspector and fingerprint-
  verified navigation. Stages A and B verified.
- Unified perspectives: `Code` as a central perspective, project
  from folder, root↔project association, module↔path and
  artifact↔symbol links with evidence, IR snapshots and the v1
  portable contract (without syncing).
- Living code diagrams (§24): APIs detected by subsets
  (Express/Hono+fetch/axios, Actix+Axum+reqwest), method+path
  unions with unused and ambiguous ones, Classes/Data/APIs tabs,
  "Propose code" from requirement+scope (per-file diff, safe
  accept, re-analysis with diff) and v13 persistence (`cgen-N`).
- Structure replication as modules (§25): child-folder preview
  with suggested/editable base (`src/app`, `src`, or the root
  when there is no `src`: one module per sibling microservice),
  atomic and link-idempotent creation (project + empty modules +
  association + manual links, max 50), without migration (v14)
  or AI; folder chip and module↔code jump in the project tree.
- Architecture map, TypeScript
  ([docs/architecture-map.md](architecture-map.md)): Map mode in
  the code area over the shared scope; documented layer taxonomy
  with decorator refinement; import resolution, `instantiates`,
  constructor refs and TS enums in the analyzer; inspector with
  code navigation. Piloted headless on ACME (268 files: 3
  unassigned per side, all honest). New work in English from here.
- Top-level project maps: Map perspective next to the others
  (project-gated, no module needed); one automatic diagram per
  associated root (breadth-first TS collection, 200 files /
  2000 dirs caps, same worker and layers); eye toggles per root
  in tree rows and diagrams (session-only); cached maps survive
  toggles; partial states labeled.
- Nested scope fix: manifest-based nested project discovery,
  active Architecture scope (joint/project/folder), split tree
  rows (chevron vs. name), per-project persisted eye, per-scope
  contextual boards with batches and cancel, per-scope Overview
  lines; all covered by the suite (see below).
- Delivery A: inspector promoted to the top-level maps; symbol
  selection with incoming/outgoing relations (kind, status,
  evidence) and member details; hash-verified opening via
  shared `verifiedOpen.ts` (the Structure view keeps it; the
  board inspector no longer navigates to code). Maps re-run
  when returning to the perspective (no incremental analysis).
- Board presentation (current work): layers as columns with
  sticky headers and content-derived card heights (one pure
  layout pass, CSS constants pinned by test); selection-only
  edges with incoming/outgoing/depth controls and a legend;
  wheel zoom around the cursor, background pan, per-board Fit;
  one shared collapsible/resizable inspector; test/config
  filters with honest counts; compact scope breadcrumb (the
  tree owns scope and visibility); single merged Architecture
  view, manual scope analysis below the boards.
- Window refinement (§23): all four zones resize with an
  accessible handle and their sizes persist in the WebView; own
  unified icons in `src/components/` (every tree row carries
  its own); "+ Active folder" and a three-step guide in
  Structure; window map audited against the code.
- Real integrated terminal (PTY, up to 3 sessions): implemented.
- Meta assistant and honest header: implemented.
- Compact density and undecorated window: implemented.
- Browser without Tauri: reports that desktop is required; does
  not fake it.

## Folder and key-file map

- `src-tauri/Cargo.toml`: Rust workspace (`ruth-ide` + crates).
- `src-tauri/crates/core/`: pure domain (no Tauri/Serde/clock/net).
  `domain/model.rs`, `application/store.rs`; example
  `tests/sales.rs`.
- `src-tauri/crates/meta/`: Meta contract + authoritative validation.
  `protocol.rs` (Responses API), `generation.rs`, `design.rs`,
  `mockup.rs`, `error.rs`.
- `src-tauri/crates/api/`: use cases + DTOs (`transact`,
  `impact.rs`, `export.rs`, `delivery.rs`, `update.rs`, `mockup.rs`,
  `code_links.rs` with links, snapshots and `PortableExport`…).
- `src-tauri/crates/store/`: SQLite. `schema.rs` (`SCHEMA_VERSION`),
  `persist.rs`, `actor.rs`, `mockups.rs`, `code_roots.rs`,
  `code_links.rs`, `snapshots.rs`.
- `src-tauri/crates/term/`: real PTYs (`portable-pty`).
- `src-tauri/crates/code/`: roots, confinement, reading/writing
  (`lib.rs`) and the Rust extractor (`structure.rs` with `syn`,
  `fnv1a_hex` shared with the frontend).
- `src-tauri/src/commands/`: Tauri commands `core_*` / `term_*` /
  `code_*` per feature (`code.rs`, `code_links.rs` new);
  `state.rs`, `lib.rs` (registry).
- `src-tauri/tauri.conf.json`: `devUrl 127.0.0.1:1420`,
  `beforeDevCommand: npm run dev`, `decorations: false`.
- `src/features/`: `requirements/`, `design/`, `impact/`,
  `mockup/`, `proposals/`, `assistant/`, `terminal/`, `explorer/`,
  `delivery/` (deliveries/export), `code/` (code workspace:
  `CodeWorkspace`, `CodeTree`, `CodeViewer`, `CodeEditor`,
  `monacoLoader`, `monacoFake` for tests, `structure/` with
  `tsAnalyze`, `structureWorker`, `StructureView` and
  `StructureGraph`; phase-1 presentation: `editorPrefs`,
  `monacoTheme`, `fileIcons`, `CodeBreadcrumbs`,
  `CodeStatusBar`, `CodeEditorPrefsPanel`, `CodeConflictDiff`;
  unification: `ModuleCodeLinks`, `structure/ProjectCodePanel`,
  `useCodeWorkspace` (provider + `CodeTreePane` / `CodeMainPane`
  panels for the split layout)).
- `src/features/trace/`: traceability perspective (pure
  `traceModel.ts` + `TraceView.tsx` with injected backend).
- `src/features/requirements/projectFromFolder.ts`: orchestrator
  for create-project-from-folder with injected dependencies.
- `src/styles.css`: density and typography tokens.
- `docs/`: `arquitectura.md` (authoritative), `alcance-hackathon.md`,
  `decision-diseno-vivo.md`, `decisiones.md`, `continuidad.md`.
- `README.md`: install, run, tests, manual cases.
- `AGENTS.md`: brief repository instructions.

## Development and verification commands

```sh
npm install
npm run dev            # frontend only (no native commands)
npm run tauri dev      # desktop (Vite 127.0.0.1:1420 + Rust)
npm test               # vitest run
npx tsc --noEmit
npm run build
cd src-tauri
cargo test --workspace # no real network
cargo clippy --workspace --all-targets
cargo fmt --check
cargo check
```

Key (never as an argument or in files; see README):

```sh
read -rsp 'META_API_KEY: ' META_API_KEY && export META_API_KEY && echo
npm run tauri dev
```

## Schema and migrations

`SCHEMA_VERSION = 14` (`crates/store/src/schema.rs`). Chain: v1
base → v2 requirement generations → v3 design generations → v4
update target → v5 `baseline_meta` → v6 `design_layouts` → v7
`archived` → v8 names and title history → v9 work deliveries →
v10 screen proposals → v11 `code_roots` → v12 `project_id` +
`code_links` + `structure_snapshots` (+ persisted `next_id`) →
v13 `code_generations` + scope + notes + proposed files → v14
screen provenance (NULL columns = requirement source) +
`code_gen_screen_sources`.
Policy: transactional and idempotent migrations; each version
opens earlier databases intact; `*.db` excluded from the repo
(`.gitignore`). User database:
`~/.local/share/ide.ruth.app/ruth.db` (Linux).

## Known errors

1. **Busy port 1420** (`Port 1420 is already in use`): an orphan
   `vite` from an earlier `tauri dev` is still alive
   (`strictPort: true` makes it fail fast instead of drifting to
   another port). Locate with `ss -ltnp | grep 1420` and end only
   your own `vite` processes; never kill other people's processes.
2. **Locked database** ("already open in another process"): close
   the other Ruth instance; nothing is deleted.
3. **Lost key after restarting**: `META_API_KEY` is a process
   variable; re-export it every session (see above).
4. **`gio-sys` compile failure**: missing Tauri 2 system
   dependencies on Linux; install the
   [official prerequisites](https://v2.tauri.app/start/prerequisites/).
5. **Second instance / closing with terminals**: documented
   behaviors with their dialogs; not errors.

## English migration ledger (policy in AGENTS.md)

Migrated and verified green (UI, comments, errors, tests):
frontend `src/app` (App, WindowControls), `connection/*`,
`lib/env`, `components` (icons, fileIconNames), `terminal/*`,
`requirements/*` (incl. RequirementsWorkspace), `explorer/*`,
`workspace/*` (already English), `code/archmap/boardZoom.*`,
`baseline/*`, `proposals/*`, `trace/*`, `assistant/*`,
`impact/*`, `mockup/*` (types, model, draft, icons, panels,
detail/canvas/editor/inspector), `design/*` (types, client,
specModel, validation, history, canvas, inspectors, panels),
`code/*` (types, model, editor, viewer, tree, workspace,
structure, archmap); Rust `ruth-core`, `ruth-term`,
`ruth-code`, `ruth-store` (src + tests), `ruth-meta`
(prompts + validators + tests + fixtures, template bumps),
`ruth-api` (19 src + 14 tests), `src-tauri/src`
(commands + `lib.rs` + `state.rs`); docs `AGENTS.md`,
`architecture-map.md`, `decisiones.md`,
`decision-diseno-vivo.md`, this file.

Deliberately preserved: stable and fixture IDs (`proy-1`,
`mod-1`, `req-1`, `flujo-1`, `mer-3`, `root-N`, `term-N`,
`code_*`, `cgen-N`, `entrega-N`, `registro`), `snake_case`
kinds, DTO shapes, persistence keys, migration history,
persisted user content, the coherent Sales-demo fixture
family (`Ventas*`, `Confirmar venta*`, reservation rule
contents, `inicio/reserva/fin` flow), the `registro`-screen
fixture family, Spanish doc filenames (links would churn;
renaming deferred), and multibyte test data
(`names.test.ts` "ñ", `ñandú` zip name, `áé` PTY chunks —
intentional, not prose).

Done since: `README.md`, `docs/arquitectura.md`,
`docs/alcance-hackathon.md`, plus a residue sweep that caught
what accent-only grep missed (unaccented comments, `MockupCanvas`
toolbar, `ImpactInspector` branch, `styles.css` comments,
`*.test` names/literals, Rust test fn names, `*.rs` fixtures
and two source messages). Nothing pending: every project-facing
file is English except the deliberate preserves above. Method
used throughout: one batch per feature, `tsc` after each batch
(catches dropped braces in JSX ternaries), feature tests, and
the full suite at close.

## Pending tasks (priority order)

1. Interactive desktop walkthrough of the current milestone (see
   "Proposed next milestone"): the only verification missing.
2. Fix whatever manual testing finds and update the docs.
3. Minors from the §23 audit (if addressed, in this order):
   close the ⋯ menu on outside click; focus traps in modals;
   Escape on export/close gates and baselines; empty Review
   column with document/Overview/Architecture (hide or switch
   to Assistant on its own; the Code perspective no longer
   exists).
4. Decide the next functional milestone (candidates in the
   out-of-scope section of the [scope](alcance-hackathon.md):
   file operations, screenshot import, HTML export…).
5. Review the pre-existing clippy warnings in untouched code
   (not blocking).

## Proposed next milestone: interactive verification and hardening

Goal: run on desktop the current milestone's manual case (README
"Walkthrough" for living diagrams: unions + code proposal with
`META_API_KEY`) plus the competition walkthrough (sales:
requirements → flow/ER → impact → update → delivery → ZIP),
and record what is observed.

Acceptance criteria:

- The replication manual case completes without errors or
  detours (Angular root → "Replicate structure" → preview with
  `src/app` base → new target → confirm → project with linked
  empty modules → chip + module↔code jump → close/reopen with
  associations; and `src`-less monorepo → root-base preview →
  one module per service).
- The living-diagrams manual case stays green (analyze scope,
  Classes/Data/APIs tabs, unused from each side, requirement →
  proposal → diff → accept → re-analysis with new unions,
  close/reopen with proposals and associations). Plus: saved
  signup screen → add an input to the mockup → Ctrl+S → propose
  from the screen toward the component → diff → accept →
  re-analyze → close/reopen with history and provenance.
- The perspectives manual case stays green (project from folder,
  ◈ badge, links, snapshot, stale verification, close/reopen).
- The structure manual case stays green (scope, TS and Rust
  diagrams, navigation, expiry).
- The editor presentation looks and behaves (Ruth theme,
  optional minimap, breadcrumb with reveal, status with cursor,
  keyboard tabs, diff on conflicts, persisting preferences and
  an honest fallback if Monaco fails to load).
- The delivery ZIP opens and its `manifest.json` matches
  `sha256sum`.
- Closing/reopening preserves roots, associations, links,
  history and proposals.
- Failures found are fixed or recorded under "Known errors"
  with reproduction steps.
- Docs reflect what was verified (nothing claimed undone).

## Executed tests (latest session)

- Symbol granularity session: per-symbol cards (`ArchMapNode`,
  `classifySymbol`, `ArchSymbolBoard`) with full members
  (modifiers, signatures, ctor param properties), Files board
  kept as a secondary grouping toggle, per-symbol layer
  overrides in the inspector (name-guarded, persisted),
  discovered/analyzed/failed/excluded/pending counters with
  batch continuation, and a 6-case acceptance fixture
  (4-symbol file in 4 layers, 24-member class, same names,
  26 files in 2 batches, syntax error, unresolved `new`).
  New `archSymbolAcceptance` (6), `ArchSymbolBoard` (8),
  inspector override (2), toolbar grouping (1) tests;
  `ProjectMapView` tests pinned to files mode (31). Gates:
  `npx tsc --noEmit` clean, `npm test` 669/669 in 81
  files, `npm run build` OK, `cargo test --workspace
  --offline` green (Rust untouched), `cargo fmt --check`
  clean. No Meta calls. No visual validation claimed
  (sandbox browsers fail); interactive desktop run still
  pending.
- Board presentation session: layers as columns
  (`boardLayout` + `ArchMapBoard` + `BoardViewport`),
  selection-only edges with in/out/depth + legend,
  compact scope breadcrumb (tree owns selection), one
  shared collapsible/resizable inspector without code
  navigation, test/config filters with honest counts,
  merged single Architecture view (Boards/Scope tabs and
  the manual-scope board removed, `StructureView` kept
  below). New `boardLayout` (15), `ArchMapBoard` (11),
  `BoardViewport` (4), `ArchitectureToolbar` (4),
  `boardCss` (3) tests; rewrote `ProjectMapView` (29)
  and inspector (7) tests; deleted `ArchMapLanes` and
  `ArchMapView` (+tests). Gates: `npx tsc --noEmit`
  clean, `npm test` 621/621 in 79 files, `npm run
  build` OK, `cargo test --workspace --offline` 422
  passed / 0 failed (Rust untouched), `cargo fmt
  --check` clean. No Meta calls. Browser screenshots
  attempted but both
  browsers fail in this sandbox (Chromium aborts at
  startup, Firefox is blocked): NO visual validation
  is claimed; geometry is pinned by layout math tests
  plus a CSS↔constant coupling test instead.
  Interactive desktop run still pending.
- Nested scope session: new `detectProjects` (12), collector
  options, `archScope`/visibility/folder-selection store,
  `CodeTreeScope` (8), `ProjectMapView` nested scopes (14),
  breadcrumb marker, per-scope Overview. Adapted tree tests
  to chevron expansion (no weakened assertions). Gates:
  `npx tsc --noEmit` clean, `npm test` 586/586 in 76 files,
  `npm run build` OK, `cargo test --workspace --offline`
  green (Rust untouched). No Meta calls; no desktop
  (headless): interactive run still pending.
- Docs + residue-sweep closing session: translated
  `continuidad.md`, `alcance-hackathon.md`, `README.md`,
  `arquitectura.md` (§1–§25) and swept the leftovers that
  accent-only grep had missed (frontend UI/comments/tests,
  `styles.css`, Rust tests/messages/fixtures; 14 Rust test
  fns renamed). Gates: `npx tsc --noEmit` clean,
  `npm test` 544/544 in 74 files, `npm run build` OK
  (pre-existing chunk warnings), `cargo test --workspace
  --offline` 37 suites ok / 0 failed, `cargo fmt --check`
  clean. No Meta calls; desktop pending (headless).
- Adaptive layout + English batch session: terminal
  maximize/restore (+hide exits maximize), visible layout reset,
  viewport clamps (34vw sides, `100dvh-10rem` terminal), narrow
  fixes (tabs scroll, editor min-height, stacked inspector),
  shared board zoom (steps + toolbar, `boardZoom` pure + tested).
  English batches: app/connection/components/terminal/
  requirements/explorer + AGENTS.md (ledger above). Gates at
  close: `tsc` clean, `npm test` 544/544, `npm run build` OK,
  `cargo test --workspace --offline` green, `cargo fmt --check`
  clean. No Meta calls; desktop pending (headless).
- Workspace-first navigation session: `npm test` 535 passed
  in 73 files (9 stale Spanish assertions in
  `Code{Editing,Workspace,Presentation,Split}.test` updated
  to the English `CodeMainPane` contract; same assertions,
  current strings); `npx tsc --noEmit` clean;
  `npm run build` OK (pre-existing chunk warnings);
  `cargo test --workspace --offline` green (Rust untouched
  except `cargo fmt` whitespace in already-dirty files);
  `cargo fmt --check` clean. Wired: welcome launch state,
  workspace bar + selector, Overview/Architecture views,
  doc tabs above every view, single explorer, close gate
  (dirty docs + terminals), recents restore. No Meta calls;
  no desktop (headless): interactive run still pending.
- Delivery A session: `npm test` 501 passed in 66 files (+3
  verifiedOpen, +4 inspector symbol mode, +1 code-area verified
  open, +3 top-level inspector/open/stale); `npx tsc --noEmit`
  clean; `npm run build` OK (pre-existing chunk warnings);
  `cargo test --workspace --offline` green (Rust untouched);
  `cargo fmt --check` clean. No Meta calls; no desktop
  (headless): interactive run still pending.
- Top-level maps session: `npm test` 490 passed in 65 files
  (+15 collector, +6 project view, +2 tree eye, +1 icons,
  +1 store toggle, +1 tabs project-only, +1 save target);
  `npx tsc --noEmit` clean; `npm run build` OK (pre-existing
  chunk warnings). No Rust changes; no Meta calls; no desktop
  (headless): interactive run still pending.
- `npm test`: 464 passed in 62 files (+12 taxonomy, +5 map
  model, +4 lanes, +2 inspector, +5 map view, +6 analyzer
  additions —imports, decorators, instantiates, enums,
  constructor refs—).
- `npx tsc --noEmit`: clean. `npm run build`: OK (pre-existing
  >500 kB chunk warnings).
- `cargo test --workspace --offline`: 415 passed, 0 failed
  (+10 api replication and +1 atomic `save_replication`; +1
  core `delete_project` —empty, archived, unknown—; +2
  project-archive api —summary with modules/roots and deletion
  with revalidation—; +2 actor dispatch —domain+roots+links
  roundtrip and atomic replication—).
- `cargo fmt --check`: clean (`cargo fmt` applied to the
  `api/lib.rs` drift in this milestone). `cargo clippy`: only
  the 2 pre-existing warnings in untouched code (`design.rs`,
  `export.rs`).
- No real Meta calls; no desktop (headless): the interactive
  walkthrough stays pending.
- Temporary structure-milestone realchecks (removed after
  passing, previous session): TS 16 symbols / 9 relations in
  `model.ts` + `CodeTree.tsx`; Rust 8 symbols / 5 relations in
  `ruth-code/src/lib.rs`.

Pending manual verification: interactive desktop walkthrough
(including the perspectives case), visual comparison of the
diagram and the editor presentation (no virtual X here; the
served build could not be tested over HTTP due to the
sandbox's network namespaces), real Meta calls (only via app
buttons) and terminal on Windows (compiles, untested here).

## Uncommitted local changes (unaltered)

HEAD: `ad3b0c6 fix(terminal): single tabs row and exclusive active viewport`.
Nothing in staging: 186 modified files + 44 untracked (mockups +
code workspace + structure + editor presentation + unified
perspectives + §23 refinement + living diagrams §24 + mockup→code
screen source + structure replication §25 + project deletion +
test batch + architecture map + English migration):

- Docs: `README.md`, `docs/alcance-hackathon.md`,
  `docs/arquitectura.md`, `docs/decisiones.md`, this file,
  `AGENTS.md`.
- Rust (mockups): `crates/meta/{mockup,design}.rs`,
  `crates/api/{mockup,dto,lib}.rs` + test,
  `crates/store/{schema,persist,actor,lib,mockups*}.rs` + test,
  `src/{lib,state,commands/{mockup,mod}}.rs`.
- Rust (code): new `crates/code/`, new `crates/store/code_roots.rs`,
  new `src/commands/code.rs`, `crates/api/ids.rs`; touches in
  `Cargo.toml`, `store/{schema,persist,actor,lib}.rs` + test,
  `src/{lib,state,commands/mod}.rs`.
- Frontend (mockups): `features/mockup/*` (new `mockupIcons*`,
  `screenNodes*`, `ScreenProposals*`, `MockupIcon*`),
  `features/design/editing/*`, `features/explorer/*`,
  `features/requirements/{navigation,uiStore,
  RequirementsWorkspace,archive,saveStatus}*`, `styles.css`.
- Frontend (code): new `features/code/` (`types`, `client`,
  `model` + tests, `CodeTree`, `CodeViewer`, `CodeEditor` + test,
  `CodeWorkspace` + tests, `monacoLoader`, `monacoFake`,
  `structure/` with TS extractor, worker, view, graph and tests;
  phase-1 presentation: `editorPrefs`, `monacoTheme`,
  `fileIcons`, `CodeFileIcon`, `CodeBreadcrumbs`,
  `CodeStatusBar`, `CodeEditorPrefsPanel`, `CodeConflictDiff`,
  `CodePresentation` + tests for each piece),
  `features/requirements/{uiStore,saveStatus*,
  RequirementsWorkspace}`, `features/terminal/TerminalPanel.tsx`,
  `src/app/App.tsx`, `styles.css`, `package.json` + lock
  (monaco-editor, ts-compiler).
- Rust (structure): new `crates/code/structure.rs` (`syn`
  extractor), `crates/code/Cargo.toml` (syn/quote/proc-macro2),
  `src-tauri/Cargo.lock` (new dependencies), `code_analyze_rust`
  command in `commands/code.rs` + registry.
- Unification (Rust): new `crates/api/code_links.rs` (links,
  snapshots, `PortableExport` v1) + test, new
  `crates/store/{code_links,snapshots}.rs`, new
  `src/commands/code_links.rs`, `project_id` in `code_roots` +
  persisted `next_id`; touches in `store/{schema,persist,actor,
  lib}.rs` + test, `api/{archive,ids,lib}.rs` + tests,
  `Cargo.toml`, `src/{lib,state,commands/{mod,archive,code}}.rs`.
- Unification (frontend): `CodeTree` (badge + menu),
  `CodeWorkspace` (projects, association, opening), new
  `ModuleCodeLinks` + test, new `structure/ProjectCodePanel` +
  test, `CodeTreeProject` test, new
  `requirements/projectFromFolder` + test,
  `RequirementsWorkspace` (`code` perspective, module hub,
  ⤴ from folder), `ExplorerPanel` (button), `uiStore`
  (`codeActiveFile`, `codeOpenRequest`), `saveStatus`,
  `App.tsx`, `styles.css`; `CenterView` includes `code`, no
  `WorkArea`.
- §23 refinement (frontend): new
  `src/components/{icons,icons.test,fileIconNames}`;
  `features/code/{fileIcons,CodeFileIcon}` as re-exports;
  `ExplorerTree.tsx` (unified set, icon on groups and states),
  `CodeTree.tsx` (icon on missing root),
  `structure/StructureView{,.test}.tsx` (+ Active folder, guide),
  `useCodeWorkspace.tsx` + `CodeMainPane.tsx` (propagation),
  `model{,.test}.ts` (`parentDir`, `folderScopeOutcome`),
  `fileIcons.test.ts` (extensions), `styles.css`
  (`.struct-guide`); docs (`arquitectura` §23, `decisiones`,
  this file).
- Living diagrams §24 (stage A): `structure/{structureTypes,
  structureMerge,tsAnalyze,apiLinks,ApiPanel,DataPanel}` +
  tests; `StructureView` (tabs) + test; `code/structure.rs`
  (API walker, `visit`) + `code` DTOs; snapshot caps + test;
  `styles.css` (tabs, data, APIs).
- Living diagrams §24 (stage B): new `meta/code.rs` + tests;
  new `store/codegen.rs` + v13 (`schema,persist,actor,lib`) +
  roundtrip; new `api/codegen.rs` + tests; `ids` (`cgen-N`);
  `code/{lib (create_file,file_exists),Cargo}`; new
  `commands/codegen.rs` + registry; `state.rs` + `Ready`;
  `code/{types,client}` (DTOs); `diffStructure` + test;
  `CodeProposalDialog` + test; `CodeTree{,Pane}` (refresh) +
  test; `useCodeWorkspace` (`notifyFileChanged`, `treeRefresh`);
  `CodeMainPane` (propagation); docs (`arquitectura` §24,
  `alcance`, `decisiones`, `README`, this file).
- Structure replication §25: new `api/replicate.rs` + tests;
  new `commands/replicate.rs` + registry;
  `store/{code_roots,code_links,persist,actor}` (atomic
  `save_replication`); `code/{types,client}` (DTOs); new
  `ReplicateDialog{,.test}`; `CodeTree{,Pane}` (menu +
  dialog); `useCodeWorkspace`
  (`replicateRoot/handleReplicated`); `uiStore`
  (`explorerToken`); `RequirementsWorkspace` (refresh);
  `Explorer{Tree,Panel}` (chip + jump) + `styles.css`; docs
  (`arquitectura` §25, `alcance`, `decisiones`, `README`,
  this file).
- Project deletion (§13): `core::{error,store}`
  (`DeleteProjectNotEmpty`, `delete_project`) + test;
  `api::{dto,error,archive}` (`project` summary with modules,
  `delete_project_checked`) + tests; `commands/archive.rs`
  (`core_delete_project`) + registry; `archive.ts` (project
  target); `ArchiveDialog{,.test}` (modules section, no
  archiving); `client.ts` + `types.ts` (`modules`);
  `RequirementsWorkspace` (key, preview, execution, impact);
  `Explorer{Tree,Panel}` (step + honest menu) + test; docs
  (`arquitectura` §13, this file).
- Orphan test batch: `RenameDialog.test`,
  `UnsavedDialog.test`, `tsWorkerClient.test` (fallback
  without Worker and with a broken worker) and actor dispatch
  (`store/actor.rs`: roundtrip + atomic replication).
- Architecture map (EN): new
  `archmap/{archLayers,archModel,ArchMapLanes,ArchMapInspector,
  ArchMapView}{,.test}`; `structureTypes.ts`
  (optional kinds/imports/decorators); `tsAnalyze.ts` (+tests:
  imports, decorators, `instantiates`, constructors, enums);
  `StructureGraph.tsx` (new edge style); `useCodeWorkspace` +
  `CodeMainPane` (Map mode); `styles.css`; docs (new
  `architecture-map.md`, `alcance`, `decisiones`, `README`,
  this file).
