# Ruth IDE — See your code as a map, change it with Muse

Ruth is a desktop IDE that reads a project locally and draws it as an
architecture map: pages, stores, services, controllers, and the modules
and routes that wire them. Meta's Muse proposes changes to that code,
and every change arrives as a review you accept or discard. Nothing is
written to disk without your Accept.

## The problem

Requirements change every day, and nobody knows which code they touch.
AI writes code fast, but it gets harder to know what it did. Ruth keeps
the understanding with the person: the map comes from parsed code, not
from AI, and Muse's work shows up on that map before it reaches the
disk.

## What it does

- **Architecture map.** Classes, Files and Pages views of an Angular,
  NestJS, TypeScript or Rust project, grouped by layer. Every edge
  carries its evidence; what cannot be verified is shown as
  unresolved, never connected.
- **Show flow.** Follows a feature from a template through the store
  and the service to the HTTP call and the backend controller.
- **Muse in the Assistant.** Ask about the code, or Propose change.
  Before anything is sent, Ruth says exactly what leaves the machine.
  For a change, Muse first picks the files it needs from their paths,
  and you see that list before any code is sent.
- **Proposals as reviews.** The new code appears on the map in pink
  (the Code X-ray), with Ruth's own checks, a diff per file and a
  preview of new Angular templates. Answer Muse's questions or adjust
  the proposal; each change is a new version of the same requirement.
- **Your decision.** Accept file by file or all at once. Each accept
  checks the file's fingerprint, so a file changed on disk since is
  never overwritten.
- **Private code stays private.** Mark a folder Never send to Muse;
  this is enforced in the backend, not only in the interface.
- **Integrated terminal** to build and test without leaving Ruth.

## Muse: real calls, only from buttons

Every call goes to real Meta models (Responses API, default
`muse-spark-1.3`) and fires only from an explicit button. Never at
startup, and never from tests. The key lives in `META_API_KEY` in the
native process environment; it never reaches the frontend, logs or
files.

## Demo (examples/bookings)

The sample is a small room-booking app: a NestJS + SQLite API and an
Angular 18 standalone UI with signals. Its own
[README](examples/bookings/README.md) shows how to run both.

1. Export `META_API_KEY` (below), then start Ruth.
2. Add the folder `examples/bookings` as a project. It opens on
   Architecture; use Show flow on `BookingsPageComponent`.
3. Right-click `frontend` → Ask Muse:
   *"How do bookings reach the API? Walk me through it from the page
   to the HTTP call."*
4. Propose change:
   *"Add user registration: a form with first name, last name, birth
   date, email and gender (male, female, other), plus a list to edit
   and delete users. The email cannot be changed after creation.
   Follow the same layers as bookings."*
5. Review the proposal on the X-ray, answer its questions or adjust
   it, then Accept. Build with `npx ng build` in Ruth's terminal and
   see the new feature on the map.

A window at least 1600 px wide shows the whole chain next to the
Assistant.

## Install

- Node.js 18+ and npm; stable Rust and Cargo.
- On Linux, the Tauri 2 system dependencies (see the
  [official prerequisites](https://v2.tauri.app/start/prerequisites/)).
- A Meta Model API key for the live calls.

```sh
npm install
```

Packaged app (Linux): `npm run tauri build` produces a `.deb` and an
AppImage under `src-tauri/target/release/bundle/`. Install the `.deb`
with `sudo dpkg -i`, or `chmod +x` the AppImage and run it.

## Run

Read the key into the environment without leaving it in the shell
history, then start Ruth from that same terminal:

```sh
read -rsp 'META_API_KEY: ' META_API_KEY && export META_API_KEY && echo
npm run tauri dev
```

Opened from the system menu, the app has no key and Muse will not
work. `npm run dev` serves only the web UI, without native commands.

Data lives in `~/.local/share/ide.ruth.app/` (`ruth.db`; development
builds use `ruth-dev.db` and start empty).

## Tests

```sh
npm test                  # frontend (vitest)
npx tsc --noEmit          # frontend types
npm run build             # production web build
cd src-tauri && cargo test --workspace   # Rust, no network
```

Automated tests never call the Meta API. Manual cases are in
[docs/guia-detallada.md](docs/guia-detallada.md).

## Architecture

Tauri 2 desktop app: a React 19 + TypeScript UI over a Rust workspace.
`ruth-core` owns the domain (no Tauri, Serde, clock or network);
`ruth-api` validates, persists and publishes every change;
`ruth-store` keeps versioned SQLite with transactional migrations;
`ruth-meta` owns the Meta contract and validates every response;
`ruth-code` reads files within the project with size caps and
fingerprints; `ruth-term` runs the integrated terminals. The
TypeScript analysis runs in a web worker. See
[docs/arquitectura.md](docs/arquitectura.md) and
[docs/architecture-map.md](docs/architecture-map.md).

## Limits

- Analysis is TypeScript-first, without a language server; maps
  re-run when you return to a view.
- A proposal writes at most 12 files; Muse reads up to 40 files per
  proposal. Larger changes go in steps.
- Ruth checks syntax, scope and links, but does not compile a
  proposal before Accept: build it after accepting.
- Unsaved drafts live only in memory. The terminal allows three
  sessions and inherits your environment minus `META_*`.
- Built and verified on Linux. Windows compiles but is unverified.

## Provenance

Built during the event: work started in this repository on
2026-10-26, once the organizers confirmed it could begin. An earlier
exploration existed before it (Atelier / Ruth IDE); its code was not
read or reused here.
