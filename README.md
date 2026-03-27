# Parallaize

Parallaize is a server-first control plane for managing many isolated desktop workspaces from one browser UI.

It is built around a simple loop: launch a VM, configure it the way you want, then save it as a reusable template or clone it into a larger fleet. The control plane runs on one host, streams desktop sessions through the browser with noVNC, and keeps its own state in JSON or PostgreSQL.

![Parallaize screencast](docs/screencast.gif)

## What It Does

- Launch and manage Incus-backed desktop VMs from a web dashboard
- Open a live workspace in the browser through the built-in VNC bridge
- Create, clone, start, stop, delete, resize, snapshot, and restore workspaces
- Capture a configured VM as a reusable template for future launches
- Run guest commands from the control plane and surface output in the UI
- Expose selected guest HTTP or WebSocket services through the app or Caddy
- Persist control-plane state to JSON or PostgreSQL
- Protect the dashboard with a single-admin cookie session

## Repository Layout

- `apps/control`: Node.js control plane, Incus integration, and persistence CLI
- `apps/web`: React dashboard and noVNC browser client
- `packages/shared`: shared API and domain types
- `infra/`: example env, Caddy config, PostgreSQL compose file, and systemd assets
- `docs/`: deeper setup and packaging notes

## Quick Start

Parallaize is developed and tested through the repo-local Flox environment.

```bash
flox activate -d . -- pnpm install
flox activate -d . -- pnpm build
flox activate -d . -- pnpm start
```

Open `http://127.0.0.1:3000`.

By default, `pnpm start` runs the real Incus-backed provider and writes state to `data/incus-state.json`.

If you want the demo path instead of real VMs:

```bash
flox activate -d . -- pnpm start:mock
```

## Host Requirements

For real Incus mode, use a Linux host with working Incus VM support. Flox provides the repo-local toolchain, including `node`, `pnpm`, `incus`, `incusd`, and `caddy`, but the host still needs the normal VM helpers installed system-wide.

Ubuntu example:

```bash
sudo apt-get install -y attr ovmf qemu-system-x86 qemu-utils genisoimage
```

For the full live-host setup flow, including Incus bootstrap and networking notes, see [docs/live-incus-setup.md](docs/live-incus-setup.md).

## Basic Configuration

The most common runtime settings are:

```bash
export PARALLAIZE_ADMIN_USERNAME=admin
export PARALLAIZE_ADMIN_PASSWORD=change-me
export PARALLAIZE_GUEST_VNC_PORT=5900
```

Other useful env vars:

- `HOST` and `PORT`: HTTP bind address for the control plane
- `PARALLAIZE_PERSISTENCE`: `json` or `postgres`
- `PARALLAIZE_DATABASE_URL`: PostgreSQL connection string
- `PARALLAIZE_DATA_FILE`: JSON state file path
- `PARALLAIZE_INCUS_PROJECT`: Incus project to target
- `PARALLAIZE_INCUS_STORAGE_POOL`: storage pool for new VMs and clones
- `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE`: hostname suffix for forwarded services, defaults to `localhost`

Forwarded guest HTTP and WebSocket services always get a path route such as
`/vm/<vm-id>/forwards/<forward-id>/`. Hostname-based routes only work when the
generated hostnames resolve in the browser. With the default `localhost` base,
Parallaize emits names like `app-ui--vm-0001.localhost`, which is good for
local testing. For remote hostnames, provide wildcard DNS for the chosen base
and see [docs/live-incus-setup.md](docs/live-incus-setup.md) for the Tailscale
and front-door expectations.

An example runtime file lives at [infra/parallaize.env.example](infra/parallaize.env.example).

## Persistence

JSON is the simplest local fallback. PostgreSQL is available when you want a more deployment-shaped persistence backend.

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
PARALLAIZE_PERSISTENCE=postgres \
PARALLAIZE_DATABASE_URL=postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize \
flox activate -d . -- pnpm start
```

The repo also includes a persistence admin CLI for moving state between JSON and PostgreSQL:

- `pnpm persistence:export`
- `pnpm persistence:import`
- `pnpm persistence:copy`

The operational backup, restore, and packaged-service ordering notes live in [docs/postgres-operations.md](docs/postgres-operations.md).

## Validation

Useful validation commands:

```bash
flox activate -d . -- pnpm typecheck
flox activate -d . -- pnpm test
flox activate -d . -- pnpm smoke:incus
```

`pnpm smoke:incus` is the live end-to-end path. It expects the control plane to be running in Incus mode, Caddy to be serving on `:8080`, and the current user to have `sudo` access for temporary guest-disk mount operations.

## Packaging

Parallaize includes a real package-build path for host installs.

- Supported package target: Ubuntu 24.04 `amd64` `.deb`
- Experimental package target: Ubuntu 24.04 `arm64` `.deb`
- Supported signed APT archive: Ubuntu 24.04 `amd64`

Build commands:

```bash
flox activate -d . -- pnpm package:deb
flox activate -d . -- pnpm package:deb:arm64
flox activate -d . -- pnpm package:apt-repo
flox activate -d . -- pnpm package:release
```

See [docs/packaging.md](docs/packaging.md) for package contents and host-install layout, and [docs/apt-repository.md](docs/apt-repository.md) for the signed Ubuntu 24.04 APT source and key flow.

## Further Reading

- [docs/live-incus-setup.md](docs/live-incus-setup.md)
- [docs/postgres-operations.md](docs/postgres-operations.md)
- [docs/template-prep.md](docs/template-prep.md)
- [docs/apt-repository.md](docs/apt-repository.md)
- [docs/packaging.md](docs/packaging.md)
- [infra/Caddyfile](infra/Caddyfile)
- [infra/docker-compose.postgres.yml](infra/docker-compose.postgres.yml)
