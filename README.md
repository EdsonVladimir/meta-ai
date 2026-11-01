# Ruth IDE — Design and code as perspectives of one project

Visual workspace turning requirements into linked design
artifacts and code. When a rule changes, it identifies affected
dependencies and proposes adjustments for a person to review.

## The problem

Requirements, designs and code drift apart: a rule changes and
nobody knows which diagrams and files it affects. Ruth keeps
one project where requirements link to designs, mockups and
code symbols with evidence, and every AI output arrives as a
reviewable proposal — nothing is applied silently, and nothing
is written to disk without the person's Accept.

## Muse: real calls, only from buttons

Muse is the Meta assistant: Test connection, Ask, Propose
requirements, Generate flow/ER, Propose screens and Propose
change/code. Every call goes to real Meta models (Responses
API, default `muse-spark-1.3`) and only fires from an explicit
button, or from Automatic AI update once you turn it on for a
module. Never at startup, and never from tests. The key lives in `META_API_KEY` in the native process
environment; it never crosses to the frontend, logs or files.

## Demo path (examples/reservas)

The sample is a small room-booking app (NestJS + SQLite API,
Angular 18 standalone UI). Its own
[Run section](examples/reservas/README.md) starts both.

1. `npm run tauri dev`, export `META_API_KEY` first (below).
2. Open project on `examples/reservas`. It lands on Architecture:
   the map draws the UI → store → service chains with evidence,
   and Pages orders the app from its routes.
3. Right-click a folder → Ask Muse. Ask about the code, then
   use Propose change for the missing user registration.
4. Review the proposal in the thread and on the X-ray, answer
   its questions or adjust it, then Accept file by file or with
   Accept all. Each accept checks the file's fingerprint.

## Install

- Node.js 18+ and npm; stable Rust and Cargo.
- On Linux, Tauri 2 system dependencies (see the
  [official prerequisites](https://v2.tauri.app/start/prerequisites/)).
- A Meta Model API key for the live calls.

```sh
npm install
```

Packaged app (Debian): `npm run tauri build` produces a `.deb`
and an AppImage under `src-tauri/target/release/bundle/`.
Install with `sudo dpkg -i` on the `.deb`, or `chmod +x` and
run the AppImage directly.

## Run from source

Desktop app (compiles Rust, opens the native window):

```sh
npm run tauri dev
```

Web UI only (no native commands):

```sh
npm run dev
```

The key is read from the environment, without touching history:

```sh
read -rsp 'META_API_KEY: ' META_API_KEY && export META_API_KEY && echo
```

Opened from the system menu the app has no key and Muse will
not work. Data lives in `~/.local/share/ide.ruth.app/`
(`ruth.db`; debug builds use `ruth-dev.db` and start empty).

## Tests

```sh
npm test                  # frontend (vitest)
npx tsc --noEmit          # frontend types
npm run build             # production web build
cd src-tauri && cargo test --workspace   # Rust, no real network
```

Automated tests never consume the Meta API; only the buttons
above make real calls. Details and manual cases:
[docs/guia-detallada.md](docs/guia-detallada.md).

## Architecture

Tauri 2 desktop app: React 19 + TypeScript UI, Rust
workspace behind serializable commands. `ruth-core` owns the
domain (no Tauri, Serde, clock or network); `ruth-api`
transacts validate → persist → publish; `ruth-store` keeps
versioned SQLite with transactional migrations;
`ruth-meta` owns the Meta contract; `ruth-code` analyzes
TypeScript and Rust with read caps and fingerprints;
`ruth-term` runs the integrated terminals. Zustand holds UI
selection only. See
[docs/arquitectura.md](docs/arquitectura.md) (authoritative),
[docs/alcance-hackathon.md](docs/alcance-hackathon.md) (scope)
and [docs/continuidad.md](docs/continuidad.md) (status).

## Limits

Analysis is TypeScript-first with caps and no LSP or global
search; maps re-run when returning to the perspective.
Unsaved drafts live only in memory. The terminal caps at
three sessions and inherits your environment minus `META_*`.
Windows compiles but is unverified here.

## Provenance

Built during the event: work started in this repository on
2026-10-26, once the organizers confirmed it could begin. An
earlier exploration existed before it (Atelier / Ruth IDE); its
code was not read or reused here.
