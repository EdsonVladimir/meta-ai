# Ruth IDE consistency audit: names, buttons, wording and claims

Date: 2026-10-31. Commit audited: `d480c18` (branch `code-xray`, clean at start).
Target: `examples/reservas` only.

## Can the app run? Yes, with limits

The real desktop app was run and driven. It was the debug binary against the
already running Vite server, on a private virtual display, with a throwaway home
and data folder and with no API key in its environment. It has no window
manager, so the window was sized by hand to 1680 × 1000.

- **Reached on screen:** first screen, Open project, Overview, Architecture
  (Symbols, Pages, Flow), card HTML and Preview, folder menus, Muse panel before
  sending, Propose code dialog, Meta Assistant, Meta connection, Manual analysis,
  Requirements, Impact, Traceability, Review and Never send.
- **Not reached:** no message or proposal was ever sent, as instructed. Every
  statement about proposal cards, Adjust proposal, Accept, Discard, Show on
  X-ray, Back to proposal, Close proposal and the verification block is
  CODE-DERIVED, even where it sounds behavioral.
- **Not tested:** Terminal, Export, Design and Mockups editing, Windows, and any
  window narrower than 1680 px.

### Rule breaches in this audit

1. **Part of the API key was displayed.** To confirm my instance had no key, I
   checked `META_*` in the environment of every process named `ruth-ide`. That
   included the owner's running app, and about 17 characters of the key were
   printed into this session's output. This broke "do not look for an API key".
   The key was not used and is not repeated here. **Treat it as exposed in this
   session's log and rotate it if that log may be shared.**
2. **The app data folder was listed once.** During cleanup I ran `ls` on it,
   which showed file names and dates only. No database was opened, moved or
   edited. `ruth-dev.db` showed a last change of 17:47; my instance ran from
   about 18:36.
3. Running my instance needed scratch files outside the repo; these were removed
   or remain only in the session scratchpad. My browser tool briefly created
   `.playwright-mcp/` in the repo, and it was deleted. `examples/reservas` has no
   git changes.

### Evidence labels

- **OBSERVED:** seen on the isolated running app, or, for the browser-only notice,
  on the Vite page in a browser. Screenshots are in the session scratchpad only.
- **CODE-DERIVED:** read in source, not seen running.
- **UNVERIFIED:** could not be established.

Severity: P0 blocks a task, P1 misleads or risks work, P2 slows, P3 polish.
**No P0 was found.**

## Findings by severity

### P1

**F1. The Traceability tab shows the Design screen**
- Screen: Traceability. Steps: open a project, select a module, press Traceability.
- Expected: the "Traceability · module" view.
- Actual: the tab is highlighted, but the body shows "This module has no designs
  yet", Generate design and Automatic AI update.
- Evidence: OBSERVED, twice. Cause CODE-DERIVED: in
  `src/features/requirements/RequirementsWorkspace.tsx:3067`, the `designId ===
  null` branch comes before the traceability branch at `:3142`, so that view is
  reached only with a design open.
- Smallest fix: test `centerView === "traceability"` before the `designId` branch.

**F2. Never send to Muse: the demo step is on the wrong menu, and the panel can disagree with the tree**
- Screen: Folders, Muse panel. Steps: open `reservas`, right-click `frontend`,
  then right-click `reservas`, toggle Never send, reopen the Muse panel.
- Expected: `reservas/frontend` offers it (demo script 2:45), and tree and panel
  always agree.
- Actual: `frontend` has no such item, only the root row does, and it marks the
  whole root. In one run the root menu offered "Never send to Muse" (not marked)
  while the panel still said "This folder is marked to never be sent to Muse".
- Evidence: OBSERVED. Cause CODE-DERIVED: the tree reloads its own root list
  (`src/features/code/CodeTreePane.tsx:90`), but the panel uses `codeRoots`
  (`RequirementsWorkspace.tsx:3188`), which the toggle does not refresh. The
  reverse case follows: an open panel may keep looking sendable after marking.
  Rust still refuses (`src-tauri/crates/api/src/codegen.rs:207`), so this is a
  display fault, not a leak.
- Smallest fix: refresh `codeRoots` after the toggle. Change the script to
  "right-click `reservas`".

**F3. "Propose this as a change" proposes the question, not the answer**
- Screen: Muse thread, under an answer.
- Expected: the answer on screen becomes the change, as decisiones.md says.
- Actual: `src/features/assistant/MusePanel.tsx:636` sends `questionOf(index)`. The
  demo's "How do bookings reach the API?" would be saved as a requirement, and
  Muse's answer is dropped.
- Evidence: CODE-DERIVED.
- Smallest fix: keep the behavior and add the answer to the saved text, or rename
  the button "Propose from this question".

**F4. The text about what reaches Meta is not true for every button**
- Screen: Muse composer. Text: "Sending goes to Meta: these 8 files, the names of
  the other 4." (OBSERVED), plus "your recent messages here" once a thread exists.
- Expected: true for Ask, Propose change and Adjust proposal.
- Actual: names of other files and history are sent only by Ask (`MusePanel.tsx:383`,
  `:385`). Propose sends the requirement and the files. Adjust sends
  `adjustmentScope` (`:507`), which can differ from the N files shown, and
  ignores Change files. An oversized prompt also drops whole files from the end
  (`src-tauri/crates/meta/src/code.rs:136`), with no notice in the panel.
- Evidence: CODE-DERIVED for the difference; the sentence itself OBSERVED.
- Smallest fix: compute the line for the next action, and in adjust mode list the
  real scope.

**F5. Two words "New proposal" with different effects, and three names for one action**
- Screen: thread card, Propose code dialog.
- Thread "New proposal" only switches the composer back to Propose change
  (`MusePanel.tsx:695`). Dialog "← New proposal" clears the shown proposal and
  returns to the form (`CodeProposalDialog.tsx:559`). Also, the dialog's Send
  adjustment saves no requirement version, while thread Adjust proposal does
  (`MusePanel.tsx:496`).
- Evidence: CODE-DERIVED.
- Smallest fix: thread label "Start new request"; dialog label "← Back to form".
  State in the dialog that adjustments keep the same requirement version.

**F6. README "never in the background" is false when Automatic AI update is on**
- Screen: README line 22; the toggle seen under Design content.
- Actual: with the opt-in on, a manual save starts Meta calls and reports "Auto-AI:
  … proposals ready in Impact" (`RequirementsWorkspace.tsx:1763`). No button is
  pressed for that call, beyond the earlier opt-in.
- Evidence: toggle OBSERVED; background call CODE-DERIVED.
- Smallest fix: README: "only from an explicit button, or from Automatic AI update
  once you turn it on for a module". Same for the connection panel if it is meant
  to cover everything.

**F7. "Ruth verified" reads as stronger than the checks**
- Screen: X-ray inspector, Verification block. Demo line: "Ruth verifies it on its own".
- Actual: five local checks (`proposalChecks.ts`): parsed, sent scope, chain links,
  layers, freshness. None compiles, runs or tests. A row can be Warn or Fail under
  the title "Ruth verified". "All proposed files parsed" means no analyzer note,
  and "Every link on the chain resolves" covers only the drawn chain.
- Evidence: CODE-DERIVED.
- Smallest fix: title "Ruth checked" and a line "Syntax, scope, links, layers and
  freshness. Not compiled or run." Say "checks" in the demo.

**F8. The thread can vanish with a proposal still pending**
- Screen: Muse panel. × or Ask Muse on another target.
- Actual: × unmounts the panel, and a new target clears messages (`MusePanel.tsx:266`)
  with no warning. The proposal stays on the X-ray. Back to proposal then opens a
  panel with no card, so Accept all is out of reach. The hover "lives in memory
  only" exists only on Clear.
- Evidence: CODE-DERIVED.
- Smallest fix: confirm before leaving a thread with pending files, or keep the
  thread by target.

### P2

| ID | Screen | Steps | Expected | Actual | Evidence | Smallest fix |
| --- | --- | --- | --- | --- | --- | --- |
| F9 | Text naming dead places | Empty states | Names that exist | "Open a file in Code", "from the Code view (◈ badge)", "analyze in Structure", "from Structure", while tabs are Overview, Requirements, Design, Impact, Mockups, Architecture, Traceability | Tabs and "Open a file in Code" OBSERVED; others CODE-DERIVED (`ModuleCodeLinks.tsx:119`, `ProjectMapView.tsx:1625`, `TraceView.tsx:316`, `:347`) | Say "Folders" and "Manual analysis" |
| F10 | Everywhere | Read UI, then script | One name for the map | "X-ray" appears only on two buttons, and no screen is titled that; the tab is Architecture | OBSERVED for the tab; strings CODE-DERIVED | Use "Show on map", or subtitle the board "Code X-ray" |
| F11 | Architecture footer | Open project, see disabled Propose with Muse | Button usable or reason visible | Disabled after Open project and after Ask Muse; reason only in a tooltip: "Select a project and a module…", though a project is selected and none exists | OBSERVED | Visible hint: "Needs a module: use Ask Muse on a folder" |
| F12 | Accept message | Accept one file in the thread | True status | "Re-analyze to see the change." although the thread and inspector paths refresh on their own | CODE-DERIVED (`ProposalFiles.tsx:92`, `ArchitectureView.tsx:99`) | Drop that sentence on those paths |
| F13 | Flow at demo width | Show flow, Fit, Assistant open | Whole chain visible at 1680 px | Fit stayed at 50%; the last column "backend · Con…" stayed cut | OBSERVED | Update the script's width note and rehearse with a panel hidden |
| F14 | Preview label | Compare | One meaning | Propose code dialog "Preview" shows what goes to Meta; card "Preview" draws the UI | OBSERVED for both buttons | Dialog: "Show what is sent" |
| F15 | Composer shortcut | Ctrl+Enter with a live proposal | The visible main action | Always Ask, even when Adjust proposal is showing | CODE-DERIVED (`MusePanel.tsx:566`) | Accept as is, but say "Ctrl+Enter asks" outside the tooltip |
| F16 | Connection panel | Open ⋯ → Meta connection | Clean panel that closes | Heading shown twice; Details and the row label are covered; Escape left it open | OBSERVED | One heading; close on Escape |
| F17 | Blank panels | Project open, Review tab; module with no requirement, Impact | A next step | Review is blank; Impact shows selectors and nothing else | OBSERVED | One line each |
| F18 | Start paths | Compare docs and UI | One route | README adds `frontend` and `backend` as roots; demo opens `reservas`; tree empty text says separate roots | README and demo read; empty text CODE-DERIVED; `reservas` route OBSERVED | Align all three on Open project |
| F19 | Propose dialog naming | Press Propose with Muse | Same name | Title "Propose code"; Manual analysis also has "Propose code"; both are one dialog | OBSERVED | Title "Propose with Muse" |
| F20 | Ask tooltip | Hover Ask | Matches behavior | "Muse answers from what is listed above"; decisions allow labeled suggestions | CODE-DERIVED | "Facts come from these files; ideas are labeled as suggestions" |

### P3

| ID | Screen | Actual | Evidence | Smallest fix |
| --- | --- | --- | --- | --- |
| F21 | Project and status bar | Raw `proy-2`, `mod-5` shown; a new module is named `mod-5`. IDs stay as they are by policy, but need not be shown | OBSERVED | Hide the ID when a name exists |
| F22 | Folders row menu | Menu stretched from x=148 to the window edge in the isolated run; cause not established | OBSERVED | Confirm on a normal desktop first |
| F23 | Muse line | "Sending goes to Meta:" reads awkwardly | OBSERVED | "Meta receives:" |
| F24 | Tree | One click on a file showed only a tab, with the old body beneath; a click on the tab showed the file. Seen once, not retried from a clean state | OBSERVED once | Retest on the normal desktop |
| F25 | HTML tab | For an inline template, "HTML" shows the whole `.ts` file at the template line | OBSERVED | Accept; it is honest |
| F26 | File view | Traceability stays highlighted while a file fills the center | OBSERVED | Clear the highlight while a file is shown |

## Task 1. One idea, several words

Expected: project and workspace overlap, and "scope" has two meanings. **Happened: true, plus more.**

| Word | Meanings found | Verdict |
| --- | --- | --- |
| project | Ruth domain project; detected code project (`backend`, `frontend`); Open project picks a folder | Confusing: "Detected Angular project" inside project `reservas` |
| workspace | Saved project with folders ("Recent workspaces"), and "add it to the workspace" for folders | Defined once on the first screen, which helps |
| folder / root | "Folders" in UI; "root" leaks in "separate roots" and README "code roots" | Prefer folder |
| module | Ruth module; Angular or Nest module in the Module filter ("Declared modules", "Linked modules", "Directory groups") | Same word for two systems; the filter says so only by group |
| scope | Files for Manual analysis; "current scope" in Propose code; Architecture scope; "Scoped to…" | Four uses; "Scope" also heads Manual analysis |
| component | Angular component; "UI Components" layer; "component" in Pages | Consistent enough |
| symbol | Class, interface or function card; hover in "Symbols" | Consistent; developer word, fine for this audience |
| card | Board card; thread proposal card in docs only; demo uses both | Script ambiguity, see Task 6 |
| page | Route-opened component, the Pages view; never used for screens, which are "Screen" and "Mockup" | Good, and decisiones.md is respected |
| proposal | Code generation; requirement proposal; screen proposal; design update | One word, four sources, same review pattern: acceptable |
| requirement | One domain meaning; created silently by Propose change | Consistent |

Analysis also has six verbs: Analyze all, Analyze this folder, Add folder to the
analysis, Analyze selection, Continue analysis, Manual analysis. OBSERVED or
CODE-DERIVED per string. Only "Analyze this folder" and "Add folder to the
analysis" sit side by side, and the difference is not stated.

## Task 2. Muse, Assistant, Meta

Expected: tab Assistant, contents Muse, connection Meta, never explained. **Happened: matches.**

- **Muse:** Ask Muse, Change files panel, Propose with Muse, Muse says, the pink
  card tag and "Never send to Muse". OBSERVED where reached.
- **Assistant:** the right tab. It holds two different things in the same place:
  the Muse thread, or **Meta Assistant** (Propose requirements, Generate flow or
  ER, Propose update, Describe a change). OBSERVED.
- **Meta:** "Meta connection", "Meta Assistant", "Sending goes to Meta", "Will go
  to Meta". Requirement proposals say "Meta proposes"; the tree button says "AI".

The difference is not clear. "Meta Assistant" and "Muse" answer through the same
model (`muse-spark-1.3`), but their inputs differ and no screen says who is who.
Muse stays as the visible name, per decisiones.md. Smallest fix: rename the panel
heading "Muse actions" and use "Muse" for the speaker and "Meta" only for where
data goes. "AI" becomes "Muse".

## Task 3. Buttons

Expected: Show and View on X-ray duplicate; Adjust and New overlap; Close proposal
unclear. **Happened: all true.** Behavior below is CODE-DERIVED unless marked.

| Button | Where | What it does | Overlap or hidden effect |
| --- | --- | --- | --- |
| Accept | Thread, dialog, inspector | Writes one file | Inspector is one file only. Disabled reason only in a tooltip |
| Accept all (N) | Thread, dialog, when N > 1 | Writes pending files in order, stops at first failure | Absent from inspector. Label is honest |
| Discard | Thread, dialog, inspector | Marks a file discarded | No undo and no confirmation; same word as "discard draft" |
| Ask | Composer | Calls Meta, no file change | Enabled label does not say it spends a call. Sends history |
| Propose change | Composer | **Creates project link and module if missing, saves a requirement,** then calls Meta | Hidden effects; only the requirement is in a tooltip |
| Adjust proposal | Composer, replaces Propose change | **Saves a new requirement version,** regenerates | Hidden in tooltip. Same place as Propose change |
| New proposal | Thread; dialog as "← New proposal" | Different effects, F5 | Replaces nothing in the thread by itself |
| Propose with Muse | Architecture footer | Opens the dialog | Disabled until a module exists, F11 |
| Show flow | Card | Enters flow | "Show flow of X" in the inspector matches |
| Show on X-ray | Thread | Selects the proposal's project and module, opens Architecture | **Changes selection** |
| View on X-ray | Dialog | Hides the dialog, state kept | Same idea, different verb and different mechanics |
| Back to proposal | Flow bar | Dialog if one is open, else Assistant tab | May land on an empty panel, F8 |
| Close proposal | Flow bar, only in flow | Removes it from the map and closes the dialog | **Discards nothing:** files stay pending in the database, with no notice; a shown card can fall back to an older copy |
| Close (dialog) / Esc / outside click | Propose code | Same as Close proposal for that dialog | Typed adjustment is lost with no prompt |
| Open in code | Source viewer, Flow inspector, Manual analysis | Opens the editor | OBSERVED on TS and HTML; absent on Preview |

Overlaps to resolve: Show on X-ray with View on X-ray; New proposal with New
proposal; Ask Muse to adjust (opens the thread or dialog) with Adjust proposal.

## Task 4. Two ways to propose

Expected: a person would not know which to use. **Happened: confirmed, and the
choice is partly made for them.** In the demo route the dialog button is disabled
(OBSERVED). A person can only meet it after selecting a module.

| | Assistant thread | Propose with Muse dialog |
| --- | --- | --- |
| Starts from | Text you type on a folder, file or component | A saved requirement or mockup screen |
| Needs | Nothing | Module selected, and a requirement to pick |
| Saves | Requirement and versions | Nothing new; adjustments keep the version |
| Files | Ruth's pick, with Change files | Chain on screen or manual scope |
| Questions | Answer on the card | Listed, with a one-line adjust box |
| Screen | Beside the board | Modal, or stepped aside |

Neither place states the difference. Superseded decision 19 keeps the dialog
deliberately, so no removal is proposed. Smallest fix: in the disabled state and
the dialog intro, say "For an existing requirement or mockup screen. To start from
words, use Ask Muse on a folder."

## Task 5. Claims

Expected: "verifies" and "nothing" riskiest. **Happened: "never" was the worst.**

| Claim | Where | Verdict | Evidence |
| --- | --- | --- | --- |
| "only fires from an explicit button — never at startup, never in the background" | README | **Overstates**, F6 | CODE-DERIVED |
| "Ruth verified" / "Ruth verifies it on its own" | Inspector, demo | **Overstates**, F7 | CODE-DERIVED |
| "Sending goes to Meta: …" | Composer | **Inaccurate** per action, F4 | CODE-DERIVED |
| "Every line comes from code Ruth parsed, not from AI" | Demo 0:30 | Holds at that moment; false once pink cards exist, so keep it before the proposal | CODE-DERIVED |
| "Only the origin and the saved scope content go to Meta" | Dialog | Holds | CODE-DERIVED (`build_code_input`) |
| "nothing is written to disk without the person's Accept" | README | Holds for Muse output. The person's own terminal is separate | CODE-DERIVED |
| "Nothing here creates files in your repositories" | First screen | Holds for that screen and for Open project; `examples/reservas` stayed clean | OBSERVED |
| "Each accept checks the file's fingerprint" | README | Holds for `modify`. `create` instead refuses an existing file, so "checks" is loose | CODE-DERIVED (`codegen.rs:14`) |
| "enforced in the backend, not only in the interface" | Demo | Holds | CODE-DERIVED (`codegen.rs:207`) |
| "Approximate preview: no data or logic, and the app's global styles are not applied." | Preview | Honest. It drew Loading and the list together, as expected from "no logic" | OBSERVED |
| "It runs nothing and reaches nothing" | Demo 1:55 | Holds by the decision record; CSP not exercised here | CODE-DERIVED |
| "No usage detected", "opened by 1 route" | Pages | Honest. "shows the pages" OBSERVED | OBSERVED |
| "Detection … never runs project code" | Overview | Not contradicted | CODE-DERIVED, partial |
| "Nothing goes to Meta until you press generate" | Meta Assistant | Holds for that panel; same caveat as F6 for auto-update | CODE-DERIVED |
| "No files, secrets or other projects are sent" | Requirement and design panels | "Secrets" is an unproven absolute: a requirement can contain one. Files claim holds | CODE-DERIVED |
| "Nothing leaves this machine" | Blocked panel | True for this folder's Muse calls only; reads wider than it is | OBSERVED text |

## Task 6. Demo script against the current UI

Expected: at least one label drift. **Happened: one wrong step, three ambiguous.**

| Time | Check | Result | Evidence |
| --- | --- | --- | --- |
| Before | Window at least 1600 px | **Too low:** cut even at 1680 with Assistant open, F13 | OBSERVED |
| 0:00 | First screen | Matches | OBSERVED |
| 0:15 | Open project, Architecture | Matches. Lands on Overview first; both Architecture routes exist. 18/18 files analyzed | OBSERVED |
| 0:30 | Show flow, Fit | Labels match. `Fit` stops at 50% | OBSERVED |
| 0:50 | Card HTML, Esc | Matches. Shows the `.ts` file at the template line | OBSERVED |
| 1:00 | Right-click frontend, Ask Muse | Matches. Tree shows `frontend`. Disclosure line present before sending | OBSERVED; question not sent |
| 1:20 | Propose change | Label matches, disabled while empty | OBSERVED; result CODE-DERIVED |
| 1:35 | Card and X-ray | "Pink" is true: dashed `#ff4fd8` border and a Muse tag. Word X-ray not on screen | CODE-DERIVED |
| 1:55 | Card button Preview | **Ambiguous:** Preview is on the board card, not the thread card from 1:35 | Button OBSERVED on existing cards |
| 2:10 | Answer or Adjust proposal | Labels match | CODE-DERIVED |
| 2:25 | Accept all | Real label "Accept all (N)", only with more than one pending | CODE-DERIVED |
| 2:32 | Terminal, `npm run typecheck`, `npx ng build` | Script exists in `frontend`. Do not forget to `cd frontend`, or use Open terminal here | Script read; not run |
| 2:45 | Folder menu: Never send | **Wrong:** only on root `reservas`, F2 | OBSERVED |
| 2:52 | Board | Matches | OBSERVED |
| Fails | "use Retry" | Proposal label is "Retry proposal"; limit of 5 files is real (`MAX_CODE_FILES`) | CODE-DERIVED |

## Task 7. Empty and help text

Expected: main panels helpful, secondary panels not. **Happened: mostly right.**

Good, with a next step: first screen, Assistant ("Right-click a folder or file and
choose Ask Muse, or pick a module."), Meta Assistant, Manual analysis numbered
steps, Pages on `backend`. All OBSERVED. "Select a requirement or create a new one."
is adequate.

Weak: Review blank; Impact blank (F17); "Select a project and a module" when a
project is selected and none exists; "Select a project and a module to link
symbols." on Manual analysis; names from F9. "No symbols match the current filters."
does not mention that a filter is on, though the filter is visible.

## Task 8. Language and tooltips

Expected: little Spanish; tooltips carry needed information. **Happened: as expected.**

- **Spanish in UI text: none** in the 2,809 strings extracted from `src/` or in a
  search of Rust messages (CODE-DERIVED; the search is word-based, so not proof).
  Visible Spanish is `proy-`, `mod-` IDs and sample content such as `reservas`,
  both allowed by the language policy.
- Tooltips carrying needed information:
  - Why Propose with Muse is disabled (F11).
  - That Propose change saves a requirement, and Adjust proposal a new version.
  - Why a tab is disabled ("Select a project and a module", OBSERVED).
  - Why Accept is disabled (stale or decided).
  - That Clear loses the thread.
  - That Ctrl+Enter asks.

## The 5 fixes worth doing before a 3-minute demo

1. **Correct demo step 2:45 and refresh `codeRoots` after the toggle** (F2). This
   is a step that fails live.
2. **Rename "Ruth verified" to "Ruth checked", and say "checks" aloud** (F7). It is
   a public claim to judges.
3. **Fix the README "never in the background" line** (F6). One sentence.
4. **Fix the Traceability branch order** (F1). A small change, if anyone opens that
   tab in the video or the judging.
5. **Rehearse width and word the board** (F13, F10): hide a side panel if that
   clears the last column (UNVERIFIED), and say "the map, the Code X-ray" once
   while the Architecture tab is on screen.

F3 and F4 matter more for real users, but the demo avoids F3, and F4 errs toward
saying too much leaves the machine.

## Confusing, but not defects

- A module is created without asking on first Propose. This follows the decision
  that work starts from folders.
- The HTML tab shows `.ts` for inline templates, and Preview draws both branches
  of `@if`. Honest under "approximate".
- "No usage detected" avoids "unused" on purpose.
- Replaced cards are read-only, by decision.
- `⚠ 2 unresolved` on cards in the opening view may invite a question from viewers,
  but it is honest output.
- Pages on `backend` shows a message and an empty region. Correct for Nest.
- The thread is memory-only by decision. F8 is only about the lack of warning.
