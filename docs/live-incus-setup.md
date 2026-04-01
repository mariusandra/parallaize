# Live Incus Setup

This is the practical setup path for running Parallaize in live mode with real Incus VMs after cloning the repo and before the first `pnpm start`.

## What "live mode" means here

- The control plane runs with `PARALLAIZE_PROVIDER=incus`.
- New workspaces are real Incus VMs, not mock sessions.
- Browser desktop access can use Selkies, direct noVNC, or Guacamole.
- VNC and Guacamole share the same guest `x11vnc` listener; Guacamole adds a host-local `guacd` daemon in front.
- Guest HTTP/WebSocket services can be exposed through Caddy.

The checked-in `start` script already targets Incus mode and uses `data/incus-state.json`:

```bash
flox activate -d . -- pnpm start
```

## Host prerequisites

Use a Linux host with working Incus VM support.

For local development on macOS, start Colima with the Incus runtime first:

```bash
brew install colima
colima start --runtime incus
```

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

## Set explicit guest desktop ports and transport relays

Set `PARALLAIZE_GUEST_VNC_PORT=5900` explicitly before starting the app if you want the guest VNC port pinned in your runtime env.

Set `PARALLAIZE_GUEST_SELKIES_PORT=6080` as well when you want the guest Selkies port pinned in the same way.

That matches the checked-in env example and the guest bootstrap wiring.

If you routinely hit Vite or Node watcher limits inside guests, you can also raise the default guest inotify caps from the control-plane env.

Use admin auth as well:

```bash
export PARALLAIZE_ADMIN_USERNAME=admin
export PARALLAIZE_ADMIN_PASSWORD=change-me
export PARALLAIZE_GUEST_VNC_PORT=5900
export PARALLAIZE_GUEST_SELKIES_PORT=6080
export PARALLAIZE_GUACD_HOST=127.0.0.1
export PARALLAIZE_GUACD_PORT=4822
export PARALLAIZE_FORWARDED_SERVICE_HOST_BASE=parallaize.localhost
export PARALLAIZE_GUEST_INOTIFY_MAX_USER_WATCHES=1048576
export PARALLAIZE_GUEST_INOTIFY_MAX_USER_INSTANCES=2048
```

Important Selkies expectation:

- Access through `127.0.0.1`, a same-host browser, or other simple bridged paths can work with no extra WebRTC configuration.
- Access through a reverse proxy, across NAT, or from remote clients is not predictable unless you give the guest Selkies runtime explicit STUN and usually TURN settings.
- Parallaize now forwards these host env vars into each guest bootstrap and later repair/restart path:
  - `PARALLAIZE_SELKIES_STUN_HOST`
  - `PARALLAIZE_SELKIES_STUN_PORT`
  - `PARALLAIZE_SELKIES_TURN_HOST`
  - `PARALLAIZE_SELKIES_TURN_PORT`
  - `PARALLAIZE_SELKIES_TURN_PROTOCOL`
  - `PARALLAIZE_SELKIES_TURN_TLS`
  - `PARALLAIZE_SELKIES_TURN_SHARED_SECRET`
  - `PARALLAIZE_SELKIES_TURN_USERNAME`
  - `PARALLAIZE_SELKIES_TURN_PASSWORD`
  - `PARALLAIZE_SELKIES_TURN_REST_URI`
  - `PARALLAIZE_SELKIES_TURN_REST_USERNAME`
  - `PARALLAIZE_SELKIES_TURN_REST_USERNAME_AUTH_HEADER`
  - `PARALLAIZE_SELKIES_TURN_REST_PROTOCOL_HEADER`
  - `PARALLAIZE_SELKIES_TURN_REST_TLS_HEADER`

Minimal static TURN example:

```bash
export PARALLAIZE_SELKIES_STUN_HOST=stun.example.com
export PARALLAIZE_SELKIES_STUN_PORT=3478
export PARALLAIZE_SELKIES_TURN_HOST=turn.example.com
export PARALLAIZE_SELKIES_TURN_PORT=5349
export PARALLAIZE_SELKIES_TURN_PROTOCOL=tcp
export PARALLAIZE_SELKIES_TURN_TLS=true
export PARALLAIZE_SELKIES_TURN_USERNAME=turn-user
export PARALLAIZE_SELKIES_TURN_PASSWORD=change-me
```

If your TURN service issues short-lived credentials through a REST helper instead, set the `PARALLAIZE_SELKIES_TURN_REST_*` values instead of static username/password secrets.

Bundled coturn sidecar recipe:

```bash
export PARALLAIZE_TURN_PUBLIC_IP=your-public-ip-or-dns
export PARALLAIZE_TURN_SHARED_SECRET="$(openssl rand -hex 32)"
docker compose -f infra/docker-compose.coturn.yml up -d

export PARALLAIZE_SELKIES_STUN_HOST="$PARALLAIZE_TURN_PUBLIC_IP"
export PARALLAIZE_SELKIES_STUN_PORT=3478
export PARALLAIZE_SELKIES_TURN_HOST="$PARALLAIZE_TURN_PUBLIC_IP"
export PARALLAIZE_SELKIES_TURN_PORT=3478
export PARALLAIZE_SELKIES_TURN_PROTOCOL=tcp
export PARALLAIZE_SELKIES_TURN_TLS=false
export PARALLAIZE_SELKIES_TURN_SHARED_SECRET="$PARALLAIZE_TURN_SHARED_SECRET"
```

Practical notes for the bundled recipe:

- Open `3478/tcp`, `3478/udp`, and the relay range `49160-49200/tcp+udp` to the host.
- `tcp` is the safer starting point for remote browsers behind SSH forwards, NAT, or locked-down Wi-Fi. If your users have clean UDP reachability, switch `PARALLAIZE_SELKIES_TURN_PROTOCOL` to `udp`.
- The control plane only injects the TURN config into guests when the server starts or when a desktop-bridge repair/restart runs. After setting these env vars, restart Parallaize and repair or restart already-running Selkies VMs.
- For source-run hosts, save these exports in `infra/parallaize.env.local`. `pnpm start` now sources that file automatically before applying its default Incus settings.
- Validation should show relay-capable RTC config in the browser: open a Selkies VM, inspect `globalThis.webrtc?.rtcPeerConfig`, and confirm the returned `iceServers` list contains a `turn:` entry for your public host instead of only the default Google STUN entry.

Guacamole expectation:

- Guacamole only needs the browser to reach Parallaize itself. The browser never talks directly to `guacd` or to the guest VNC port.
- The control plane does need a reachable `guacd` daemon at `PARALLAIZE_GUACD_HOST:PARALLAIZE_GUACD_PORT`.
- Because VNC and Guacamole share the same guest `x11vnc` runtime, switching a running VM between those two transports does not need a guest reboot or guest desktop bridge replacement.

Bring up the bundled `guacd` sidecar:

```bash
docker compose -f infra/docker-compose.guacd.yml up -d
```

Practical notes:

- Keep `PARALLAIZE_GUACD_HOST=127.0.0.1` unless you deliberately run `guacd` elsewhere.
- For source-run hosts, save the `PARALLAIZE_GUACD_*` values in `infra/parallaize.env.local` next to any TURN settings.
- If `guacd` is down, Guacamole sessions will stay pending while direct VNC still works.
- The dashboard can flip a running VM between Selkies, VNC, and Guacamole from the sidepanel. Selkies <-> VNC/Guacamole changes reconfigure the guest bridge; VNC <-> Guacamole only changes the host/browser path.

Optional Incus tuning:

- Set `PARALLAIZE_INCUS_STORAGE_POOL` if you want new VMs and clones to land on a faster `lvm`, `btrfs`, or `zfs` pool instead of a slow `dir` pool.
- On Hetzner dedicated hosts, the cleanest way to get that `lvm` pool is to create the LVM-backed disk or volume group from the Hetzner rescue system before installing Ubuntu, then initialize Incus against it afterward.
- Set `PARALLAIZE_INCUS_PROJECT` if you want Parallaize isolated inside a dedicated Incus project.
- Set `PARALLAIZE_DEFAULT_TEMPLATE_LAUNCH_SOURCE` if you want the seeded Ubuntu template pinned to a known-good local alias, fingerprint, or explicit remote image instead of following the moving `images:ubuntu/noble/desktop` alias. Existing seeded templates are reconciled to that value on restart.

## Hostname-based forwarded services

Every forwarded guest service gets two public entry points:

- a path route such as `/vm/<vm-id>/forwards/<forward-id>/`
- a hostname route built from `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE` as `<forward-name>--<vm-id>.<base>`

Path routes do not need DNS. Hostname routes do.

Practical expectations:

- `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE=parallaize.localhost` is the local-debug path. Browsers can resolve names like `app-ui--vm-0001.parallaize.localhost` back to loopback, so opening the dashboard on `127.0.0.1:3000` or through the example Caddy front door on `https://127.0.0.1:8080` is enough.
- For a real hostname base such as `workspaces.example.com`, publish wildcard DNS for that base so `*.workspaces.example.com` resolves to the Parallaize front door.
- The bundled `infra/Caddyfile` listens on HTTPS on `:8080` and forwards requests to `127.0.0.1:3000` without requiring per-host config, so once wildcard DNS points at that port, host-header routing works through the same front door as the rest of the app.
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
https://127.0.0.1:8080
```

The bundled front door is HTTPS-only. It uses Caddy's local CA, so the first
interactive launch may install that CA into your local trust store.

Caddy fronts:

- Dashboard and API traffic
- Server-sent events
- noVNC websocket upgrades at `/api/vms/:id/vnc`
- Guacamole websocket upgrades at `/api/vms/:id/guacamole`
- Forwarded guest services at `/vm/:id/forwards/:forwardId/`
- Hostname-based forwarded guest services on `*.parallaize.localhost` by default when you keep `PARALLAIZE_FORWARDED_SERVICE_HOST_BASE=parallaize.localhost`
- Selkies guest HTTP/WebSocket traffic when you browse the app through this same front door

If you already run a system Caddy on `:80` or a public hostname, that instance needs equivalent reverse-proxy rules for Parallaize. Leaving the stock Caddy welcome-site config in place will make paths like `/selkies-vm-0001/` return `404`, even when the control plane and guest Selkies service are healthy.

## Optional PostgreSQL persistence

Live Incus mode does not require PostgreSQL. You can run locally with JSON persistence only.

If you want the deployed-style persistence backend, start PostgreSQL first:

```bash
POSTGRES_PASSWORD='replace-with-a-long-random-password'
printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD" > infra/postgres.env.local
docker compose -f infra/docker-compose.postgres.yml up -d
PARALLAIZE_PERSISTENCE=postgres \
PARALLAIZE_DATABASE_URL="postgresql://parallaize:${POSTGRES_PASSWORD}@127.0.0.1:5432/parallaize" \
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

Then create a VM from the seeded Ubuntu 24.04 template (`tpl-0001`, shown as `Ubuntu Agent Forge`) in the UI.

What should happen:

- Incus launches a real VM from `images:ubuntu/noble/desktop` or from a locally captured alias if you later capture templates.
- Parallaize injects cloud-init to install and start `x11vnc`.
- The guest gets an address on the Incus bridge.
- The browser VNC path becomes available through the app and through Caddy if Caddy is running.
- After the guest finishes first-boot setup, the VNC session renders a desktop frame that is not pure black.

## Optional smoke test

Once the control plane is up in Incus mode and Caddy is serving HTTPS on `:8080`, you can run the live smoke path:

```bash
flox activate -d . -- pnpm smoke:incus
```

This smoke test creates a throwaway VM from the seeded Ubuntu 24.04 launch source by default, validates the VNC bridge, waits for a non-black desktop framebuffer, installs a guest HTTP service, verifies Caddy forwarding, and cleans the VM up afterward unless told not to.

Notes from the live PostgreSQL-backed run on March 26, 2026:

- Captured templates can outlive their published `parallaize-template-*` Incus image aliases. The control plane now recovers those creates from the newest compatible template snapshot instead of failing immediately on `Image "..." not found`.
- Compatibility matters during that recovery. If the newest snapshot was captured from a larger disk than the requested VM size, Parallaize now skips it and uses the newest snapshot that still fits. If none fit, increase the requested disk or recapture the template.
- On this host, the smoke path exercised the PostgreSQL-backed create, stop, start, and cleanup paths successfully, but host-to-guest HTTP verification remained the step to watch most closely during follow-up debugging.

## Optional live Playwright browser checks

When you want browser-level verification against a real Incus-backed server instead of the mock harness, keep the control plane running in live mode and use the dedicated Playwright entrypoint:

```bash
flox activate -d . -- pnpm playwright:install
flox activate -d . -- pnpm test:e2e:live
```

Defaults:

- `PARALLAIZE_E2E_BASE_URL` defaults to `http://127.0.0.1:3000`
- the runner looks for a Selkies-capable template automatically
- two throwaway VMs are created, exercised, and deleted

Useful overrides:

```bash
PARALLAIZE_E2E_BASE_URL=http://127.0.0.1:3000 \
PARALLAIZE_E2E_ADMIN_USERNAME=admin \
PARALLAIZE_E2E_ADMIN_PASSWORD=change-me \
PARALLAIZE_E2E_TEMPLATE_NAME="Ubuntu Agent Forge" \
PARALLAIZE_E2E_KEEP_VMS=1 \
flox activate -d . -- pnpm test:e2e:live
```

Additional knobs:

- `PARALLAIZE_E2E_TEMPLATE_ID` or `PARALLAIZE_E2E_TEMPLATE_NAME` to pin the launch source
- `PARALLAIZE_E2E_VM_PREFIX` to control the created VM names
- `PARALLAIZE_E2E_VM_TIMEOUT_MS` for slow first boots
- `PARALLAIZE_E2E_RESUME_TIMEOUT_MS` for slower stage/preview reconnects
- `PARALLAIZE_E2E_DELETE_TIMEOUT_MS` for slower live cleanup

This live runner checks the same four browser flows as the mock Playwright suite, but against real Incus data:

- creating a VM and getting a live Selkies stage session
- sidebar previews loading for the created VMs
- the selected VM keeping its sidebar preview active
- switching between VMs and getting both sessions back on stage

## Template Prep Checklist

When you want to turn a fresh Ubuntu VM into a reusable image, use the repeatable flow in [docs/template-prep.md](template-prep.md).

That checklist now lines up with what the guest bootstrap already does automatically on first boot:

- `indicator-multiload` is installed and started in the desktop session
- the Ubuntu dock is pinned to the right with 32px icons
- GNOME blank screen and inactive suspend are disabled for the default user session
- the Ubuntu first-login welcome flow is pre-dismissed for the default `ubuntu` user
- the first desktop login applies `Monument_valley_by_orbitelambda.jpg` when that wallpaper ships in the guest image

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
