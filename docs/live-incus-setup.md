# Live Incus Setup

This is the practical setup path for running Parallaize in live mode with real Incus VMs after cloning the repo and before the first `pnpm start`.

## What "live mode" means here

- The control plane runs with `PARALLAIZE_PROVIDER=incus`.
- New workspaces are real Incus VMs, not mock sessions.
- Browser desktop access goes through the built-in noVNC bridge.
- Guest HTTP/WebSocket services can be exposed through Caddy.

The checked-in `start` script already targets Incus mode and uses `data/incus-state.json`:

```bash
flox activate -d . -- pnpm start
```

## Host prerequisites

Use a Linux host with working Incus VM support.

Flox provides the repo-local toolchain, including `node`, `pnpm`, `incus`, `incusd`, `caddy`, and `qemu_kvm`.

The host OS still needs the standard VM helpers installed in normal system locations:

```bash
sudo apt-get install -y attr ovmf qemu-system-x86 qemu-utils genisoimage
```

Then install the repo dependencies:

```bash
flox activate -d . -- pnpm install
flox activate -d . -- pnpm build
```

## Bring up Incus

If your host already runs `incusd` as a system service, keep using that.

If not, this repo's documented bootstrap flow is:

```bash
INCUSD_BIN="$(flox activate -d . -- bash -lc 'readlink -f $(command -v incusd)')"
INCUS_AGENT_PATH="$(dirname "$(dirname "$INCUSD_BIN")")/share/agent"
sudo env PATH=/usr/sbin:/usr/bin:/sbin:/bin INCUS_AGENT_PATH="$INCUS_AGENT_PATH" "$INCUSD_BIN" --group sudo
flox activate -d . -- incus admin init --minimal
flox activate -d . -- incus list --format json
```

Notes:

- `--group sudo` matters because the app runs as your user and needs access to the Incus socket.
- `INCUS_AGENT_PATH` matters for VM guests. Without it, the `agent:config` disk will not include the Incus agent correctly, and guest command injection can fail.

## Fix guest networking if UFW is enabled

Fresh VMs need DHCP, DNS, and outbound internet access.

That is important for this repo because the seeded template launches from `images:ubuntu/noble/desktop`, and the app injects cloud-init on first boot to update packages, install `x11vnc`, and enable the Incus agent.

If UFW is enabled on the host, allow the Incus bridge traffic:

```bash
HOST_UPLINK_IFACE="$(ip route show default | awk '{print $5; exit}')"
sudo ufw allow in on incusbr0 to any port 67 proto udp comment 'Incus DHCPv4'
sudo ufw allow in on incusbr0 to any port 53 proto udp comment 'Incus DNS UDP'
sudo ufw allow in on incusbr0 to any port 53 proto tcp comment 'Incus DNS TCP'
sudo ufw route allow in on incusbr0 out on "$HOST_UPLINK_IFACE" comment 'Incus outbound'
```

If you skip this on a locked-down host, the usual symptom is that guests only get an IPv6 ULA, fail to get IPv4 from `incusbr0`, and never finish the first-boot package install cleanly.

## Reset the live JSON state on a fresh machine

This repo currently checks in a populated `data/incus-state.json`.

That file is not guaranteed to be portable between hosts. Right now it already contains host-local captured image aliases such as `parallaize-template-tpl-0001`. On a fresh machine, those aliases may not exist in your local Incus image store.

Because the `start` script hardcodes `PARALLAIZE_DATA_FILE=data/incus-state.json`, the safest first-run path on a new host is to move that file aside and let the app reseed clean Incus templates automatically:

```bash
mv data/incus-state.json data/incus-state.json.bak
```

When the JSON state file is missing, Parallaize will create a fresh state with a seeded template that points at `images:ubuntu/noble/desktop`.

## Set an explicit guest VNC port

Set `PARALLAIZE_GUEST_VNC_PORT=5900` explicitly before starting the app if you want the guest VNC port pinned in your runtime env.

That matches the checked-in env example and the cloud-init VNC service wiring.

If you routinely hit Vite or Node watcher limits inside guests, you can also raise the default guest inotify caps from the control-plane env.

Use admin auth as well:

```bash
export PARALLAIZE_ADMIN_USERNAME=admin
export PARALLAIZE_ADMIN_PASSWORD=change-me
export PARALLAIZE_GUEST_VNC_PORT=5900
export PARALLAIZE_FORWARDED_SERVICE_HOST_BASE=localhost
export PARALLAIZE_GUEST_INOTIFY_MAX_USER_WATCHES=1048576
export PARALLAIZE_GUEST_INOTIFY_MAX_USER_INSTANCES=2048
```

Optional Incus tuning:

- Set `PARALLAIZE_INCUS_STORAGE_POOL` if you want new VMs and clones to land on a faster `lvm`, `btrfs`, or `zfs` pool instead of a slow `dir` pool.
- Set `PARALLAIZE_INCUS_PROJECT` if you want Parallaize isolated inside a dedicated Incus project.

## Hostname-based forwarded services

Every forwarded guest service gets two public entry points:

- a path route such as `/vm/<vm-id>/forwards/<forward-id>/`
- a hostname route built from `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE` as `<forward-name>--<vm-id>.<base>`

Path routes do not need DNS. Hostname routes do.

Practical expectations:

- `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE=localhost` is the local-debug path. Browsers can resolve names like `app-ui--vm-0001.localhost` back to loopback, so opening the dashboard on `127.0.0.1:3000` or through the example Caddy front door on `:8080` is enough.
- For a real hostname base such as `workspaces.example.com`, publish wildcard DNS for that base so `*.workspaces.example.com` resolves to the Parallaize front door.
- The bundled `infra/Caddyfile` listens on `:8080` and forwards requests to `127.0.0.1:3000` without requiring per-host config, so once wildcard DNS points at that port, host-header routing works through the same front door as the rest of the app.
- If you do not want wildcard DNS, stay on the path routes. They are the compatibility fallback and do not depend on host-header routing.

Tailscale-specific expectation:

- Tailscale MagicDNS gives stable names to Tailscale devices themselves, for example `host-name.tailnet-name.ts.net`.
- Parallaize-generated forwarded-service names are extra subdomains under your configured base. Setting `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE` to a Tailscale device FQDN does not create matching per-forward MagicDNS records.
- If operators are reaching Parallaize over Tailscale only, the safe default is to keep using the path-based forwarded-service URLs on the device's normal tailnet name.
- If you want hostname-based forwarded services while staying on Tailscale, bring your own wildcard DNS zone that points at the Tailscale-reachable front door and keep `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE` on that wildcard-managed zone instead of on the raw `ts.net` device name.

## First live start

Start the control plane:

```bash
flox activate -d . -- pnpm start
```

That should bring up the server on `http://127.0.0.1:3000` unless you override `HOST` or `PORT`.

Open:

```text
http://127.0.0.1:3000
```

## Optional front door with Caddy

For the full user-facing path, run Caddy in a second terminal after the app server is up:

```bash
flox activate -d . -- caddy run --config infra/Caddyfile
```

Then open:

```text
http://127.0.0.1:8080
```

Caddy fronts:

- Dashboard and API traffic
- Server-sent events
- noVNC websocket upgrades at `/api/vms/:id/vnc`
- Forwarded guest services at `/vm/:id/forwards/:forwardId/`
- Hostname-based forwarded guest services on `*.localhost` by default when you keep `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE=localhost`

## Optional PostgreSQL persistence

Live Incus mode does not require PostgreSQL. You can run locally with JSON persistence only.

If you want the deployed-style persistence backend, start PostgreSQL first:

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
PARALLAIZE_PERSISTENCE=postgres \
PARALLAIZE_DATABASE_URL=postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize \
flox activate -d . -- pnpm start
```

When admin auth is enabled, Parallaize now stores sessions in app state instead of keeping them in memory only. Sessions survive control-plane restarts, rotate automatically, and are invalidated when the shared admin credentials change. The defaults are usually fine, but these knobs exist when you need them:

```bash
PARALLAIZE_SESSION_MAX_AGE_SECONDS=604800
PARALLAIZE_SESSION_IDLE_TIMEOUT_SECONDS=86400
PARALLAIZE_SESSION_ROTATION_SECONDS=21600
```

## Recommended first verification

After the app is up:

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/summary
```

Then create a VM from `tpl-0001` in the UI.

What should happen:

- Incus launches a real VM from `images:ubuntu/noble/desktop` or from a locally captured alias if you later capture templates.
- Parallaize injects cloud-init to install and start `x11vnc`.
- The guest gets an address on the Incus bridge.
- The browser VNC path becomes available through the app and through Caddy if Caddy is running.

## Optional smoke test

Once the control plane is up in Incus mode and Caddy is running on `:8080`, you can run the live smoke path:

```bash
flox activate -d . -- pnpm smoke:incus
```

This smoke test creates a throwaway VM, validates the VNC bridge, injects a guest HTTP service, verifies Caddy forwarding, and cleans the VM up afterward unless told not to.

It assumes the current user can run `sudo` for the temporary guest-disk mount operations.

Notes from the live PostgreSQL-backed run on March 26, 2026:

- Captured templates can outlive their published `parallaize-template-*` Incus image aliases. The control plane now recovers those creates from the newest compatible template snapshot instead of failing immediately on `Image "..." not found`.
- Compatibility matters during that recovery. If the newest snapshot was captured from a larger disk than the requested VM size, Parallaize now skips it and uses the newest snapshot that still fits. If none fit, increase the requested disk or recapture the template.
- On this host, the smoke path exercised the PostgreSQL-backed create, stop, start, and cleanup paths successfully, but host-to-guest HTTP verification remained the step to watch most closely during follow-up debugging.

## Template Prep Checklist

When you want to turn a fresh Ubuntu VM into a reusable image, use the repeatable flow in [docs/template-prep.md](template-prep.md).

That checklist now lines up with what the guest bootstrap already does automatically on first boot:

- `indicator-multiload` is installed and started in the desktop session
- the Ubuntu dock is pinned to the right with 32px icons
- each desktop login picks a random wallpaper from the installed wallpaper set

## DMZ Mode

DMZ mode applies a managed Incus ACL to a VM's bridge NIC.

- Guest egress keeps working for public internet access and public DNS resolution.
- Guest egress to host addresses, other private RFC1918 ranges, CGNAT ranges, loopback, link-local, multicast, and IPv6 ULA/link-local ranges is dropped.
- Host-initiated TCP from the bridge address stays allowed so the control plane can keep reaching guest VNC and forwarded-service ports.

Live notes from March 26, 2026:

- Earlier builds still let DMZ guests query the bridge resolver at `10.36.140.1:53`, which meant split-horizon names could still resolve even though private-range traffic stayed blocked. Current builds switch DMZ guests to public resolvers and drop bridge DNS entirely.
- That host was still carrying an older managed ACL named `parallaize-airgap` whose ingress allow only covered TCP `5900`. That preserved host VNC reachability but blocked forwarded guest HTTP. Re-applying DMZ mode from a current build rewrites the managed ACL to the broader host-ingress rule set.

## Copy-paste bootstrap sequence

For a fresh Ubuntu-like host, this is the shortest end-to-end sequence:

```bash
sudo apt-get install -y attr ovmf qemu-system-x86 qemu-utils genisoimage

flox activate -d . -- pnpm install
flox activate -d . -- pnpm build

INCUSD_BIN="$(flox activate -d . -- bash -lc 'readlink -f $(command -v incusd)')"
INCUS_AGENT_PATH="$(dirname "$(dirname "$INCUSD_BIN")")/share/agent"
sudo env PATH=/usr/sbin:/usr/bin:/sbin:/bin INCUS_AGENT_PATH="$INCUS_AGENT_PATH" "$INCUSD_BIN" --group sudo
flox activate -d . -- incus admin init --minimal
flox activate -d . -- incus list --format json

HOST_UPLINK_IFACE="$(ip route show default | awk '{print $5; exit}')"
sudo ufw allow in on incusbr0 to any port 67 proto udp comment 'Incus DHCPv4'
sudo ufw allow in on incusbr0 to any port 53 proto udp comment 'Incus DNS UDP'
sudo ufw allow in on incusbr0 to any port 53 proto tcp comment 'Incus DNS TCP'
sudo ufw route allow in on incusbr0 out on "$HOST_UPLINK_IFACE" comment 'Incus outbound'

mv data/incus-state.json data/incus-state.json.bak

export PARALLAIZE_ADMIN_USERNAME=admin
export PARALLAIZE_ADMIN_PASSWORD=change-me
export PARALLAIZE_GUEST_VNC_PORT=5900

flox activate -d . -- pnpm start
```

In a second terminal:

```bash
flox activate -d . -- caddy run --config infra/Caddyfile
```
