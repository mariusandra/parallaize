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

The `arm64` package is intentionally emitted from the same build system now, but it should stay marked experimental until it is validated on a live host with real Incus VM workloads.

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
- `btrfs-progs` for the packaged blank-host Btrfs bootstrap path
- `attr`
- `genisoimage`
- QEMU and firmware helpers
- `caddy` if you want the packaged front door
- PostgreSQL only if you switch persistence from JSON to PostgreSQL

Ubuntu 24.04 package metadata currently pins the VM helper packages directly, plus `btrfs-progs` so the packaged bootstrap path can avoid `dir` on blank hosts:

- `amd64`: `ovmf`, `qemu-system-x86`, `qemu-utils`
- `arm64`: `qemu-efi-aarch64`, `qemu-system-arm`, `qemu-utils`

## Build Commands

Run these from the repo root.

```bash
flox activate -d . -- pnpm package:deb
flox activate -d . -- pnpm package:deb:arm64
flox activate -d . -- pnpm package:release
```

Artifacts land in `artifacts/packages/`.

The package build flow does this:

1. Builds the normal app artifacts.
2. Bundles the server, persistence CLI, and smoke CLI into package-specific runtime bundles.
3. Downloads and verifies the matching official Node tarball for the target architecture.
4. Stages the install tree.
5. Emits `.deb` via `dpkg-deb`.

## GitHub Release Workflow

Use `.github/workflows/release.yml` when you want GitHub Actions to cut and publish a new packaged release from `main`.

Normal feature work, bug fixes, and docs cleanup should not bump versions in `package.json`, `docs/index.html`, this file, or any other release-version reference. Treat version changes as release-only edits driven by the manual GitHub Actions workflow.

Inputs:

- `version`: required stable semver such as `0.1.1`
- `package_release`: optional package revision suffix, defaults to `1`

Required GitHub repository secrets:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

The workflow does this:

1. Installs dependencies.
2. Updates `package.json`, `docs/index.html`, and this packaging note to the requested release version.
3. Builds `.deb` packages for `amd64` and `arm64`.
4. Uploads everything from `artifacts/packages/` to `s3://$R2_BUCKET/packages/` through the Cloudflare R2 endpoint so the public files stay available at `https://archive.parallaize.com/packages/`.
5. Commits the versioned-file changes back to `main`.
6. Creates a GitHub release tag and uploads the `amd64` plus `arm64` `.deb` files as release assets.

If branch protection blocks `github-actions[bot]` from pushing to `main`, allow workflow pushes or change the final step to open a pull request instead.

## Install And Boot

Ubuntu 24.04 `amd64` example:

```bash
sudo apt install ./artifacts/packages/parallaize_0.1.5-1_amd64.deb
sudo apt-get install -y pwgen
PARALLAIZE_ADMIN_PASSWORD="$(pwgen -s 24 1)"
printf 'Generated Parallaize admin password: %s\n' "$PARALLAIZE_ADMIN_PASSWORD"
sudo sed -i "s/^PARALLAIZE_ADMIN_PASSWORD=.*/PARALLAIZE_ADMIN_PASSWORD=$PARALLAIZE_ADMIN_PASSWORD/" \
  /etc/parallaize/parallaize.env
sudo systemctl start parallaize.service
```

The post-install scripts create a dedicated `parallaize` system user, create `/var/lib/parallaize`, and add that user to `incus`, `incus-admin`, `lxd`, and `sudo` when those groups already exist on the host. Services are not auto-started because the operator should rotate the default admin password first. The packaged Caddy unit stays optional; you do not need it when you are using the app directly on `127.0.0.1:3000`.

### Workflow For [Hetzner](https://hetzner.cloud/?ref=qOKe5qXBXByK)

This packaged install path works perfectly on dedicated [Hetzner](https://hetzner.cloud/?ref=qOKe5qXBXByK) machines.

The cleanest [Hetzner](https://hetzner.cloud/?ref=qOKe5qXBXByK) setup is:

- keep Parallaize bound to `127.0.0.1`
- allow inbound SSH only at the firewall
- reach the UI through SSH port forwarding from your laptop

On Ubuntu 24.04 `amd64`, this is the full command-line flow:

```bash
sudo apt-get update
sudo apt-get install -y curl pwgen ufw

curl -fLo /tmp/parallaize_0.1.5-1_amd64.deb \
  https://archive.parallaize.com/packages/parallaize_0.1.5-1_amd64.deb
sudo apt-get install -y /tmp/parallaize_0.1.5-1_amd64.deb

sudo cp /etc/parallaize/parallaize.env /etc/parallaize/parallaize.env.bak
sudo sed -i 's/^PARALLAIZE_ADMIN_USERNAME=.*/PARALLAIZE_ADMIN_USERNAME=admin/' \
  /etc/parallaize/parallaize.env
PARALLAIZE_ADMIN_PASSWORD="$(pwgen -s 24 1)"
printf 'Generated Parallaize admin password: %s\n' "$PARALLAIZE_ADMIN_PASSWORD"
sudo sed -i "s/^PARALLAIZE_ADMIN_PASSWORD=.*/PARALLAIZE_ADMIN_PASSWORD=$PARALLAIZE_ADMIN_PASSWORD/" \
  /etc/parallaize/parallaize.env
sudo grep -E '^(HOST|PORT|PARALLAIZE_ADMIN_USERNAME)=' \
  /etc/parallaize/parallaize.env

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status verbose

sudo systemctl enable --now parallaize.service
sudo systemctl status --no-pager parallaize.service
curl http://127.0.0.1:3000/api/health
```

What that does:

- `apt-get install /tmp/parallaize_...deb` installs the package and resolves the distro dependencies such as `incus`, QEMU helpers, and firmware from Ubuntu.
- The packaged env file already defaults `HOST=127.0.0.1` and `PORT=3000`, so the control plane stays local to the host.
- UFW ends up denying all new inbound traffic except SSH, which means you do not need to expose `3000` or `8080` publicly.
- You can skip Caddy entirely for this workflow because SSH tunneling is the intended front door.

Then create a local tunnel from your laptop:

```bash
ssh -N -L 3000:127.0.0.1:3000 root@YOUR_HETZNER_HOST
```

Now open this URL on your laptop:

```text
http://127.0.0.1:3000
```

If your local port `3000` is already in use, bind another local port instead:

```bash
ssh -N -L 8080:127.0.0.1:3000 root@YOUR_HETZNER_HOST
```

Then open:

```text
http://127.0.0.1:8080
```

On a blank Ubuntu 24.04 host where Incus is installed but not initialized yet, the package now bootstraps a basic local Incus setup during install:

- storage pool `default` with the `btrfs` driver when the host supports it, otherwise a `dir` fallback
- bridge network `incusbr0`
- `default` profile root disk pointing at pool `default`
- `default` profile NIC attached to `incusbr0`

That default Btrfs pool is loop-backed on blank hosts, which is still a compromise. It is materially better for snapshots and copy-on-write workflows than `dir`, but a dedicated `zfs`, `lvm`, or native `btrfs` pool remains the better production target.

The packaged env file also defaults `PARALLAIZE_INCUS_STORAGE_POOL=default` so new VM creates and copies keep targeting the bootstrap pool until the operator changes it.

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
