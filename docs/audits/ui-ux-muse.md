# Ruth IDE usability audit — first-time developer (Muse)

- Auditor: Muse (Muse Code), as a developer who has never seen Ruth IDE.
- Scope: `examples/reservas` only. No code changed, nothing committed.
- No Meta action taken, no API key used or looked for.
- `ruth.db`, `ruth-dev.db` and the app data folder were not read, moved or edited.

## How this was produced

**The app could not be run in this environment.** There is no usable
display (`grim` and `import` both failed; no Xvfb/xdotool/wtype), so no
screen was ever observed and no interaction was performed. Every finding
below is **CODE-DERIVED** (read in source, with file and line) or
**UNVERIFIED** (needs a running app to confirm). Nothing is marked
OBSERVED. No results or screenshots are invented.

Sources cited are files on branch `code-xray` as found in the working
tree. Line numbers refer to that state.

## Task log (expectation vs. actual)

### 1. First screen: what to do first; Open project vs. New project

- Expected: one obvious first action, and plain words for what each
  button does.
- Actual (CODE-DERIVED): the welcome screen meets this. Heading "Start
  with a project", a one-paragraph explainer ("Nothing here creates
  files in your repositories"), then two buttons each with a visible
  hint underneath: "Open project — Use a folder you already have. It
  reuses its project if known." and "New project — Start with
  requirements and designs. Add code later."
  (`src/features/workspace/WelcomeScreen.tsx:36-70`). Below, "Recent
  workspaces — A workspace is a saved project with its folders."
  Verdict: pass, with one terminology nit (F7).

### 2. Open the project once; do its folders appear with no second pick?

- Expected: pick `examples/reservas` once; `frontend` and `backend`
  appear without further picks.
- Actual (CODE-DERIVED, partly UNVERIFIED): opening registers exactly
  one code root for the picked folder (`src/features/workspace/
  openProject.ts:46-88`); `frontend`/`backend` are children of that
  root, so no second folder pick is needed by design. Whether the
  Folders tree shows the new root expanded, and which view lands in
  front (code selects the "overview" perspective,
  `src/features/requirements/RequirementsWorkspace.tsx:947-952`),
  is UNVERIFIED without a running app. Verdict: design answers the
  question, appearance unconfirmed (U1).

### 3. Architecture: what do Symbols, Files and Pages each answer?

- Expected: explain each board in my own words without hovering.
- Actual (CODE-DERIVED): not possible. The three boards are bare toggle
  buttons ("Symbols", "Files", "Pages"); what each answers exists only
  in hover tooltips: "One card per class, interface, or free function.",
  "One card per file, with its symbols inside.", and the Pages
  equivalent (`src/features/code/archmap/ArchitectureToolbar.tsx:
  342-363`). Verdict: fail (F1).

### 4. Pages: name the pages, uses, shared, "No usage detected"

- Expected: self-explanatory columns.
- Actual (CODE-DERIVED): pass. Every column renders a title plus a
  visible hint: App ("Where the application starts."), Pages
  ("Components a route opens."), Level N ("Used directly by a page." /
  "Used inside level N."), Shared ("Used by 2 or more components."), and
  "No usage detected" ("No route or parent found. Dynamic creation
  cannot be ruled out.") (`src/features/code/archmap/
  compositionModel.ts:168-201`). A notes row above the board says what
  the hierarchy could not settle ("No routes were found, so no page can
  be told apart.", `ProjectMapView.tsx:2407-2410`). Card fact chips
  ("opened by 2 routes", "also in 3 components") are terse (F8).

### 5. Select a card: why do others dim, and how to undo?

- Expected: the dimming is explained and undo is visible.
- Actual (CODE-DERIVED): neither. Clicking a card toggles selection;
  cards outside the selected branch render dimmed (opacity 0.28), and
  edges into Shared appear only while selected
  (`src/features/code/archmap/PagesBoard.tsx:216-217`,
  `src/styles.css:6606-6607`). No on-screen text explains the dimming,
  there is no Clear-selection control, and the board has no Esc
  handler — undo means clicking the selected card again, which is
  undiscoverable. Verdict: fail (F2).

### 6. Open TS, HTML, CSS and Preview from a card; what "approximate" promises

- Expected: one button per file; the Preview states its limits plainly.
- Actual (CODE-DERIVED): pass. Each card shows one quiet button per
  file behind it (language badge, "HTML", style extension, "Preview"),
  with the path in the tooltip and missing files disabled
  (`SourceButtons.tsx:12-28`, `sourceTabs.ts:36-72`). The viewer names
  the active file plus "· read only" (or "· proposed by Muse, not on
  disk yet"), and the Preview tab states: "Approximate preview: no data
  or logic, and the app's global styles are not applied."
  (`SourceViewer.tsx:246-250`). "Approximate" therefore promises
  static structure only; the iframe is fully sandboxed and runs
  nothing (`SourceViewer.tsx:259-264`).

### 7. Show flow and return; is it clear where you are?

- Expected: entering and leaving flow mode both state where I am.
- Actual (CODE-DERIVED): entering is clear (a visible "Show flow"
  button on cards, `PagesBoard.tsx:112-122`). Location while inside
  is stated only by the exit button itself, labeled "Flow: \<name\> ×"
  (aria-label "Leave flow", `ProjectMapView.tsx:1667-1679`): it reads
  like a closable tab and never names the destination. Verdict:
  partial (F5).

### 8. Muse panel: before sending, what would leave the machine? (not sent)

- Expected: a plain, no-hover statement of the outgoing data.
- Actual (CODE-DERIVED): pass, exemplary. The composer always shows
  "Muse reads N of M files here." with a "Change files" toggle that
  lists every file with checkboxes ("Files sent to Muse"), plus the
  line "Sending goes to Meta: these N files, the names of the other M,
  your recent messages here." (`src/features/assistant/
  MusePanel.tsx:301-307,785-817`). The target folder/file is shown in
  the panel header (`MusePanel.tsx:589-593`). An AI-blocked folder
  replaces the composer with "This folder is marked to never be sent
  to Muse. Nothing leaves this machine." (`MusePanel.tsx:615-618`).
  Nothing was sent during this audit.

### 9. Split between Projects and Folders; resize to 1100×750 and 880×600

- Expected: the split is visibly movable; both sizes stay usable.
- Actual (CODE-DERIVED + UNVERIFIED): the split handle is keyboard
  accessible (Tab-focusable separator, arrows/Home,
  `src/features/explorer/NavSplitHandle.tsx:26-64`, focus style at
  `styles.css:406`) but has no resting affordance — a 6 px strip with
  no background until hovered (`styles.css:395-403`). Same for the
  navigator-width handle (`NavResizeHandle.tsx`,
  `styles.css:1946-1960`). A mouse user cannot discover either without
  hovering (F3). Window default is exactly 1100×750 with minimum
  880×600 (`src-tauri/tauri.conf.json:16-19`); how the boards,
  navigator (min 200 px) and inspector behave at those sizes is
  UNVERIFIED (U2).

### 10. Keyboard only: Tab, Enter, Esc; visible focus, and return?

- Expected: focus always visible; dialogs return focus on close.
- Actual (CODE-DERIVED, partly UNVERIFIED): focus visibility is
  designed in (`:focus-visible` styles for buttons, tree rows,
  tabs, splitters across `styles.css`); the explorer tree has full
  arrow/Home/End navigation with roving focus
  (`ExplorerTree.tsx:169-212`); the source viewer traps Tab and
  closes on Esc (`SourceViewer.tsx:175-194`). But closing the source
  viewer just clears state (`ProjectMapView.tsx:1861`) with no focus
  restoration — focus falls to the body (F4). The unsaved-changes
  dialogs have no Esc handling at all (F6). End-to-end Tab order is
  UNVERIFIED (U3).

### 11. Close with an unsaved draft; is the choice clear?

- Expected: named documents, explicit save/discard/cancel.
- Actual (CODE-DERIVED): pass. "Unsaved changes — These documents
  would lose their draft on close:" with the document list and three
  buttons: "Save all and close" (primary), "Close without saving"
  (danger), "Cancel" (auto-focused, also on backdrop click)
  (`src/app/App.tsx:362-423`). Safe default, explicit destructive
  action.

## Findings

### F1 — P2 — Board meanings exist only on hover

- Screen: Architecture toolbar (Symbols / Files / Pages toggle).
- Steps: open Architecture for `examples/reservas`; read the three
  board buttons without hovering.
- Expected: a first-time developer can say what each board answers.
- Actual: the buttons are bare labels; the explanations ("One card per
  class, interface, or free function.", "One card per file, with its
  symbols inside.", …) are `title` tooltips only
  (`ArchitectureToolbar.tsx:342-363`, CODE-DERIVED).
- Smallest fix: render the active board's existing tooltip string as a
  visible one-line hint under the toggle.

### F2 — P2 — Card dimming unexplained; no visible undo

- Screen: Pages board (card selection).
- Steps: click a page card; watch the other cards dim.
- Expected: some text says the board now shows that card's branch, with
  a way back.
- Actual: dimming (opacity 0.28, `styles.css:6606-6607`) with no
  explanation; undo is clicking the same card again (toggle at
  `PagesBoard.tsx:217`) or nothing — no Clear control, no Esc
  (CODE-DERIVED).
- Smallest fix: while a selection is active, show a small chip above
  the board: "Showing the branch of \<name\> · Clear".

### F3 — P2 — Split handles invisible until hovered

- Screen: navigator (Projects/Folders split; navigator edge).
- Steps: look at the boundary between Projects and Folders; try to tell
  it moves.
- Expected: a visible grip or line.
- Actual: the split is a 6 px strip with no resting background (hover
  only, `styles.css:395-403`); the width handle likewise
  (`styles.css:1946-1960`). Both are keyboard accessible
  (`NavSplitHandle.tsx`, `NavResizeHandle.tsx`), so this is purely a
  discovery problem (CODE-DERIVED).
- Smallest fix: a persistent subtle affordance in the strip (1 px line
  or grip dots) using existing theme colors.

### F4 — P2 — Source viewer close drops keyboard focus

- Screen: source viewer dialog (TS/HTML/CSS/Preview).
- Steps: Tab to a card's file button, Enter, then Esc or Close.
- Expected: focus returns to the button that opened the viewer.
- Actual: close only clears state (`ProjectMapView.tsx:1861`); nothing
  records or restores the opener, so focus is lost to the body
  (CODE-DERIVED). (The tree's context menu already does this right:
  Esc refocuses its trigger, `ExplorerTree.tsx:587-590`.)
- Smallest fix: in `handleViewSource`, record `document.activeElement`;
  focus it again in the viewer's `onClose`.

### F5 — P3 — Flow exit reads as a tab, not a way back

- Screen: flow mode.
- Steps: press "Show flow" on a card, then look for the way back.
- Expected: a control that says it returns to the board.
- Actual: the only exit is labeled "Flow: \<name\> ×" ("Leave flow" is
  aria-label only, `ProjectMapView.tsx:1667-1679`); the destination is
  never named (CODE-DERIVED).
- Smallest fix: keep "Flow: \<name\>" as heading text and label the
  button "← Back to board".

### F6 — P3 — Unsaved-changes dialogs ignore Esc

- Screen: close gate / export gate.
- Steps: open either "Unsaved changes" dialog; press Esc.
- Expected: Esc cancels, like the source viewer and tree menu.
- Actual: neither dialog handles `onKeyDown` (`App.tsx:291-423`); the
  only Esc handlers in these flows are the source viewer's and the
  tree menu's (CODE-DERIVED).
- Smallest fix: Esc → `onCancel` on both dialogs.

### F7 — P3 — "Project" and "workspace" name the same saved unit

- Screen: welcome.
- Steps: read the action buttons, then the recents section.
- Expected: one noun for the thing I open and resume.
- Actual: buttons say "Open project" / "New project" while recents say
  "Recent workspaces — A workspace is a saved project with its
  folders." (`WelcomeScreen.tsx:55-73`, CODE-DERIVED).
- Smallest fix: pick one noun in headings (e.g. "Recent projects").

### F8 — P3 — Page-card fact chips are terse with no elaboration

- Screen: Pages board cards.
- Steps: read a card's chips ("also in 3 components", "shows the
  pages", "opened by 2 routes").
- Expected: plain meaning without guessing.
- Actual: chips come from `cardFacts` (`PagesBoard.tsx:57-72`) and the
  card tooltip covers only name and path (`PagesBoard.tsx:107`); "also
  in N components" (embedded as a child elsewhere) and "shows the
  pages" (hosts the router outlet) must be inferred (CODE-DERIVED).
- Smallest fix: add `title` paraphrases on the fact chips (e.g. "Also
  embedded inside 3 components").

## Unverified items (need a running app)

- U1: after opening `examples/reservas`, whether the Folders tree shows
  the new root expanded and what the overview perspective presents.
- U2: layout at 1100×750 and at the 880×600 minimum (navigator,
  boards, inspector, dialogs).
- U3: end-to-end Tab order and focus visibility, including the Monaco
  editor inside the source viewer and the Muse composer shortcuts.
- U4: welcome-screen busy and error states (folder-pick failure,
  duplicate project name warnings).

## The 5 fixes worth doing before a 3-minute demo

1. **F1 — visible board hint.** The demo's first Architecture moment
   lands only if the audience can tell Symbols/Files/Pages apart
   without hovering; one line of existing text.
2. **F2 — "Showing the branch of X · Clear" chip.** Card selection is
   the core interaction; today the dimmed board looks broken and the
   way back is invisible.
3. **F5 — "← Back to board".** Flow mode is a likely demo beat; the
   return must read as a return, not a tab close.
4. **F3 — persistent split grip.** A live resize of Projects/Folders
   fails if the handle cannot be found on screen.
5. **F6 — Esc cancels the unsaved-changes dialogs.** Cheap consistency
   fix; a stray dialog during the demo must dismiss the way every
   other dialog does.

Next after those: F4 (focus return), F8 (chip paraphrases), F7 (one
noun) — all small, none demo-blocking.

## Confusing but not defects

- "No usage detected" sounds like an accusation until you read its
  hint ("No route or parent found. Dynamic creation cannot be ruled
  out.") — the hint resolves it; no change needed.
- The Muse composer's "Change files" button toggles to "Hide files",
  and the "Also in this folder, not included" suffix is appended to
  sent questions but stripped from history — invisible but correct
  behavior, and the outgoing-data line discloses what matters.
- Ask/Propose/Adjust consequences ("No file changes", "Saved as a
  requirement", "Ctrl+Enter sends") live in button tooltips
  (`MusePanel.tsx:830,839,848`). Tooltips for consequences and
  shortcuts are standard practice, unlike F1's board meanings which
  are the screen's core content — noted, not filed.
- The welcome comment promises "three explicit entries" but the screen
  shows two action buttons plus recents (`WelcomeScreen.tsx:1-3`);
  recents arguably is the third. Stale-comment smell only.
- "Flow: X" doubling as the location indicator is economical once F5
  names the destination; no separate heading needed.

## Worth keeping

The disclosure lines are the best first-run writing in the app: the
Muse outgoing-data sentence, the AI-blocked message, the
approximate-preview promise, the read-only/proposed file captions, the
per-column Pages hints, and the close gate's named-document list with
an explicit danger button. Any fix above should reuse these strings' tone, not replace them.

