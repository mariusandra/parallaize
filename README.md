# Parallaize

Parallaize is a server-first proof of concept for managing many isolated desktop workspaces from one browser UI. This repository currently ships a runnable control plane and dashboard with a `mock` provider by default, plus an Incus provider boundary ready for real host integration work.

## What Works

- React + Tailwind dashboard with live grid, detail drawer, and server-sent updates
- Live grid of desktop tiles with synthetic frame updates
- Create, clone, start, stop, delete, resize, and snapshot flows
- Capture a running VM as a reusable environment template, or refresh an existing one while preserving snapshot history
- Inject commands into a selected workspace and reflect the result in the UI
- Persist state to `data/state.json`
- Server-sent event updates for dashboard refresh
- `flox` environment with `nodejs_24`, `typescript`, `pnpm_10`, and `caddy`

## What Is Still Mocked

- Real Incus VM lifecycle execution
- Real guest desktop sessions over VNC/noVNC or Guacamole
- Authentication
- PostgreSQL-backed persistence

The current end-to-end POC is honest about that boundary: the UI, API, and state model are real and runnable, while the hypervisor/session layer is simulated unless a future pass wires Incus and remote desktop transport into the provider.

## Local Run

1. Install and activate the local environment:

```bash
flox activate -d . -- pnpm install
```

2. Build the app:

```bash
flox activate -d . -- pnpm build
```

3. Start the control-plane server:

```bash
flox activate -d . -- pnpm start
```

4. Open `http://127.0.0.1:3000`.

## Caddy Front Door

The repository includes a local Caddy config at `infra/Caddyfile`.

Run it in a second terminal after the app server is up:

```bash
flox activate -d . -- caddy run --config infra/Caddyfile
```

Then open `http://127.0.0.1:8080`.

## Useful Commands

```bash
flox activate -d . -- pnpm build
flox activate -d . -- pnpm start
flox activate -d . -- pnpm test
flox activate -d . -- caddy validate --config infra/Caddyfile
```

## Configuration

- `HOST`: HTTP bind host, default `0.0.0.0`
- `PORT`: HTTP bind port, default `3000`
- `PARALLAIZE_DATA_FILE`: JSON state path, default `data/state.json`
- `PARALLAIZE_PROVIDER`: `mock` or `incus`, default `mock`
- `PARALLAIZE_INCUS_BIN`: Incus binary path, default `incus`

## Repo Layout

- `apps/control`: Node HTTP server, provider boundary, state store, and job orchestration
- `apps/web`: React + Tailwind dashboard source and static shell assets
- `packages/shared`: Shared types and formatting helpers
- `tests`: Node test runner coverage for the mock provider flow
- `.flox`: Local environment definition
