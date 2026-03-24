# Packaged Installs

Parallaize now has a real package-build path for host installs.

## Decision

Keep two install modes:

- Source checkout plus `pnpm` plus `flox` remains the development and live-debug path.
- Real host installs should use an OS package because the deployed shape is not just Node code. It also needs systemd units, packaged config files, Incus access, host QEMU helpers, and an optional Caddy front door.

The package builder bundles the Node 24 runtime into the package so deployed hosts do not need a separate system `node` package.

## Support Matrix

- Supported: Ubuntu 24.04 `amd64` `.deb`
- Experimental build output: Ubuntu 24.04 `arm64` `.deb`
- Experimental build output: `x86_64` and `aarch64` `.rpm`

The `.rpm` and `arm64` packages are intentionally emitted from the same build system now, but they should stay marked experimental until they are validated on live hosts with real Incus VM workloads.

## Package Contents

The staged install layout is:

- `/usr/lib/parallaize`: bundled Node runtime, packaged server bundle, persistence CLI bundle, smoke CLI bundle, and web assets
- `/usr/bin/parallaize`: control-plane launcher
- `/usr/bin/parallaize-persistence`: persistence import/export/copy launcher
- `/usr/bin/parallaize-smoke-incus`: packaged smoke CLI
- `/usr/lib/systemd/system/parallaize.service`: control-plane unit
- `/usr/lib/systemd/system/parallaize-caddy.service`: optional Caddy front-door unit
- `/etc/parallaize/parallaize.env`: packaged runtime env file
- `/etc/parallaize/Caddyfile`: packaged Caddy config

## Host Dependencies

Bundled inside the package:

- Node 24 runtime
- The built Parallaize server, persistence CLI, smoke CLI, and web assets

Expected from the host:

- `incus`
- `attr`
- `genisoimage`
- QEMU and firmware helpers
- `caddy` if you want the packaged front door
- PostgreSQL only if you switch persistence from JSON to PostgreSQL

Ubuntu 24.04 package metadata currently pins the VM helper packages directly:

- `amd64`: `ovmf`, `qemu-system-x86`, `qemu-utils`
- `arm64`: `qemu-efi-aarch64`, `qemu-system-arm`, `qemu-utils`

The RPM build currently leaves more of that dependency resolution to the operator because package names vary too much across RPM families to claim a verified target yet.

## Build Commands

Run these from the repo root.

```bash
flox activate -d . -- pnpm package:deb
flox activate -d . -- pnpm package:deb:arm64
flox activate -d . -- pnpm package:rpm
flox activate -d . -- pnpm package:rpm:arm64
flox activate -d . -- pnpm package:release
```

Artifacts land in `artifacts/packages/`.

The package build flow does this:

1. Builds the normal app artifacts.
2. Bundles the server, persistence CLI, and smoke CLI into package-specific runtime bundles.
3. Downloads and verifies the matching official Node tarball for the target architecture.
4. Stages the install tree.
5. Emits `.deb` via `dpkg-deb`.
6. Emits `.rpm` via local `rpmbuild` or a Fedora container when `rpmbuild` is not installed on the host.

## Install And Boot

Ubuntu 24.04 `amd64` example:

```bash
sudo apt install ./artifacts/packages/parallaize_0.1.0-1_amd64.deb
sudoedit /etc/parallaize/parallaize.env
sudo systemctl start parallaize.service
sudo systemctl start parallaize-caddy.service
```

The post-install scripts create a dedicated `parallaize` system user, create `/var/lib/parallaize`, and add that user to `incus`, `incus-admin`, `lxd`, and `sudo` when those groups already exist on the host. Services are not auto-started because the operator should review the env file first.

## Live Verification Note

The Ubuntu 24.04 `amd64` package has been installed and boot-tested on a live host:

- `dpkg -i` succeeds
- `parallaize.service` starts from the packaged bundle and env file
- `parallaize-caddy.service` starts and serves the packaged front door

One host-specific caveat showed up during validation: this machine already had a manually started Flox `incusd` process before the distro `incus` package was installed. Installing Ubuntu's `incus` package also enabled `incus.socket`, so the host ended up with a mixed daemon setup on `/var/lib/incus/unix.socket`. In that state, the packaged Parallaize service wiring is correct, but clean Incus API verification is blocked by the host daemon conflict itself.

For the first supported path, validate packaged Incus access on a host that is either:

- fully managed by the distro `incus` package, or
- still using the manual Flox daemon without also enabling the distro socket-activated units

## Upgrade Path

Current upgrade contract:

1. Export or back up state before the upgrade.
2. Stop `parallaize-caddy.service` first, then `parallaize.service`.
3. Install the new package.
4. Start `parallaize.service`, validate `/api/health`, then start `parallaize-caddy.service`.
5. If the upgrade fails, reinstall the previous package and restore the exported state.

Use the packaged CLI for JSON/PostgreSQL state backups:

```bash
parallaize-persistence export --from json --output /var/backups/parallaize-state.json
parallaize-persistence export --from postgres --output /var/backups/parallaize-state.json
```

Schema risk is currently low because Parallaize still persists a single normalized app-state blob rather than a long migration chain, but upgrades should still be treated as stateful and reversible.
