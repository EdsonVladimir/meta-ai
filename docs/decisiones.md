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

### Code X-ray and Muse (October 2026)

Each entry says why, so a later change can tell whether the reason
still holds. Commits are on `code-xray`.

**Focus**

- **The demo order is: one conversation, a real proposal accepted and
  compiled, the executable, then the Pages view.** The Meta video is due
  2026-11-04, with a freeze on 2026-11-03. The conversation came first
  because talking to Muse is the core of the demo. Pages moved after
  delivery unless time remains. It replaced the earlier order
  (Muse test, executable, Pages) once the first real test showed that
  the dialog was the weak point. Pages was then built before delivery.
- **Private code reaches Meta only when its owner decides, and never
  appears in published material.** The owner allowed it for a project in
  development. The demo still runs on the public `examples/reservas`, and
  Never send to Muse remains for code that must stay local. Before
  anything is published, check names and metrics, not only one word.
- **External agents implement and Claude audits.** Each task is one
  prompt in a fresh session. Passing tests is not enough to approve: the
  audit reads the diff and runs the flow in a real browser, because the
  worst defects of this work passed every test.

**Talking to Muse**

- **Work starts from folders, files or components, not from projects.**
  Going up to Projects to pick a module was the wrong entry point. The
  domain did not change: a requirement still needs a project and a
  module, because traceability, impact and export depend on them, so
  Ruth creates them from the folder on first use (`2b41426`).
- **Projects stays as the place for requirements, with a movable
  split.** Folders shows files; requirements, designs and mockups need a
  home. It had a fixed share, so a handle was added (`1b55332`).
- **Ruth chooses what Muse reads; the list is one click away.** A list
  of checkboxes made the person decide before saying anything, and the
  first files of a folder left out the store and the service. Files are
  now a spread of roles, and the names left out are sent too (`75fe761`).
- **Two buttons instead of a mode switch.** Ask and Propose change say
  what each does. There is no silent classifier: the person chooses, and
  an answer can become a change without retyping (`75fe761`).
- **Ask helps with what does not exist yet.** Told to answer only from
  the files, Muse refused design requests. Facts about the code still
  come only from the files; plans and drafts are allowed, labeled as
  suggestions (`f90ac7b`).
- **One conversation, in the Assistant tab, beside the X-ray.** A chat
  with no memory plus a modal dialog hid the files once X-ray opened,
  and questions could not be answered. Proposals are now cards in the
  thread, with Accept and Discard, and the board stays visible
  (`07b213d`, `7e005b5`, `cb5eaf1`). The thread lives in memory for now;
  requirements and proposals persist.
- **Answers and adjustments are new requirement versions of one
  requirement.** Each change creating another requirement left duplicates
  and hid how the request evolved. If the requirement moved on, the
  adjustment stops. If generation fails after saving, Retry reuses that
  save, and new adjustments wait for it, so nothing is saved twice.
- **Replaced proposals stay read-only in the thread.** Only the newest
  card decides files, so nobody accepts from a version already replaced.
- **"This component calls the service directly" comes from the analysis.**
  A new component going straight to a service shows no store on its own
  chain, so the check reads the whole analyzed project: a UI symbol
  injecting a store that injects a service.
- **Card and X-ray show one proposal.** Accepting on either side updates
  the other through `museGeneration`, so they cannot disagree (`cb5eaf1`).
- **Proposals follow the project's layers.** Muse once went from a
  component straight to a service, skipping the store. The instruction
  now forbids skipping a layer, and template versions were raised so a
  proposal shows which rules produced it (`07b213d`).
- **Never send to Muse is enforced in Rust.** One click makes it easy to
  send a confidential folder, so the mark lives in the database (schema
  v16) and is checked in `read_scope_files`, which every prompt path
  uses. The interface only explains it. It is per workspace root and off
  by default, so a new client folder must be marked (`2b41426`).

- **What leaves the machine is said in plain view.** The file count
  alone hid that the names of other files and the conversation go too,
  so the panel states them above the box, without needing a hover. From
  the first-time developer audit (`docs/audits/ui-ux-audit.md`), R2.

- **Accepting a file creates the folders it needs.** The original rule
  was that accepting creates no folders, but a new feature almost always
  needs one, and the first real proposal could not be accepted. Folders
  are made one by one inside the root, never through a link, and removed
  again if the write fails.

- **Accept all stops at the first failure.** A proposal is reviewed as a
  set, so one click may decide it, and the button names how many files
  it writes. Stopping keeps the rest pending, with the reason in view.

- **An adjustment sees what was already accepted.** After Accept, a
  later adjustment could not reach those files: Muse had not read them
  and marked them `create`, which can never be accepted. They now go
  first in its scope, and a `create` over an existing file is recorded as
  the `modify` it is, with the file's real fingerprint, so View diff
  shows what it replaces. Nothing is overwritten without Accept.

- **Each folder or file keeps its own conversation.** Going elsewhere
  used to erase a thread, with proposals still pending. Threads now stay
  by target, and closing one with pending files asks first.

**One project at a time**

- **Folders and Projects show the active project only.** Roots were
  global: opening a project piled its folder onto earlier ones,
  closing only cleared the selection, and Remove left the project
  with no way out of the list, because `delete_project_checked`
  refuses a project with bound folders, baselines, deliveries or
  generations. Opening another project now switches to it in the
  same window through the existing close gate, so unsaved changes
  and open terminals are covered and no tab or thread survives.
  Earlier projects are not deleted and no data changes.
- **No project becomes unreachable.** The Welcome screen lists
  recent workspaces, and All projects lists every stored
  project with or without folders or a Recents entry; opening
  from there reuses the entry when one exists, so no duplicate
  appears. Forget was already there and only drops the entry's
  row (`recent_remove` rewrites the recents list and cannot
  reach project data). Touches never match two entries by path
  set when the set is empty, so folder-less projects keep
  separate entries. Create project, Create a project from a
  code folder and the Delete permanently rules stay as they
  are; created projects land on Architecture and join Recents
  so they stay reachable.
- **Loose folders hide, stay stored, and are never rebound
  silently.** No migration and no auto-linking: hiding is a
  frontend filter over the stored rows. Opening a loose folder
  with Open project still creates and links a project as
  before. A folder added while a project is active joins it;
  when the link fails the folder is dropped again instead of
  staying hidden with no way back.
- **Removing the last folder closes the project; a project with
  no folders never closes itself.** The close goes through the
  same gate and back to Welcome; the project stays stored and
  reachable from Recents, whose entry keeps the remaining paths
  so reopening never resurrects the removed folder.
- **A project keeps one Recents entry.** Touches had no id when
  folders changed, so a new entry appeared and the old one kept
  the removed path; opening it restored that folder. A touch now
  reuses the project's entry and drops any other entry of that
  project.
- **Hidden roots keep Never send to Muse.** The filter only
  hides rows; the mark lives in the database and
  `read_scope_files` still checks every root on every prompt
  path, so a hidden root never becomes sendable.

**No Overview tab**

- **Opening a project lands on Architecture.** Overview added
  little and owned a second, different Add folder; its Re-detect
  stacks button went with it. Every open/create path and the
  welcome fallback now land on one tested constant, and a
  module-less project still reaches Architecture as its only
  project view. Nothing persisted depended on the view and the
  Assistant never referenced it, so removal was safe.
- **One Add folder, with a confirmation across projects.** The
  Folders button is the only one while the project has folders;
  a folder-less project offers it from its Architecture empty
  state. Known folders are reused, never duplicated; moving one
  that belongs to another project asks first and names that
  project, and cancelling changes nothing. Stack detection
  stays because service detection in Folders depends on it;
  the analysis-summaries cache left with Overview, its only
  reader.

**Services on demand**

- **Above 3 detected services, unopened ones wait for a click.**
  Scope "all" used to analyze every service on entry, too slow
  for many microservices. At 3 or fewer everything maps by
  itself, so examples/reservas is unchanged; above that a
  service starts closed until clicked. Clicking its name opens
  its eye, records it as opened, and focuses the board on that
  service alone (chip plus way back to the joint view);
  clicking the eye opens it without changing the scope, and
  Show all opens every detected service and records them.
  Opened services persist next to the hidden ones with the
  same validation, and reopening reuses the cached board.
  Closing an eye removes the service from scope "all" and
  from entry analysis; with every eye closed the board says
  to click a service in Folders. Never send to Muse and
  proposal review never read eye state.
- **A scope never renders outside the active project.** A stale
  scope could paint another project's folder next to "No
  folders linked to this project yet", with its files counted
  as analyzed. Scoped sections and discovery now cover the
  active project's roots only; anything else reports that the
  folder belongs to another project, or that it left the
  workspace.
- **A proposed file never takes a sibling service's name.** With
  only `frontend` on the board, backend files were drawn as
  `frontend` cards. Now they stay off that service and the note says
  so, and Show on X-ray leaves a focus that would hide them. Clicking
  a service still focuses it: that is the on-demand design, and the
  chip below the board shows it.
- **Show on X-ray always draws, and Change files always lists what
  exists.** Leaving the flow used to silence the button until a new
  proposal, and the file list was read once per thread, so accepted
  files could not be chosen.

**From the first-time developer audit**

- **Every close route protects drafts.** The title-bar button asked, but
  the OS shortcut only looked at terminals, and drafts live in memory
  only. Rust now stops any close while drafts exist and the UI decides;
  one pass covers the close the person already confirmed, so cancelling
  a later terminal prompt keeps the protection.
- **Muse stays visible by name.** The audit proposed Assistant as the
  product name (R7). Rejected for now: using Meta's models is part of the
  hackathon score, and the name says who answers.
- **Keyboard focus in dialogs and studies with real users come after
  delivery.** R5 is real but blocks nobody, and users cannot be studied
  before the freeze.

- **Opening a project once is enough.** Folders listed only what it
  loaded at start, so a project opened from the first screen showed no
  folders and the person had to pick the same one again. Any registered
  root now reaches the panel.

**Reading code**

- **Pages orders an Angular app from its routes.** Symbols and Files show
  layers, not what a person navigates. A page is only a component a
  route targets, never by name or folder, and levels come from template
  tags, each at its deepest use. A component with 5 or more parents goes
  to Shared, so it does not repeat. One with no route or parent reads
  "No usage detected", because dynamic creation cannot be ruled out.
  Non-literal routes are listed as unresolved, never guessed.
- **A card never says a page is unused.** Reading the first version,
  "used by 0 components" on a page suggested dead code. Pages say "opened
  by 1 route", and the app says "shows the pages".

- **A proposal can be validated by looking at it, before Accept.** The
  popup draws a component's template and own CSS, and lists its form
  fields, so a requirement is checked in seconds. It is labeled
  approximate: no data, no logic, no global styles, no SCSS. A running
  app would need the code on disk, which defeats reviewing first.
- **The preview trusts nothing it draws.** That HTML may come from a
  model, so attributes are an allowlist, the document carries a CSP with
  no network, and the iframe sandbox runs no scripts.

- **Each card opens its TS, HTML and CSS in a read-only popup.** Going
  to Folders broke the reading of a board. It stays read-only because
  editing here would duplicate the editor and its saving rules; Open in
  code goes there. An inline template opens at its line in the source
  file, and a pending proposal shows its content, marked as not on disk.

- **External libraries are references, never detail.** We use them and
  do not change them: one card per package, with who uses it and what
  they import, off by default. Ownership comes from the imports, not a
  fixed `app/` or `src/` folder, so it works for Angular and Nest
  alike. A folder can be marked external for code kept in the project
  but treated as a library (`b8a6e5c`).
- **Marked folders still count as analyzed.** Marking changes what is
  shown, so unmarking needs no new pass. Flow and Muse still reach them.
- **A signal is a signal only if its class declares it.** `this.store.items.set()`
  used to vanish with no trace. It now reads as a write, proven against
  the injected class; what cannot be proven stays pending (`f2ed611`).
- **Templates join the chain; styles only exist.** Flow reads handlers,
  signal reads and writes, and child components by selector. Style
  files are only checked for existence: matching CSS classes to HTML
  costs a lot, gives doubtful links and does not help impact
  (`3177e6c`). HTML gets no cards of its own, because they would
  duplicate the component.
- **The board scrolls with the wheel; Ctrl+wheel zooms.** Moving through
  a large board mattered more than zoom (`4180e46`). The board fills the
  center, with the status bar on the bottom edge (`076defe`).

**Opening files over the views**

- **A file clicked in Folders opens at once.** It only added a tab,
  and the strip then took half the height of Architecture, so the map
  shrank under an empty band with no code. Opening shows the file, the
  strip takes only its own height, and the Architecture tab leaves a
  file. That tab did nothing once Architecture became the landing view.

**Reading and choosing what Muse sees**

- **Adjust proposal respects the chosen files.** It read only the
  first proposal's scope, so `@` and Change files did nothing there.
  In a real run Muse never saw the store, asked about it three times
  and proposed calls to methods that do not exist. Chosen files now
  go first.
- **Preview applies inline `styles`.** It only read style files, so a
  proposal with inline CSS looked unstyled.

- **A proposal's diff opens in a dialog.** Inside the Assistant it was
  too narrow to read. Accept and Discard stay in the dialog, so a file
  can be decided where it is read.
- **`@` adds a file to the message.** Typing it is faster than Change
  files, and the list reads the disk when it opens. It searches the
  thread's files, capped like Change files. An automatic pick makes
  room; a choice the person made is never changed, so a full one
  says so instead.
- **An NgRx `signalStore` gets a card.** `const X = signalStore(...)`
  is how those projects write stores, and Classes left the State layer
  empty. Members come only from literal `withState`, `withComputed`
  and `withMethods` objects. Anything else stays out: Ruth does not
  guess, and only this one call shape is recognized.

**Muse project context**

- **Each thread carries a short picture of the project, confirmed
  once.** Muse answered from at most 8 files per message and did not
  know what the project was. The context (architecture map plus chosen
  docs) now travels inside every Ask, Propose change, Adjust proposal
  and Retry of the thread, after the person confirms it once per
  project. Design in
  `docs/superpowers/specs/2026-11-01-muse-project-context-design.md`.
- **The map comes from the local analysis; docs are chosen files.**
  ProjectMapView publishes one summary per analyzed section into a
  session module, cleared when the workspace closes; the renderer
  names services, layers with counts, routes and main classes, and
  never guesses. Docs are saved `.md` files read from disk by Rust,
  never drafts. Suggested order per root: AGENTS.md, CLAUDE.md,
  README.md, then the docs tree, then a README.md in each detected
  service; the first 8 are checked by default, up to 40 listed.
- **Opt-in per project, reviewed before anything is sent.** A thread
  opening in a project with no stored choice shows one offer; Not now
  dismisses it. A line above the input reads the state (`Project
  context: map · 4 docs · Edit`, or `off · Set up`), and the dialog
  shows the map, the checklist with sizes, the totals against the
  limits, and the warning that chosen files go to Meta as they are.
- **No new call to Meta, and the backend still enforces the rules.**
  Opening, analyzing and confirming send nothing. Rust rejects docs
  over the caps, non-`.md` paths, and anything from an unknown or
  blocked root before any network; the prompt marks the context as
  background that the message files overrule. Empty context keeps
  prompts byte-identical. The panel drops missing and blocked docs
  with a notice and sends the first 8 checked.
- **The message comes first, then the context.** The context was
  budgeted first, as the design said, and that was wrong: with large
  files it silently dropped scope files the panel had promised, and an
  adjustment could lose the proposal it was adjusting. Now the context
  takes only the room left, docs leave from the end, and the prompt
  says how many. A file to modify matters more than background.
- **Known limit: a generation does not record which context it
  used.** Reproducing the exact prompt of an old proposal is
  impossible; recorded for a later slice.

**Packaging**

- **The sample runs for real, on SQLite with no setup.** A demo target
  that cannot start proves nothing. Nest and Angular configuration was
  added around the same 18 source files.
- **`tauri dev` uses `ruth-dev.db`; the installed app keeps `ruth.db`.**
  They could not run together, and Ruth working on Ruth needs both. The
  existing data stays with the installed app and nothing was moved.
- **Packages are `.deb` and AppImage for Debian.** Other systems must be
  built on those systems. Started from the menu the app has no key, so
  it is started from a terminal for now.

- **The whole repository is event work.** The owner confirmed that work
  started on 2026-10-26, the first commit, after the organizers allowed
  it. The README says so, and the earlier prototype stays declared.

**Agreed and not built yet**

- **Key screen:** store the key in the system keyring, so the app can
  start from the menu. New folders blocked by default is worth it if
  client code is opened often.

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
15. "Wheel zooms the board" — superseded: the wheel scrolls and
    Ctrl+wheel zooms, so moving through a board does not change it.
16. "External refs" as a name — superseded: it showed references
    outside the module, not libraries, so it is now "Outside module".
17. "Pick a project and a module before talking to Muse" — superseded:
    dialogs start from a folder, file or component.
18. "Checkboxes and a mode switch in the Muse dialog" — superseded:
    Ruth picks the files, and Ask and Propose change are two buttons.
19. "Modal dialog for proposals from Muse" — superseded in the Muse
    thread by cards beside the X-ray. The Propose with Muse button
    keeps its dialog.

Full detail on 1–4 in the
[live-design decision](decision-diseno-vivo.md).
