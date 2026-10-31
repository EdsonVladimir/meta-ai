# Ruth IDE UI/UX audit — first-time developer

Date: 2026-10-31. Scope: journeys A–H and cross-cutting usability.

## Executive assessment

**Desktop usability has not been verified.** This session could inspect the
repository but could not operate a native application or a browser. It cannot
determine whether a first-time developer can independently complete Ruth's
principal tasks. This report is a constrained audit with a reproducible desktop
validation plan and secondary source-based risks, not a completed usability test.

The highest-impact risks to validate are inconsistent draft protection across
close routes, incomplete disclosure of assistant context, ambiguous entry
terminology, keyboard recovery in dialogs, and opaque module identifiers in
export. Small changes should address these before considering a redesign.

No product defect was reproduced through the UI. No P0 is established. Severity
below describes provisional impact **if the source-based risk is reproduced**,
not measured incidence or a desktop test result.

## Method, environment and evidence

Read `AGENTS.md`, `docs/continuidad.md`, the README startup instructions,
`docs/arquitectura.md`, and relevant source components. The initial working tree
was clean (`git status --short` returned no entries). No credentials, `.env`
files, existing user database or private test projects were opened.

Startup inspection found:

- `npm run dev`: Vite frontend, without native functionality.
- `npm run tauri dev`: desktop, starting Vite via `beforeDevCommand`.
- `src-tauri/tauri.conf.json`: localhost port 1420; default 1100 × 750,
  minimum 880 × 600, undecorated native window.
- Existing Vite executable and compiled desktop executable are present.
  Their presence does not establish that either can run or be controlled here.

Actual UI-tool attempts, in order:

1. `cua.getState()` returned `{"apps":[],"browsers":[]}`. The tool configuration
   explicitly disables native computer APIs.
2. `cua.createBrowserTab("iab", "http://127.0.0.1:1420", {visible:true})`
   returned `Browser is not available: iab`.

These are environment observations, not application findings. No application
was launched: a native launch would not provide a permitted controllable
surface, and an uncontrolled launch could open an existing user database.
No fallback UI, mocks, screenshots or desktop interactions were fabricated.
No screenshots could be obtained. No installs, API calls, terminal sessions,
commits, pushes, code changes or deletions were performed. Only this report was
added. No code tests were run; documentation changes do not prove UI behavior.

Evidence classifications:

- **Observed problem:** reproduced on an actual application surface. None here.
- **Code-derived risk:** supported by inspected source; needs UI reproduction.
- **Aesthetic preference:** subjective presentation choice, not a task failure.
  None used as a defect in this report.
- **Unverified:** insufficient runtime evidence, including all desktop journeys.

## Expectation log and task status

The expectations below were recorded before attempting the corresponding
application tasks. Once tool discovery blocked UI access, no task was clicked;
source inspection followed the failed access attempt. “Blocked” describes the
audit environment, not a failure of Ruth. Follow-on behavior is “Not verified”.
No journey can honestly be marked Completed or Completed with difficulty.

| Task | Expected action before the task | Actual evidence / status |
| --- | --- | --- |
| A1 First entry | A concise purpose statement and one obvious start action | Blocked: no UI surface |
| A2 Open / new / workspace | Choices explain folder registration versus a blank project and reopening saved work | Not verified; R3 |
| B1 Open nested frontend/backend | Pick a public fixture folder; see root and nested project identities | Blocked: native picker unavailable |
| B2 Select, expand, eye | Separate controls; scope and visibility changes clearly distinguished | Not verified; R4 |
| B3 Switch away and return | Visible return path, preserved work, explicit active project | Not verified |
| C1 Read columns/cards/members | Explain detected language, role, visibility and relation direction | Not verified |
| C2 Imports/calls/unresolved | Textual legend and evidence distinguish relation kinds and resolution | Not verified |
| C3 Partial analysis | Counts, limits, continuation, cancel and retry distinguish partial from complete | Not verified |
| C4 Find/filter/zoom/fit | Search, understandable module filter, fit control and reversible filters | Not verified |
| D1 Edit and save | Active title, unsaved/saving/saved/error, Save and Ctrl+S | Blocked: no editable UI |
| D2 Leave with drafts | Save / discard / cancel, including native close routes | Not verified; R1, R5 |
| D3 External conflict | Compare, reload or explicitly replace without silent loss | Not verified |
| D4 Continue without approval | Saving/manual editing do not require approval | Not verified |
| E1 Requirement to mockup | Create a requirement/module and find related mockups, flow and data | Blocked: no UI |
| E2 Edit components | Add component, edit properties, save and distinguish generated proposals | Not verified |
| E3 Detected versus designed | Source/provenance distinguish code detection, manual design and AI proposal | Not verified |
| F1 Context and API boundary | See saved context, outgoing content and network-triggering action | Blocked: no UI; R2; no real requests permitted |
| F2 Proposal lifecycle | Understand incorporation versus approval/save and stale results | Not verified |
| F3 Errors/limits | Actionable local notices; do not need internal prompt knowledge | Not verified; real requests excluded |
| G1 Sessions | Open, hide, create, switch tabs/split and close named sessions | Blocked: native PTY unavailable |
| G2 Session context/focus/resize | Per-session folder, focus, controls and stable resize | Not verified |
| G3 Hide lifecycle | Explicitly learn that hidden processes keep running | Not verified |
| H1 Delivery/export | Preview saved versions, draft versus approved package and file contents | Blocked: no UI; R6 |
| H2 Cancel/history | Cancel without loss; immutable historical snapshot distinct from current work | Not verified |

### Safe desktop replay setup

Use a separate OS test profile with an empty Ruth application-data directory;
do not move, reset or delete the owner's database. Copy the repository's
`examples/reservas` fixture into an identifiable temporary folder named
`ruth-uiux-audit-2026-10-31`. Review only that fixture, not arbitrary recents.
Create design data under project name `UI UX Audit 2026-10-31`; leave it intact
and record its location. Do not supply a Meta key or press network actions.
Mock network error/stale cases only in an explicitly separate fixture harness,
and label those results as harness evidence, not real API behavior.

## Findings — secondary evidence only

For every finding, the steps are **proposed reproduction steps**, not actions
performed. Screenshots: unavailable for all findings.

### R1 — Native close may bypass unsaved-draft protection

- Classification / severity: code-derived risk; provisional **P1**.
- Screen/task: editor, D2; close with an unsaved requirement, mockup or code file.
- Reproduction: in isolated test data, save a version, edit it, then invoke the
  OS window-close shortcut with no terminal running. Compare with Ruth's custom
  close button. Repeat with a terminal and cancel the close confirmation.
- Expected: every normal close route offers Save all / Discard / Cancel and
  honors failed saves before allowing closure.
- Source evidence: `src/app/App.tsx` `requestClose` checks `dirtyDocKeys` and
  opens `CloseGateDialog`; `src-tauri/src/lib.rs:119` intercepts
  `WindowEvent::CloseRequested` only when `running_count() > 0`. The inspected
  native handler has no equivalent draft check. No actual data loss was tested.
- Consequence: an ordinary native close could lose in-memory edits while the
  custom button creates an expectation of consistent protection.
- Proposed correction: route native and custom close requests through one
  draft/terminal close coordinator, preserving explicit discard semantics.
- Acceptance: native shortcut and custom button both preserve drafts on Cancel;
  failed Save all keeps the window open; successful save permits close;
  terminal confirmation cannot bypass pending drafts. Test in isolated data.

### R2 — Assistant context summary omits part of outgoing context

- Classification / severity: code-derived risk; provisional **P1**.
- Screen/task: code assistant composer, F1.
- Reproduction: open the fixture folder, uncheck a source file, ask a code
  question, then ask a follow-up. Inspect outgoing payload in a local fake
  adapter, with no network. Compare it with the visible context disclosure.
- Expected: before Ask, the user understands what content and metadata leave
  the machine, whether history is sent, and that the action invokes an API.
- Source evidence: `src/features/assistant/MusePanel.tsx:779` displays
  `Muse reads N of M files here`; `runAsk` (around line 362) appends the names
  of other files as `Also in this folder, not included` and sends `history` to
  `api.ask`. The Ask tooltip at line 820 says `Nothing changes`, without an
  explicit network notice there. This does not establish that unchecked file
  **contents** are sent; the extra evidence concerns names and conversation.
- Consequence: selected-file count may be mistaken for a full account of
  transmitted context; a read-only operation can still transmit information.
- Proposed correction: show a concise persistent notice for API invocation,
  selected source contents, other filenames and conversation history; allow
  reviewing the complete context categories before sending.
- Acceptance: a fake-adapter payload matches the disclosed categories for an
  initial question and follow-up; unchecked contents are absent; Ask and
  Propose clearly identify remote requests without requiring hover.

### R3 — Entry copy mixes workspace and project without an inline distinction

- Classification / severity: code-derived risk; provisional **P2**.
- Screen/task: Welcome and workspace selector, A2/B3.
- Reproduction: fresh isolated profile; read Welcome, Open project, New project,
  Recent workspaces and the selector without hovering. Explain the expected
  result of each choice, then open the public fixture.
- Expected: know which action opens existing code, starts a design-only
  project, or restores a saved working context.
- Source evidence: `src/features/workspace/WelcomeScreen.tsx:37` says
  `Open a workspace to start`, while its actions are Open project and New
  project. Their distinctions are primarily in `title` attributes. There is
  no separate Open workspace action in that component.
  `WorkspaceSelector.tsx` mixes Open project, New project and Switch workspace.
- Consequence: users may search for a missing workspace opener or assume New
  project creates repository files.
- Proposed correction: retain the current two actions; add one-line visible
  descriptions and define workspace once as the saved working context. Do not
  add a third action without a distinct operation.
- Acceptance: first-time participants correctly predict all three concepts
  without documentation or hover and open the fixture without creating code.

### R4 — Root visibility controls still refer to Map

- Classification / severity: code-derived risk; provisional **P2**.
- Screen/task: Folders tree, B2/C4.
- Reproduction: open nested fixture roots, select Architecture, use the root
  eye and a nested project's eye; read tooltips and accessible names.
- Expected: expand changes tree disclosure, select changes scope, and eye
  changes Architecture visibility, with consistent names.
- Source evidence: `src/features/code/CodeTree.tsx:534` labels the root control
  `Show/Hide the … diagram in Map` / `Show/hide in Map`, whereas the nested
  control at line 859 says architecture; `PerspectiveTabs.tsx` uses Architecture.
- Consequence: root and nested eye controls may appear to affect different
  views; screen-reader instructions reference a view that has no matching tab.
- Proposed correction: use Architecture consistently in visible and accessible
  labels; describe hiding as visibility, not selection or removal.
- Acceptance: root and nested eyes name Architecture; toggling never changes
  selection unexpectedly; the active scope remains readable and recoverable.

### R5 — Modal semantics lack local focus containment and some Escape handlers

- Classification / severity: code-derived risk; provisional **P2**.
- Screen/task: navigation/save/export dialogs, D2/H2; keyboard recovery.
- Reproduction: keyboard-open Unsaved changes, Export with unsaved changes and
  Close with unsaved changes; Tab/Shift+Tab, Escape, then verify restored focus.
- Expected: focus enters the dialog, stays inside, Escape safely cancels when
  appropriate, and focus returns to the triggering control.
- Source evidence: `UnsavedDialog.tsx:27` uses `aria-modal` with no local
  focus-management or key handler; `App.tsx` gate dialogs autofocus Cancel but
  contain no local Tab trap/Escape handler. BaselineDialog has an Escape handler,
  so blanket claims that all dialogs lack Escape would be incorrect. A shared
  runtime mechanism has not been demonstrated.
- Consequence: keyboard users may reach background actions or have inconsistent
  recovery. `aria-modal` alone does not implement keyboard behavior.
- Proposed correction: a small reusable dialog focus/return/Escape mechanism,
  with cancellation rules respected during active writes.
- Acceptance: complete the reproduction entirely by keyboard; focus cannot
  reach background actions; cancellation preserves work; focus restores.

### R6 — Delivery module picker displays opaque IDs instead of names

- Classification / severity: code-derived risk; provisional **P2**.
- Screen/task: Export → Prepare delivery, H1.
- Reproduction: create two clearly named fixture modules, open Work and Approved
  preparation, and identify the intended scope using only the module picker.
- Expected: choose a module by the name used in the project tree.
- Source evidence: `DeliveryDialog.tsx:163` and
  `BaselineDialog.tsx:303` render option value **and text** as `m.id`.
- Consequence: users must remember ID/name mappings and can prepare the wrong
  scope even when the export itself is internally correct.
- Proposed correction: show the module name; append ID only for disambiguation.
  Keep serialized IDs unchanged.
- Acceptance: two named modules are selectable by name in both export modes;
  the preview confirms the selected name and the correct saved versions.

### R7 — Assistant identity and entry points require users to reconcile names

- Classification / severity: code-derived risk; provisional **P2**.
- Screen/task: Assistant and Architecture, F3.
- Reproduction: open Assistant with a selected module, then use Ask Muse on a
  file, then return to Architecture's proposal action; describe the difference.
- Expected: one recognizable assistant identity and clear context-specific
  modes, with no need to infer service/model names.
- Source evidence: `RequirementsWorkspace.tsx:3165` labels the tab Assistant,
  mounts `MusePanel` for a code target or `AssistantPanel` for a module;
  `ArchitectureView.tsx` says Propose with Muse; `App.tsx` says Meta connection.
- Consequence: users may mistake separate contexts for separate services or
  expect the same context to carry across modes.
- Proposed correction: use Assistant as the product name, label Code context
  and Module context, and retain Meta as provider information.
- Acceptance: switching modes visibly updates the context summary; users can
  explain which saved artifacts/files are used and where a proposal will go.

## Five prioritized corrections

These are diagnostic recommendations, not implemented changes. Validate the
two provisional P1 risks before prioritizing cosmetic work.

| Priority | Small correction | Impact and verification |
| --- | --- | --- |
| 1 | Unify native/custom close protection (R1) | Prevent possible draft loss; exercise all normal close paths |
| 2 | Disclose complete assistant context and API boundary (R2) | Make informed sending possible; compare with fake payload |
| 3 | Explain Open/New and workspace inline (R3) | Remove the first-entry conceptual obstacle; first-time prediction task |
| 4 | Standardize dialog focus and safe cancellation (R5) | Make navigation/recovery usable by keyboard |
| 5 | Show module names in export (R6) | Avoid wrong scope selection; verify preview against named fixture modules |

R4 and R7 are further narrow terminology fixes. None requires changing domain
contracts or replacing the application layout.

## Suggested terminology

| Current wording | Suggested wording / explanation |
| --- | --- |
| Open a workspace to start | Start with a project |
| Open project | Open project folder — reuse or register an existing folder |
| New project | New project — start with requirements and designs; add code later |
| Recent workspaces | Recent workspaces — saved project and folder contexts |
| Map (root eye tooltip) | Architecture |
| Muse / Assistant / Meta | Assistant in navigation; Code context / Module context; Meta as provider |
| Ask | Ask assistant, with visible “Sends context to Meta” notice |
| Propose change | Propose code change, explaining the saved requirement side effect |
| Work / Approved | Work delivery / Approved baseline |
| Baseline | Approved baseline — a fixed set of reviewed versions |
| Scope module + ID | Module + human-readable name |
| Module (Architecture filter) | Code module/group; preserve Declared, Linked and Directory groups |

Names are proposals to validate, not verified usability improvements. Do not
translate stable IDs, persistence keys, DTOs or historical user content.

## Source-supported strengths to preserve and verify

These are implementation affordances, **not runtime successes**:

- Welcome explains connected requirements/mockups/diagrams/code and says that
  its start actions do not create repository files.
- `App.tsx` exposes textual unsaved, saving, saved and failed states with retry,
  and distinguishes other dirty documents. Export offers Save all, export saved
  work or cancel; approval is not part of that gate.
- `ArchitectureToolbar.tsx` provides search, grouped module filters, relation
  direction/depth, grouping and a legend. `ProjectMapView.tsx:1889–1962`
  distinguishes TypeScript-only scope, partial analysis, pending work and retry.
- `MockupsPanel.tsx:141` describes blank manual mockups;
  `ScreenProposals.tsx:215` discloses requirement content going to Meta and
  contains stale-context guidance. These deserve a no-request desktop check.
- `TerminalPanel.tsx:515` says hiding keeps sessions running, line 530 explains
  the folder for new sessions, and per-session clear/close controls describe
  their different lifecycle effects. Actual focus, resize and PTY behavior
  remain unverified.
- Work delivery copy explicitly says review is not required; Approved remains
  a distinct mode. Existing safeguards should remain intact during copy fixes.

## Cross-cutting coverage and remaining checks

| Aspect | Audit conclusion / required evidence |
| --- | --- |
| Hierarchy, primary action, empty states | Copy inspected; first-glance comprehension and discoverability unverified |
| Names, icons, duplicate/inert controls | Concrete naming risks above; icon comprehension and actual action effects unverified |
| Truncation, density, readability | No rendered measurements; check long names and large symbol/member lists |
| Color consistency and non-color meanings | Text states/legend exist in source; rendered color dependence unverified |
| Contrast and accessibility | No contrast measurements, screen-reader run or conformance claim |
| Keyboard and visible focus | CSS contains focus-visible rules; actual focus order/visibility unverified; R5 |
| Panels, scrolling and resizing | Check 1100×750 and 880×600, maximized, display scaling, long paths, split terminals |
| Progress, cancel and responsiveness | Analysis branches exist; real delays, cancellation and blocking unverified |
| Data safety and recovery | R1 plus unverified conflict/save-failure/navigation cases; no loss induced |
| Detected / inferred / proposed / verified | Inspect provenance labels in real cards, overlays, diagrams and export; no visual proof |
| History versus current version | Verify pinned historical versions, current title differences and export snapshot contents |

## Follow-up with real users

Recruit developers who have not read Ruth's documentation. Give them the safe
fixture and task goals, not UI instructions. Record first action, time to first
useful result, wrong turns, help requests, completion, and their explanation of
workspace/project/module, relation direction, partial analysis and proposal
state. Ask them to predict what Save, Ask, Incorporate and Export do before
acting. Use a fake assistant response in a separately labeled test setup.

Have users open nested frontend/backend projects, locate a symbol, fit the
diagram, edit/save/navigate, link a requirement to a mockup, hide/reopen a
terminal, and prepare/cancel a work delivery. Observe errors and recovery rather
than just asking preferences. Include keyboard-only and assistive-technology
participants and relevant display scaling. A code review cannot establish
comprehension, task completion, legibility, actual accessibility or confidence.

The next audit must attach real screenshots and interaction outcomes to these
same IDs, revise provisional severities, and explicitly distinguish reproduced
defects from risks that did not reproduce.
