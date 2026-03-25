# Parallaize

Parallaize is a server-first proof of concept for managing many isolated desktop workspaces from one browser UI. This repository now starts the control plane in real Incus VM mode by default, while still keeping a mock provider path available for fallback and tests. State can persist either to a local JSON file or to PostgreSQL, with PostgreSQL intended for deployed runs.

![Parallaize screencast](https://parallaize.com/screencast.gif)

## What Works

- Simplified React + Tailwind operator dashboard with server-sent updates
- Live workspace grid plus an embedded noVNC detail session when a guest VNC server is reachable
- Create, clone, start, stop, delete, resize, and snapshot flows
- Capture a running VM as a reusable environment template, or refresh an existing one while preserving snapshot history
- Real Incus lifecycle command wiring for create, clone, start, stop, delete, resize, snapshot, template publish, and guest command execution
- Browser-side VNC WebSocket bridge mounted at `/api/vms/:id/vnc`
- Configurable guest HTTP/WebSocket forwarding mounted at `/vm/:id/forwards/:forwardId/`
- Inject commands into a selected workspace and reflect the result in the UI
- Persist state to JSON or PostgreSQL through one shared store interface
- Import, export, or copy persisted state between JSON and PostgreSQL without manual editing
- Server-sent event updates for dashboard refresh
- `flox` environment with `nodejs_24`, `typescript`, `pnpm_10`, `caddy`, `incus`, `attr`, and `qemu_kvm`

## Current Gaps

- PostgreSQL persistence still needs more live Incus validation and backup/recovery docs before it should replace the JSON fallback everywhere
- Guest VNC/bootstrap steps should be codified more tightly into the documented template workflow
- Single-admin session expiry and rotation are still basic

Real Incus-backed browser VNC sessions and Caddy guest-service forwarding have now been validated against live Ubuntu desktop VMs on this host.

## Live Incus Smoke Test

With the control plane running in Incus mode and Caddy running on `:8080`, you can execute a host-backed end-to-end smoke test with:

```bash
flox activate -d . -- pnpm smoke:incus
```

The smoke command:

- Creates a throwaway VM from `tpl-0001`
- Waits for the browser VNC bridge to answer through Caddy
- Stops the VM, mounts its disk image on the host, and injects a tiny guest HTTP service
- Restarts the VM, waits for VNC recovery, configures a forwarded port, and validates the forwarded URL through Caddy
- Deletes the temporary VM unless `PARALLAIZE_SMOKE_KEEP_VM=1` is set

It assumes the current user can run `sudo` for the temporary guest-disk mount operations.
If admin auth is enabled, the smoke command will reuse `PARALLAIZE_ADMIN_USERNAME` and `PARALLAIZE_ADMIN_PASSWORD` unless you override them with `PARALLAIZE_SMOKE_ADMIN_USERNAME` and `PARALLAIZE_SMOKE_ADMIN_PASSWORD`.

## Authentication

The control plane now supports a shared single-admin browser session with cookie login, while still accepting Basic Auth headers for CLI and automation clients.

Set these env vars before starting the server:

```bash
PARALLAIZE_ADMIN_USERNAME=admin
PARALLAIZE_ADMIN_PASSWORD=change-me
```

When `PARALLAIZE_ADMIN_PASSWORD` is set:

- The browser loads the app shell and then signs in through an in-app login form that sets an HttpOnly session cookie.
- API clients, smoke tests, and scripts can continue sending Basic Auth headers directly.
- The same authenticated session protects:

- API routes
- Server-sent events
- Browser VNC websocket upgrades
- Forwarded guest-service routes

If the password is unset, auth is disabled.

## Guest Service Presets

Current working decision:

- Template images should only bake in the core desktop and VNC bootstrap needed for browser access.
- Guest HTTP/WebSocket services stay workload-specific and are configured as forwarded-port defaults on templates, not hardcoded into the base image.
- When you capture or refresh a template from a VM, the VM's forwarded-service defaults are preserved with that template for future launches.

## Incus Mode

The repo Flox environment now ships both `incus` and `incusd`, so the control plane can resolve the Incus binaries from `flox activate -d . -- ...`.

For VM-capable Incus on Ubuntu, the host also needs system QEMU/firmware helpers in standard locations:

```bash
sudo apt-get install -y attr ovmf qemu-system-x86 qemu-utils genisoimage
```

If the daemon is not already managed by the host init system, a working bootstrap flow on this machine was:

```bash
INCUSD_BIN="$(flox activate -d . -- bash -lc 'readlink -f $(command -v incusd)')"
INCUS_AGENT_PATH="$(dirname "$(dirname "$INCUSD_BIN")")/share/agent"
sudo env PATH=/usr/sbin:/usr/bin:/sbin:/bin INCUS_AGENT_PATH="$INCUS_AGENT_PATH" "$INCUSD_BIN" --group sudo
flox activate -d . -- incus admin init --minimal
flox activate -d . -- incus list --format json
```

The `--group sudo` socket setting matters here because the dashboard runs as the current user and needs direct access to `/var/lib/incus/unix.socket`.
`INCUS_AGENT_PATH` matters for VMs specifically: without it, the `agent:config` disk is created without the `incus-agent` binary, and browser command injection through `incus exec` fails with `VM agent isn't currently running`.

Then start the app on a Linux host with a valid VM-capable image source such as `images:ubuntu/noble/desktop`:

```bash
flox activate -d . -- pnpm start
```

Captured templates publish a reusable local Incus image alias and future launches use that alias as the template launch source.

### VM Storage Performance

On this host, `incus info` reports the active storage backend as `dir`. That works, but for VM-heavy create, clone, and snapshot workflows it is usually the slow path because the backend cannot use thin-provisioned or filesystem-native snapshot/copy features.
This is separate from Parallaize's control-plane state backend: switching JSON to PostgreSQL improves app-state durability and backup options, but it does not speed up Incus VM disk operations.

If you want faster VM provisioning and snapshot churn, create a faster Incus storage pool such as `lvm`, `btrfs`, or `zfs` and point Parallaize at it:

```bash
PARALLAIZE_INCUS_STORAGE_POOL=fastpool
flox activate -d . -- pnpm start
```

Parallaize will then pass `--storage fastpool` to `incus init` and `incus copy` for new VM launches, clones, and launches-from-snapshot. Existing instances stay on their current pool until you migrate them separately in Incus.

If you need the old demo path, run `pnpm run start:mock`.

### Guest Networking And Internet Access

On this host, the Incus bridge itself was healthy, but UFW's default-drop rules still blocked guest DHCP, guest DNS, and routed traffic. The symptom was that VMs only showed the Incus IPv6 ULA on `incusbr0`, never received an IPv4 lease, and had no outbound internet access.

If UFW is enabled on the host, allow DHCP and DNS on `incusbr0`, then allow forwarding from `incusbr0` to the host uplink:

```bash
HOST_UPLINK_IFACE="$(ip route show default | awk '{print $5; exit}')"
sudo ufw allow in on incusbr0 to any port 67 proto udp comment 'Incus DHCPv4'
sudo ufw allow in on incusbr0 to any port 53 proto udp comment 'Incus DNS UDP'
sudo ufw allow in on incusbr0 to any port 53 proto tcp comment 'Incus DNS TCP'
sudo ufw route allow in on incusbr0 out on "$HOST_UPLINK_IFACE" comment 'Incus outbound'
```

After those rules were added on this machine, fresh Incus VMs immediately started receiving IPv4 leases from `incusbr0` again.

### Guest VNC Setup

Inside the Ubuntu desktop guest template, install and enable a VNC server before capturing the base image. One workable `x11vnc` flow is:

```bash
sudo apt-get update
sudo apt-get install -y x11vnc
mkdir -p ~/.config/systemd/user
x11vnc -storepasswd
cat > ~/.config/systemd/user/x11vnc.service <<'EOF'
[Unit]
Description=Parallaize x11vnc session
After=graphical-session.target

[Service]
ExecStart=/usr/bin/x11vnc -display :0 -forever -loop -shared -rfbauth %h/.vnc/passwd -rfbport 5900
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now x11vnc.service
```

From the host, validate that the guest answers on the configured VNC port after the VM boots:

```bash
flox activate -d . -- incus list <instance-name> --format json
nc -vz <guest-ip> 5900
```

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

If you want PostgreSQL persistence instead of the JSON fallback, start the bundled database first and set a database URL:

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
PARALLAIZE_PERSISTENCE=postgres \
PARALLAIZE_DATABASE_URL=postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize \
flox activate -d . -- pnpm start
```

## Persistence Import And Export

Use the persistence admin CLI to move the singleton app state between JSON files and PostgreSQL without hand-editing the state blob. The CLI normalizes older persisted shapes on read and writes the canonical state on import.
That switch only changes how Parallaize persists its own control-plane state. If VM create, clone, or snapshot speed is the issue, move new VMs onto a faster Incus storage pool instead.

Copy an existing JSON deployment state into PostgreSQL:

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
flox activate -d . -- pnpm persistence:copy -- \
  --from json \
  --data-file data/incus-state.json \
  --to postgres \
  --database-url postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize
```

Export PostgreSQL state to a backup file:

```bash
mkdir -p backups
flox activate -d . -- pnpm persistence:export -- \
  --from postgres \
  --database-url postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize \
  --output backups/parallaize-state.json
```

Import a backup file into a JSON state file:

```bash
flox activate -d . -- pnpm persistence:import -- \
  --to json \
  --to-data-file data/restored-state.json \
  --input backups/parallaize-state.json
```

The CLI also accepts `PARALLAIZE_DATA_FILE` for JSON paths and `PARALLAIZE_DATABASE_URL` or `DATABASE_URL` for PostgreSQL URLs when you do not want to pass those flags directly.

4. Open `http://127.0.0.1:3000`.

## Caddy Front Door

The repository includes a local Caddy config at `infra/Caddyfile`.

Run it in a second terminal after the app server is up:

```bash
flox activate -d . -- caddy run --config infra/Caddyfile
```

Then open `http://127.0.0.1:8080`.

Caddy now fronts all of the user-facing traffic:

- Dashboard and API traffic
- Server-sent events
- noVNC WebSocket upgrades at `/api/vms/:id/vnc`
- Configured forwarded guest services at `/vm/:id/forwards/:forwardId/`

Forwarded guest services are configured per VM from the dashboard detail view. The control plane proxies HTTP and WebSocket traffic through one Caddy entrypoint, so a guest app on port `3000` might become a browser URL such as `/vm/vm-0007/forwards/port-01/`.

## Useful Commands

```bash
flox activate -d . -- pnpm build
flox activate -d . -- pnpm start
flox activate -d . -- pnpm test
flox activate -d . -- pnpm smoke:incus
flox activate -d . -- pnpm package:deb
flox activate -d . -- pnpm package:release
flox activate -d . -- pnpm persistence:copy -- --from json --data-file data/incus-state.json --to postgres --database-url postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize
flox activate -d . -- pnpm persistence:export -- --from postgres --database-url postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize --output backups/parallaize-state.json
flox activate -d . -- caddy validate --config infra/Caddyfile
docker compose -f infra/docker-compose.postgres.yml up -d
```

## Packaging

Parallaize now has a staged package builder for host installs. The first supported target is Ubuntu 24.04 `amd64` as a `.deb`, with experimental `.deb` `arm64` output emitted from the same workflow.

The package build path bundles Node 24 into the package, stages systemd and Caddy assets, and writes artifacts into `artifacts/packages/`. The detailed packaging note is in [`docs/packaging.md`](/home/marius/Projects/Parralaize/parallaize/docs/packaging.md), including a locked-down dedicated [Hetzner](https://hetzner.cloud/?ref=qOKe5qXBXByK) workflow for Ubuntu 24.04 that keeps the app on localhost and reaches it through SSH port forwarding.

Version bumps are not part of normal development changes in this repo. Leave `package.json` and other release-version references alone unless you are intentionally running the manual GitHub release workflow.

## Configuration

- `PARALLAIZE_APP_HOME`: packaged app root, default `process.cwd()`
- `HOST`: HTTP bind host, default `0.0.0.0`
- `PORT`: HTTP bind port, default `3000`
- `PARALLAIZE_CADDY_PORT`: packaged Caddy bind port, default `8080`
- `PARALLAIZE_PERSISTENCE`: persistence backend, `json` or `postgres`; defaults to `postgres` when a database URL is set, otherwise `json`
- `PARALLAIZE_DATABASE_URL`: PostgreSQL connection string; `DATABASE_URL` is also accepted
- `PARALLAIZE_DATA_FILE`: JSON state path for the file-backed store, default `data/state.json`
- `PARALLAIZE_PROVIDER`: `mock` or `incus`, default `incus` for `pnpm start`
- `PARALLAIZE_INCUS_BIN`: Incus binary path, default `incus`
- `PARALLAIZE_INCUS_PROJECT`: optional Incus project name
- `PARALLAIZE_INCUS_STORAGE_POOL`: optional Incus storage pool for new VM creates and copies; use this to move Parallaize off a slow `dir` pool
- `PARALLAIZE_TEMPLATE_COMPRESSION`: image compression for template capture, default `none`; accepted values mirror Incus (`bzip2`, `gzip`, `lz4`, `lzma`, `xz`, `zstd`, `none`)
- `PARALLAIZE_GUEST_VNC_PORT`: guest VNC port to bridge through noVNC, default `5900`
- `PARALLAIZE_GUEST_INOTIFY_MAX_USER_WATCHES`: inotify watch limit written into new guest VMs via cloud-init, default `1048576`
- `PARALLAIZE_GUEST_INOTIFY_MAX_USER_INSTANCES`: inotify instance limit written into new guest VMs via cloud-init, default `2048`
- `PARALLAIZE_ADMIN_USERNAME`: shared admin username for browser-session login or Basic Auth fallback, default `admin`
- `PARALLAIZE_ADMIN_PASSWORD`: shared admin password; when unset, auth is disabled

An example source-install env file is included at `infra/parallaize.env.example`. The package build ships its own install-time defaults at `packaging/config/parallaize.env`.

## Deployment Assets

- `packaging/systemd/parallaize.service`: packaged control-plane unit that runs `/usr/bin/parallaize`
- `packaging/systemd/parallaize-caddy.service`: packaged companion Caddy unit
- `packaging/config/parallaize.env`: packaged runtime env template
- `packaging/config/Caddyfile`: packaged Caddy config
- `infra/systemd/parallaize.service`: source-checkout unit that runs the built Node server through Flox
- `infra/systemd/parallaize-caddy.service`: source-checkout companion Caddy unit
- `infra/docker-compose.postgres.yml`: local PostgreSQL stack for the PostgreSQL-backed control-plane store

## Repo Layout

- `apps/control`: Node HTTP server, provider boundary, state store, and job orchestration
- `apps/web`: React + Tailwind dashboard source and static shell assets
- `packages/shared`: Shared types and formatting helpers
- `tests`: Node test runner coverage for the mock provider flow
- `.flox`: Local environment definition
