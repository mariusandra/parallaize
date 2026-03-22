# AGENTS.md

## General Repo Use

- This repository is `parallaize`, a server-first proof of concept for managing
  many isolated desktop workspaces from one browser UI.
- Prefer running commands through the local Flox environment:
  `flox activate -d . -- <command>`.
- Common setup and validation commands:
  - Install deps: `flox activate -d . -- pnpm install`
  - Build: `flox activate -d . -- pnpm build`
  - Start the real server: `flox activate -d . -- pnpm start`
  - Start the mock fallback: `flox activate -d . -- pnpm start:mock`
  - Typecheck: `flox activate -d . -- pnpm typecheck`
  - Test: `flox activate -d . -- pnpm test`
  - Live smoke path: `flox activate -d . -- pnpm smoke:incus`
- The main start script runs the control plane in Incus mode by default.
- Persistence can use JSON or PostgreSQL. For PostgreSQL, bring up
  `infra/docker-compose.postgres.yml` and set
  `PARALLAIZE_PERSISTENCE=postgres` plus `PARALLAIZE_DATABASE_URL`.
- The optional front door is Caddy using `infra/Caddyfile`.
- Keep `TODO.md` current when scope changes or a major task lands.
- Prefer finishing one verified vertical slice over speculative feature spread.
- After backend or infra changes, run `pnpm build`, `pnpm test`, and boot the
  real server with `pnpm start`.
- When touching Incus, Caddy, guest networking, or browser-session behavior,
  verify on the live host when feasible.
