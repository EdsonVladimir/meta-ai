# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ruth IDE is a Tauri 2 desktop app (Rust backend + React 19/TypeScript
frontend). It turns requirements into linked design artifacts (flows, ER
diagrams, mockups) and links them to code. When a requirement changes, it
finds the affected designs and proposes updates for a person to review.

**Read [AGENTS.md](AGENTS.md) first.** It holds the binding working rules
and the English-only language policy. To resume work, start with
[docs/continuidad.md](docs/continuidad.md): it covers current status, schema
version, known errors, pending tasks and the uncommitted-changes ledger.
[docs/arquitectura.md](docs/arquitectura.md) is the authoritative design
document. Its numbered sections (§17 terminal, §20 code workspace, §22
unified perspectives…) are cited from the code and the docs.

## Commands

```sh
npm install
npm run dev              # Vite only on 127.0.0.1:1420; native commands unavailable
npm run tauri dev        # full desktop app (Vite + Rust)
npm test                 # vitest run (jsdom)
npx vitest run src/features/requirements/names.test.ts   # single test file
npx vitest run -t "name of test"                         # single test by name
npx tsc --noEmit
npm run build            # tsc + vite build

cd src-tauri             # the Cargo workspace lives here, not at repo root
cargo test --workspace
cargo test -p ruth-api --test design          # one integration test file
cargo test -p ruth-core some_test_name        # filter by name in one crate
cargo clippy --workspace --all-targets
cargo fmt --check
```

Minimum verification after touching code: `npm test`, `npx tsc --noEmit`,
and `cargo test --workspace` from `src-tauri/`.

Real Meta Model API calls happen only from buttons in the desktop app.
They need `META_API_KEY`, and optionally `META_MODEL`, in the native process
environment. Export it with `read -rsp` as the README shows; never pass it as
an argument or write it to a file. Tests never use the network.

Port 1420 is strict (`strictPort: true`). If it is already in use, an orphan
`vite` from an earlier `tauri dev` is usually still running.

## Architecture

The app is a modular monolith. `ruth-core` is an independent domain core,
and the other crates are adapters around it. Dependencies point inward only.

Rust workspace crates (`src-tauri/crates/`):

- **`core` (`ruth-core`)**: the pure domain. It owns versions, dependencies,
  approvals, baselines and invariants, with no Tauri, Serde, clock, env, file
  system, network or SQLite. Domain rules live only here; never re-implement
  them in commands or TypeScript.
- **`api` (`ruth-api`)**: the boundary layer, testable without a Tauri
  runtime. It holds serializable DTOs, stable `snake_case` error kinds, and
  ID/date generation (outside the domain). Every mutation goes through
  `transact` (validate → persist → publish) and calls core use cases. Most
  integration tests live in `crates/api/tests/`.
- **`store` (`ruth-store`)**: the SQLite adapter. It runs as an actor on a
  dedicated thread and reads and writes verbatim, with no rule validation.
  `schema.rs` holds `SCHEMA_VERSION` and the migration chain. Migrations must
  be transactional and idempotent, and every new schema must open older
  databases intact.
- **`meta` (`ruth-meta`)**: the Meta Model API adapter (`protocol.rs`). Rust
  validates every generation authoritatively. Tests use a fake generator and
  the fixtures in `tests/fixtures/`.
- **`code` (`ruth-code`)**: workspace roots, path confinement and file
  read/write. `structure.rs` is the Rust symbol extractor (`syn`), and its
  `fnv1a_hex` hash is mirrored in the frontend for hash-verified "open in
  code".
- **`term` (`ruth-term`)**: real PTY sessions (`portable-pty`) with reader
  threads and a scrubbed environment.

`src-tauri/src/`: thin Tauri command wrappers, one file per feature in
`commands/`, named `core_*`, `code_*` and `term_*`. Shared state is in
`state.rs` and the command registry in `lib.rs`. Keep logic out of the
commands and put it in `ruth-api`.

Frontend (`src/`):

- `src/features/<feature>/`: one folder per perspective or feature
  (requirements, design, impact, mockup, proposals, code, trace,
  assistant, terminal, explorer, workspace…).
- Each feature calls the backend through its own `client.ts`, a wrapper
  over Tauri `invoke`. Logic is kept in pure modules (for example
  `traceModel.ts`, `coordination.ts`, `archLayers.ts`, `boardLayout.ts`),
  and those modules get their own `*.test.ts` files.
- Backends are injected so tests run without Tauri. Monaco is replaced by
  `monacoFake` in tests.
- Rust snapshots are authoritative. The frontend only keeps local drafts,
  which live in memory and are lost on close.
- Zustand holds only shared selection, the active perspective and panel
  visibility.
- The TypeScript structure analysis (`code/structure/tsAnalyze`) runs in a
  worker and analyzes saved content only, never drafts. See
  [docs/architecture-map.md](docs/architecture-map.md) for the
  layer taxonomy and edge rules of the architecture map.

## Product invariants to preserve

- Ctrl+S saves without requiring approval; review is optional.
- AI output arrives as separate generations or proposals and never
  overwrites manual work.
- AI never invents code correspondences: anything it cannot verify is shown
  as unresolved, never connected.
- The export package includes only persisted versions.
- User data is stored in `ruth.db` in the app data directory
  (`~/.local/share/ide.ruth.app/` on Linux). `*.db` files are never
  committed.

Some older comments are still in Spanish (for example `vite.config.ts`).
docs/continuidad.md tracks the English migration. New content goes in
English, and persisted IDs, DB keys and serialized contracts stay as they
are.
