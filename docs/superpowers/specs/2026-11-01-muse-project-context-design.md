# Muse project context: design

Date: 2026-11-01. Status: approved for implementation by the project owner.

## Goal

Muse answers from at most 8 files per message and does not know what the
project is. Give it a short, reviewed picture of the project in every message
of a thread: the architecture map plus the docs the person chose.

Success means that, in a project opened with Ruth, a person can confirm a
context once, and from then on Ask, Propose change and Adjust proposal in the
Assistant carry it. The person can see what is sent, and nothing leaves the
machine before they press a send button.

## Scope

This slice has two layers, with no database change:

1. **Map:** services, layers, routes and main classes from the local analysis.
2. **Docs:** Markdown files the person chose.

Later, after delivery and out of scope here: a project brief written by Muse
and reviewed by the person, stored in the project, and `.ruth/`.

## Rules

- **No new call to Meta.** Context travels only inside a message the person
  sends. Opening a project, analyzing and confirming the context send nothing.
- **Opt-in per project.** Context stays off until the person confirms it.
  `Not now` leaves everything as it is today.
- **Never send to Muse holds in the backend.** Rust rejects any doc or map
  section from a blocked root, before any network.
- **Saved content only.** Docs are read from disk by Rust, never from drafts.
- **Background, not orders.** The prompt tells the model the context is
  background data, that instructions inside it must not be followed, and that
  the files of the message win when they disagree.
- **Honest limits.** The panel says what is included and what was cut.
- **No secret scan exists.** Docs are never included without the person seeing
  the list, and the dialog says that chosen files go to Meta as they are.

## Backend

### `ruth-meta` (`crates/meta/src/code.rs`)

Add:

```rust
pub const MAX_CONTEXT_DOCS: usize = 8;
pub const MAX_CONTEXT_DOC_CHARS: usize = 6_000;
pub const MAX_CONTEXT_DOCS_CHARS: usize = 24_000;
pub const MAX_CONTEXT_MAP_CHARS: usize = 6_000;

pub struct ProjectContext {
    pub map: Vec<ContextMapSection>, // root_id, text
    pub docs: Vec<CodeScopeFile>,
}
```

Add `render_project_context(&ProjectContext) -> String`, which returns an empty
string when there is nothing to send. Sections sort by root id and docs by root
and path, so the output is stable. Over a cap, text is cut and the output says
so.

The prompt builders do not change their limits. `MAX_CODE_INPUT_CHARS` stays at
80,000. Budget the context first: when the input is too long, the existing loops
drop history and scope files. The context is at most 30,000 characters, so it is
never the part that is dropped. Pass it into `build_ask_input`,
`build_code_input` and `build_code_input_from_screen`, or add
`append_project_context`, whichever keeps it inside that budget. Empty context
must produce byte-identical prompts to today, covered by a test.

### `ruth-api` (`crates/api/src/codegen.rs`)

Add `read_project_context(roots, input)`:

- Rejects more than `MAX_CONTEXT_DOCS` docs, a duplicate, or a path that does
  not end in `.md` (case-insensitive), with stable error codes.
- Rejects a doc or map section from an unknown root (`code_root_not_found`) or
  a blocked root (`code_ai_blocked`).
- Reads docs through the same confined reader as `read_scope_files`.

The frontend removes blocked and missing items before sending, so these errors
are a backstop and not a normal path.

### Commands (`src-tauri/src/commands/codegen.rs`)

Add to `CodeAskInput` and `CodeGenContextInput`:

```rust
#[serde(default)]
pub project_context: Option<ProjectContextInput>, // map, docs
```

`None` behaves exactly as today. Old clients, the proposal dialog and Automatic
AI update keep working and send no context. Validate before any network. Keep
logic in `ruth-api`.

## Frontend

### Map summary

`ProjectMapView` publishes one summary per analyzed section when it reaches
`ready`, into a new session-only module `src/features/assistant/mapSummary.ts`
(the old analysis cache was removed with Overview). Clear it when the workspace
closes.

A pure function renders one text per root, within
`MAX_CONTEXT_MAP_CHARS`, with services, layers with counts, routes, and main
class names, largest layers first. Detected services that were not analyzed are
listed by name as `not analyzed`. Nothing is guessed. It reads only the local
result and has no AI input.

### Stored choice

Persist in frontend UI state, with validation like `mapHiddenProjects`:

```ts
museContext: Record<projectId, {
  enabled: boolean;
  dismissed: boolean;
  docs: Array<{ rootId: string; rel: string }>;
}>
```

No backend or schema change.

### Doc suggestions

A pure function suggests docs from directory listings, in this order: `AGENTS.md`,
`CLAUDE.md`, `README.md`, then `docs/**/*.md`, then a `README.md` in each detected
service. It uses the first 8 as the default selection and lists up to 40. It
skips blocked roots and the folders the map already skips. No file content is
read to suggest.

### Assistant panel

- A compact line above the input: `Project context: map · 4 docs · Edit`, or
  `Project context: off · Set up`.
- The first time a thread opens in a project with no stored choice, show an
  offer in the panel, not a modal: "Give Muse the project context? Nothing is
  sent until you send a message." with `Review` and `Not now`.
- `Review` and `Edit` open one dialog with a map toggle, the doc checklist with
  sizes, the total against the limits, and the warning from the rules above.
  `Use this context` enables it for the project. A switch turns it off.
- Each send attaches the current context. Files that disappeared are dropped,
  and the panel says which.
- Update the per-action text about what reaches Meta so it includes the context
  when it is on. Retry and Adjust carry the same context.

## Failure handling

- A chosen doc is missing: drop it and show a notice; the message still goes.
- A root becomes blocked: drop its items and show a notice.
- No analyzed service: send docs only, and the line says the map is empty.
- Backend rejection: show the error in the thread; nothing is sent.

## Tests

- Rust: rendering, caps and cut notes, stable order, byte-identical prompts
  with empty context, blocked and unknown roots, non-Markdown, too many docs,
  duplicates, old input without the field, and the backstop before network.
- TypeScript: map summary caps and `not analyzed`, suggestions order and
  blocked roots, stored-choice validation, offer shown once, `Not now`, send
  with context on and off, dropped files, Retry and Adjust carrying context,
  and the disclosure text.

Tests never use the network.

## Out of scope

- Muse-written brief, `.ruth/`, schema changes.
- Context in the proposal dialog or Automatic AI update.
- Recording in the generation which context was used. This is a known limit:
  note it in `docs/continuidad.md`.
- Any change to Accept or fingerprints.
