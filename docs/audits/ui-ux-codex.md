# Ruth IDE: failure-state usability audit

**The application could not be run and operated in this session. No running
screens were inspected. All screen behavior is UNVERIFIED; source findings are
explicitly CODE-DERIVED. There are no OBSERVED product findings or screenshots.**

Date: 2026-10-31. Perspective: a developer with no prior knowledge of Ruth.
Question: does each failure state explain what happened and what to do next?

## Boundaries and method

Read `AGENTS.md` first, then the continuity/startup instructions. The initial
working tree was clean. UI discovery returned `{"apps":[],"browsers":[]}`;
native computer APIs are disabled in the available tool configuration. Starting
an uncontrolled desktop instance could also open existing application data, so
no instance was launched. A browser-only rendering would not prove native
pickers, file access or desktop behavior.

Only `examples/reservas` was inspected as an example project; product source was
read to audit branches and copy. No other project was opened. No database,
application-data directory, credential or environment file was read, moved or
edited. No Meta action was pressed, no key was sought, no installations or
commits occurred. No fixtures were created, so no temporary fixtures required
cleanup. No code or tests were changed or run. This report is the only output.

Evidence labels:

- **OBSERVED**: seen on a running application screen. None in this report.
- **CODE-DERIVED**: behavior/message inferred from inspected source, not runtime.
- **UNVERIFIED**: rendering, actual interaction or unsupported conclusion.

Severity follows this request, rather than the earlier audit's scale:
P0 blocks a task; P1 misleads or risks work; P2 slows; P3 polish. All source
severities are provisional; they do not establish frequency or actual failure.
No confirmed P0 was found.

## Task log: expectations before each source pass and outcomes

These expectations preceded the corresponding source review, not invented
clicks. All interactive tasks were blocked by the unavailable UI. Suggested
steps below are reproduction instructions, not actions performed. Conditions
absent from Reservas were traced in source rather than introduced into its files.

| Task | Expectation recorded before review | What happened / evidence |
| --- | --- | --- |
| 1. No recents; missing recent | Clear start action; identify the missing folder and a safe way forward | CODE-DERIVED: `RecentsList.tsx:39` says “No saved workspaces yet. Open a folder or create a project.” Missing entries show a count and retain Open/Forget; no explicit locate/reopen guidance. See F1. Running screen UNVERIFIED. |
| 2. No TypeScript; TypeScript without Angular | Explain unsupported scope separately from empty Pages; suggest another useful view | CODE-DERIVED: `ProjectMapView.tsx:2494–2518` distinguishes TypeScript-only, no supported files and no Angular components/routes. No next action in the empty note. Reservas backend supplies non-Angular TypeScript; no-TypeScript variant was not created. See F2. |
| 3. No routes; missing target; computed path | Distinguish absent routes from unresolved target and unknown path | CODE-DERIVED: `compositionModel.ts` retains unresolved routes and “(computed path)”; `PagesNotes` tests whether a Pages column exists to claim no routes. See F3/F4. Reservas has a literal `/reservas` route; failing variants UNVERIFIED. |
| 4. Shared selector; component cycle | Explain ambiguity without choosing arbitrarily; identify the broken branch | CODE-DERIVED: ambiguity skips the link; notes say “Not linked, shared selector” and “A component cycle was cut.” Candidate/source details and next steps are absent there. See F5. |
| 5. Partial/cancel/continue/unreadable | Preserve clarity about partial results; distinguish continuation from retry and show failed paths | CODE-DERIVED: analysis offers Cancel/Retry/Continue, detailed partial caps and the first six unreadable paths. Details beyond six collapse to a count; error summary is generic. See F6. Actual cancellation and retention UNVERIFIED. |
| 6. Popup: missing assets/binary/large | Name the asset and cause; provide a feasible recovery route | CODE-DERIVED: tabs retain “(not found)”; read errors show normalized text. No direct retry; preview reads can lose the reason. See F7/F8. |
| 7. Broken HTML; SCSS | Clearly label approximate output, omitted styling and malformed input | CODE-DERIVED: approximate/no logic/global-style disclaimer and SCSS note exist; malformed markup can stop transformation without a diagnostic. See F9. |
| 8. Muse empty/blocked | Explain why sending is unavailable; never silently invoke Meta | CODE-DERIVED: empty folder says “No source files here”; blocked folder says nothing leaves the machine and hides the composer. Empty recovery is unspecified. See F10. No sending attempted. |
| 9. Proposal failure states | Distinguish saved work from failed generation; explain safe retry/conflicts/partial acceptance | CODE-DERIVED: stale blocks acceptance with a regenerate instruction; Resume is retained for Retry; acceptance checks fingerprints/existing files; Accept all reports where it stopped. See F11/F12. No requests or writes attempted. |
| 10. Long names/paths, many cards, 880×600 | Identify items without hover alone; keep recovery controls reachable at minimum size | CODE-DERIVED: fixed-height Pages cards, name/path titles, wrapped popup paths, scroll-limited preview notes. No rendered geometry/performance evidence. See U1. |

## Problems and smallest fixes

### F1 — Missing recent gives a count rather than a recovery instruction

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: Welcome → Recent workspaces.
- Steps to reproduce later: use a controlled missing-folder recent derived
  solely from the Reservas example; inspect the entry without opening other recents.
- Expected: which folder is missing, whether design data remains usable, and how
  to reopen the folder at its new location without deleting anything.
- Actual in source: `src/features/workspace/RecentsList.tsx:60–85` shows paths
  in a title, an `N missing` badge, Open and Forget. Forget correctly says files
  are kept, but the missing badge gives no next step. A restore error can be
  displayed separately; successful partial restore was not tested.
- Smallest fix: add one sentence: identify missing paths and direct users to
  Open project for a moved folder, accurately explaining retained design data.

### F2 — Unsupported/empty Pages explains the boundary but not the next action

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: Architecture → Pages.
- Steps: select Reservas backend rather than frontend; separately inspect a
  no-TypeScript condition in a future isolated fixture, without editing Reservas.
- Expected: understand that empty Pages is not failed analysis and find a useful
  supported board or scope.
- Actual in source: `ProjectMapView.tsx:2494–2518` says “maps analyze TypeScript
  only”, “No supported source files”, or “Pages reads Angular components and
  routes. None were found here.” No local recovery instruction is attached.
- Smallest fix: append “Choose the Angular frontend for Pages, or switch to
  Symbols/Files for other TypeScript code”, using the actual current control names.

### F3 — No resolved page is incorrectly described as no routes

- Evidence type / severity: **CODE-DERIVED · P1**.
- Screen: Architecture → Pages notes.
- Steps: with a controlled Reservas-derived route pointing to an unknown
  component, inspect notes when no route resolves to a component.
- Expected: “Routes were found, but their components could not be resolved.”
- Actual in source: `ProjectMapView.tsx:2407–2427` derives `hasPages` from the
  presence of a Pages column. Its false branch says “No routes were found” even
  when `composition.unresolvedRoutes` is nonempty; the following note lists
  those routes. A single failure can therefore produce contradictory guidance.
- Smallest fix: distinguish zero detected route records from zero resolved
  route targets; reuse unresolved counts rather than inferring route absence.

### F4 — Unresolved/computed routes lack a useful evidence trail

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: Pages route notes and page cards.
- Steps: inspect a missing target and a computed-path route from a controlled
  Reservas-derived fixture; try to identify the source to repair.
- Expected: source location, target name, whether the path or component is
  unknown, and a way to inspect it.
- Actual in source: `compositionModel.ts` stores unresolved `path`, `target`
  and `evidence`, but `PagesNotes` renders only three paths. Computed paths use
  the literal “(computed path)”; `PagesBoard.tsx` prepends `/` to the displayed
  route, which can resemble a real URL. Additional unresolved entries have no
  expandable list in that note.
- Smallest fix: show “Path computed at runtime” without the URL prefix; expose
  target and route evidence in expandable details, with source navigation.

### F5 — Ambiguity and cycle messages describe symptoms without locating them

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: Pages notes.
- Steps: use duplicate selector candidates and a component-reference cycle in
  a controlled Reservas derivative; read the note and locate the cause.
- Expected: conflicting component names/files or the cycle chain, plus a safe
  next action; no invented resolution.
- Actual in source: `compositionModel.ts` skips ambiguous links and counts
  cycles; `ProjectMapView.tsx:2419–2422` shows up to three selector strings and
  “A component cycle was cut.” No affected cycle chain or candidate list is
  supplied. The numeric cycle count is traversal-derived, not proof of a count
  of unique cycles. Detached cycles outside reachable app/page traversal are
  not established by this review as detected.
- Smallest fix: preserve the conservative behavior; expose affected files and
  a short “Inspect component imports/template references” instruction.

### F6 — Large unreadable-file sets and analysis failure hide actionable detail

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: Architecture analysis summary/details.
- Steps: cancel and retry analysis; in a future isolated fixture make more than
  six eligible files unreadable and inspect details. No permissions changed here.
- Expected: find every failed path and know whether Retry rereads files or
  Continue only processes pending batches.
- Actual in source: `sectionDetailNotes` at `ProjectMapView.tsx:1988` lists the
  first six unreadable files, then only a count. The inline error at line 2540
  says “Analysis failed” with Retry; the detailed status can contain the reason.
  Pending batches get Continue, but unreadable files are accounted as failed,
  not pending. A user can mistake Continue for a repair of failed reads.
- Smallest fix: expandable full failed-path list; inline reason or a direct
  Details link; “Retry after fixing unreadable files; Continue analyzes pending
  files” guidance. Keep honest partial counters and cancellation controls.

### F7 — Source popup errors have no direct recovery/retry

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: card source popup, HTML/style/code tab.
- Steps: open a missing template/style, or a binary/oversized asset. Restore or
  replace that test asset, then try the same tab again without closing the popup.
- Expected: path, reason and a clear retry or external-inspection instruction.
- Actual in source: `sourceTabs.ts` preserves missing tabs;
  `SourceViewer.tsx` renders “path was not found” or a normalized read error.
  The load effect depends on tab identity/properties; there is no Retry action.
  Missing tabs suppress Open in code. Binary/size reasons are clear in
  `src-tauri/crates/code/src/lib.rs:97–116`, but have no next-step copy here.
- Smallest fix: local Retry/Refresh and guidance to verify the relative asset
  path or inspect an unsupported file externally; retain the safe read limit.

### F8 — Preview collapses different read failures and silently omits children

- Evidence type / severity: **CODE-DERIVED · P1**.
- Screen: card popup → Preview.
- Steps: request Preview when its own template cannot be read; repeat with a
  missing child template and with an unreadable CSS asset.
- Expected: distinguish missing, permission, binary and size limits; identify
  omissions so a sketch cannot be mistaken for the complete component.
- Actual in source: `previewLoader.ts` `textOf` catches every read failure and
  returns null. Own-template failure becomes “Could not read the template of
  NAME” without path/reason; CSS becomes “Could not read PATH”; a child whose
  template is null is skipped with no note. Ambiguous child matches are also
  skipped. An approximate-preview disclaimer exists but does not explain these
  specific omissions.
- Smallest fix: retain normalized error/path and add an omitted-child note.
  Offer source inspection/retry; keep preview failure separate from analysis.

### F9 — Malformed HTML can produce a partial sketch without a diagnostic

- Evidence type / severity: **CODE-DERIVED · P1**.
- Screen: card popup → Preview.
- Steps: in a controlled Reservas-derived template use an unterminated quoted
  attribute or interpolation after visible content; compare source and preview.
- Expected: identify where parsing stopped and qualify the remaining preview
  and field summary as incomplete.
- Actual in source: `templatePreview.ts` `readAttributes` returns null for
  incomplete markup; `transform` breaks without returning a parse diagnostic.
  `buildPreview` still returns document and fields. `SourceViewer.tsx` can then
  say “No form fields” despite an unprocessed tail. Its approximation disclaimer
  does not distinguish malformed-input truncation. SCSS is separately and
  correctly disclosed as not compiled by `previewLoader.ts`.
- Smallest fix: return a parser note with the approximate stopping location;
  label the field summary incomplete. No full compiler is needed.

### F10 — Empty Muse context gives no way forward

- Evidence type / severity: **CODE-DERIVED · P2**.
- Screen: Muse composer.
- Steps: inspect an empty eligible context; separately inspect a folder marked
  blocked. Do not press Ask, Propose, Adjust or Retry.
- Expected: understand why sending is unavailable and which local action can
  change the context.
- Actual in source: `MusePanel.tsx:782` says “No source files here”; `canSend`
  requires files. Blocked state at line 624 clearly explains that the folder
  is never sent and hides the composer. Neither message offers a next step.
  The blocked state is intentional protection, not a sending defect.
- Smallest fix: for empty context, suggest choosing a source-bearing folder/file;
  for blocked context, explain that protection is deliberate and how to choose
  another context. Do not encourage bypassing the block.

### F11 — Failed generation does not explain that a requirement may already exist

- Evidence type / severity: **CODE-DERIVED · P1**.
- Screen: Muse thread → failed proposal / Retry proposal.
- Steps: source-only trace of requirement creation succeeding and generation
  failing; inspect Retry and adjustment paths. No request was made.
- Expected: “Requirement saved; generation failed. Retry resumes from that
  saved version”, or a distinct message when saving itself failed.
- Actual in source: `MusePanel.tsx:420–454` creates the requirement before
  generation, stores `resume` on failure, and `retryProposal` reuses it. This
  avoids duplicate creation. The rendered failure at lines 761–771 shows the
  error and “Retry proposal”, without indicating the persisted side effect.
  Adjustment can similarly save a version before generation fails.
- Smallest fix: use `resume` to show the saved requirement/version status and
  explain what retry repeats. Preserve the existing resume protection.

### F12 — A failed diff read is represented as an empty original file

- Evidence type / severity: **CODE-DERIVED · P1**.
- Screen: proposal → View diff.
- Steps: source-only trace of a modify proposal whose current file read fails;
  open its diff again after the file becomes readable.
- Expected: unavailable original, disabled comparison, explicit reload.
- Actual in source: `ProposalFiles.tsx:65–80` stores an empty string on read
  failure, then shows `CodeConflictDiff` with that empty original. A separate
  notice explains failure, but the comparison can visually imply all-new text.
  The cached empty string prevents another read on reopening the diff. Accept
  remains governed by backend checks, so silent overwrite is not established.
- Smallest fix: model read failure separately from empty content; show an error
  instead of a misleading diff and provide Reload current file.

## Task 9: proposal-state coverage, including behavior worth keeping

All entries below are **CODE-DERIVED**; none was triggered or observed.

| State | What source communicates/enforces | Recovery assessment |
| --- | --- | --- |
| Stale proposal | `CodeProposalDialog.tsx:616` gives reason, blocks acceptance and names “← New proposal”; `ProposalFiles` disables Accept/Accept all | Good explicit next action in dialog; running thread parity UNVERIFIED |
| Failed generation | Error plus Retry proposal; saved `resume` is reused | Safe resume exists; persisted side effect needs explanation (F11) |
| Retry Ask | Reuses failed question, files and history via `runAsk` | It is another API call, not a local refresh; visible outgoing-context notice now exists. Never clicked |
| Version/context conflict | `api/src/codegen.rs:700–809` validates source freshness and fingerprints before acceptance | Reason is shown via normalized error; per-file UI could add “Re-analyze and generate a new proposal; your disk file was not replaced” |
| Create target already exists | Same API checks existence; `code/src/lib.rs:126` says “already exists and is not overwritten” | Honest prevention; add a choose-new-path/regenerate instruction rather than a force action |
| Accept all stops halfway | `ProposalFiles.tsx:115–143` stops at first failure and says “N of M accepted; the rest stay pending”; per-file states update after each success | Correctly discloses non-atomic batch behavior; do not promise rollback. Recovery should identify accepted files and allow remaining decisions |

## U1 — Long names, many cards and minimum window: UNVERIFIED

Screen: Welcome, Pages board, source popup, proposal diff; task 10.
Proposed steps: use long labels/paths derived only from Reservas, select/search
many cards and open source/preview at 880×600. No such fixture was created and
no resize occurred. Expected: distinguish same-prefix names, reach Close/Retry,
scroll notes and recover framing without losing selection.

Source evidence: `PagesBoard.tsx` fixes card height at 92 and lays every node out;
card title includes name/path; route tooltip contains full routes. CSS truncates
column hints and recent labels, wraps popup paths, caps preview notes at 5rem
with scrolling, and makes the popup `100vh - 3rem` with hidden overflow.
These are implementation choices, not proof of clipping, readable text or
acceptable performance. Keyboard access to full truncated strings, high scaling,
many-card latency, zoom/fit, and popup control reachability remain UNVERIFIED.
No severity assigned without an actual problem. Smallest fix, only if reproduced:
expose full text on focus/selection and keep action rows reachable; do not redesign.

## Five fixes worth doing before a three-minute demo

Ranked by misleading output and recovery cost, conditional on confirming the
source paths. No fixes were implemented.

1. Correct the no-routes versus unresolved-routes message (F3); name the target
   and offer evidence details in the same small pass (F4).
2. Keep unreadable originals out of the proposal diff; add Reload (F12).
3. Report malformed/omitted preview content and retain read failure reasons
   (F8/F9), so the preview never appears more complete than its evidence.
4. Explain “requirement/version saved, generation failed; retry resumes” (F11).
5. Add concise recovery guidance to analysis failures and expose unreadable
   paths beyond the first six (F6). Keep Cancel, Continue and Retry distinct.

## Confusing does not automatically mean defective

- Pages is Angular-specific; non-Angular TypeScript belongs on another board.
  That scope limit is not an analysis failure, although its next action needs copy.
- A computed route path is unknown statically, not necessarily broken at runtime.
- Duplicate selectors cannot always be resolved; refusing to invent a link is
  correct. “Shared selector” ambiguity differs from the Shared composition column,
  which means usage by five or more parents.
- “No usage detected” is appropriately weaker than “unused”; dynamic creation
  is explicitly acknowledged. A cut composition cycle is an analysis boundary,
  not proof that the application itself fails at runtime.
- SCSS/global-style omission and a static preview without Angular execution are
  disclosed limitations. They should not be presented as a verified live UI.
- A blocked Muse folder, a binary/size limit, stale acceptance protection and
  refusing to overwrite an existing create target are safeguards.
- Accept all is sequential and can leave already accepted files on disk; the
  existing stopped-at/count message is valuable. A failed later write does not
  imply rollback of earlier successful writes.

No accessibility conformance, visual correctness, task completion or actual
data-loss result is claimed. A follow-up needs a controllable desktop with only
the allowed example and explicit safe handling of application data. Until then,
these remain source-based diagnostics and unverified reproduction plans.
