# Packaging And Deployment Decision Note

Last updated: 2026-03-23

This note closes the current packaging/deployment design questions in `TODO.md`.
It does not yet add package-build automation.

## Decision Summary

- Keep the current repo checkout plus `flox activate -d . -- pnpm ...` flow as the supported development and operator-lab path.
- Treat a Debian package as the first supported deployed-install shape instead of an npm-only install.
- Target Ubuntu 24.04 LTS `amd64` first for packaged installs.
- Bundle the Parallaize runtime with a pinned Node 24 runtime for the first package instead of depending on the distro `nodejs` package.
- Keep Incus, Caddy, PostgreSQL, and VM host helpers as explicit host-level dependencies instead of trying to hide them behind the Node package.

## Why Not Npm-Only For Deployed Hosts

An npm-only install works for development because the operator already has the repo, Flox, and the build toolchain in hand. It is the wrong default for a deployed host because the product boundary is wider than Node:

- The control plane depends on Incus, the Incus socket, and VM-capable QEMU/OVMF helpers that are installed and managed by the host OS.
- The front door is Caddy, which is also a system service outside the Node process.
- Real deployments need a stable systemd unit, an env-file location, a dedicated runtime user, and a clear mutable-state path.
- Upgrades and rollbacks are operational events. They should not depend on rebuilding a repo checkout in place or on whatever Node version happens to be installed globally.

The repo checkout path should stay documented and supported, but it should be treated as the source/operator path, not the long-term packaged deployment story.

## Install Shapes

### Source Checkout Path

Use this for development, local validation, and operator-managed lab hosts:

- Repo checkout at `/opt/parallaize` or another working tree
- Flox-managed toolchain
- Built and started with `flox activate -d . -- pnpm build` and `flox activate -d . -- pnpm start`
- Current checked-in systemd units and Caddy config remain aligned to this path

### Packaged Host Path

Use this for the first-class deployed install once packaging is implemented:

- App payload under `/usr/lib/parallaize`
- Config under `/etc/parallaize`
- Mutable state and JSON fallback data under `/var/lib/parallaize`
- Systemd units installed into the distro-owned unit directory
- Thin wrapper binaries under `/usr/bin` only if they materially simplify admin flows

The package should install the built server, built web assets, helper scripts, and the persistence admin CLI. The package should not require a repo checkout or a build step on the host.

## Packaged Dependency Inventory

### Required For Live Incus Deployments

- Parallaize app payload plus a pinned Node 24 runtime bundled with the package
- `incus` CLI and a reachable `incusd` socket
- `attr`
- VM-capable QEMU helpers: `ovmf`, `qemu-system-x86`, `qemu-utils`, and `genisoimage`
- `systemd`

### Optional But First-Class Companions

- Caddy for the front door, browser VNC websocket proxying, and forwarded guest services
- PostgreSQL for deployed persistence

JSON persistence remains a supported fallback and recovery path, but PostgreSQL should stay the default for deployed installs.

### Runtime Ownership And Layout

- Dedicated `parallaize` user and group
- Writable state directory at `/var/lib/parallaize`
- Env file at `/etc/parallaize/parallaize.env`
- Journald-managed service logs
- Explicit host-specific access to the Incus socket group

The package should not try to own the Incus daemon lifecycle. It should assume the host already has working Incus VM support and that the operator has granted the runtime user access to the socket on that host.

## First Supported Targets

- Ubuntu 24.04 LTS `amd64` is the first packaged target.
- Keep the repo checkout path as the fallback for unsupported distributions and for development.
- Do not claim `arm64` package support until the full live Incus VM path has been validated on an `arm64` host, including VNC, forwarded services, smoke coverage, and the required QEMU/firmware helpers.

## Upgrade And Rollback Model

1. Run preflight checks before the upgrade:
   - `/api/health`
   - `/api/summary`
   - `incus list --format json`
   - `caddy validate` if the front door is enabled
   - PostgreSQL reachability if PostgreSQL persistence is in use
2. Export the current app state to JSON before changing the package:
   - Use the persistence admin CLI so the backup passes through the same normalization path as the server
   - Optionally take a full `pg_dump` when PostgreSQL is in use
3. Stop traffic in this order:
   - `parallaize-caddy`
   - `parallaize`
4. Install the new package while preserving:
   - `/etc/parallaize/parallaize.env`
   - `/var/lib/parallaize`
   - any exported backup artifacts
5. Start services in this order:
   - PostgreSQL if it was part of the maintenance window
   - `parallaize`
   - `parallaize-caddy`
6. Re-run `/api/health` and `/api/summary`, then run a focused smoke check before declaring the upgrade complete.
7. If the upgrade fails, reinstall the previous package and restore the exported state backup if the new build wrote an incompatible state shape.

## Persistence And Schema Handling

The current PostgreSQL layout is intentionally small: one `app_state` table and one logical row. That keeps backup and restore simple, but it also means packaged upgrades should avoid destructive maintainer-script migrations.

Current decision:

- Allow safe startup-time creation of missing tables or indexes.
- Do not run irreversible schema or state rewrites automatically from package hooks.
- If a future release needs an incompatible persistence migration, gate it behind an explicit backup/export step and document the rollback boundary clearly.

## Follow-On Implementation Work

This decision note closes the design backlog, but it does not yet implement:

- `.deb` build automation
- maintainer scripts for user, directory, and unit installation
- a packaged wrapper around the persistence admin CLI
- a fresh-host package smoke path on Ubuntu 24.04
