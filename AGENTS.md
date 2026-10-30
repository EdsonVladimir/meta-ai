# AGENTS.md — repository instructions

Ruth IDE: visual workspace (Tauri 2 + Rust + React) linking
requirements to designs. Start with
[docs/continuidad.md](docs/continuidad.md) to resume work.

## Documents

- [README.md](README.md): install, run, tests, limits.
- [docs/arquitectura.md](docs/arquitectura.md): modules,
  responsibilities and rule locations (authoritative).
- [docs/alcance-hackathon.md](docs/alcance-hackathon.md): goal,
  implemented and pending.
- [docs/decisiones.md](docs/decisiones.md): current and superseded
  decisions. Live-design detail in
  [docs/decision-diseno-vivo.md](docs/decision-diseno-vivo.md).
- [docs/continuidad.md](docs/continuidad.md): status, commands,
  schema, known errors and next milestone.

## Language policy

All project-facing content is in English: identifiers, comments,
errors, logs, UI labels, docs, tests, fixtures and generated
deliverables. When adding Spanish user input, explain that generated
deliverables come out in English.

Preserved for compatibility (never translate): stable IDs, database
keys, serialized contracts (`snake_case` error kinds, DTO shapes),
migration history, persisted user content and historical records.

## Working rules

- `ruth-core` owns the domain: no Tauri, Serde, clock, network or
  SQLite. Never duplicate its rules in commands or TypeScript.
- Atomic mutations validate → persist → publish; never success
  before saving. Identifiers and dates are generated outside the
  domain.
- Ctrl+S saves without mandatory approval; review is optional;
  AI proposes in separate generations and never overwrites manual work.
- No network in tests (fake generator + fixtures). No keys,
  authorization headers or full responses in logs, docs or tests:
  safe metadata only.
- Transactional, idempotent SQLite migrations; every schema opens
  earlier databases intact. `*.db` stays out of the repo.
- Preserve pending changes and staging; no commit or push unless
  explicitly asked; never rewrite history.
- Never read or reuse the prior prototype (Atelier): all code is
  new to the hackathon.
- Minimum verification after touching code: `npm test`,
  `npx tsc --noEmit` and, from `src-tauri/`,
  `cargo test --workspace`. Never claim visual or interactive
  verification without having done it.
