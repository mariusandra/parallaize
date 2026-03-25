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
export PARALLAIZE_GUEST_INOTIFY_MAX_USER_WATCHES=1048576
export PARALLAIZE_GUEST_INOTIFY_MAX_USER_INSTANCES=2048
```

Optional Incus tuning:

- Set `PARALLAIZE_INCUS_STORAGE_POOL` if you want new VMs and clones to land on a faster `lvm`, `btrfs`, or `zfs` pool instead of a slow `dir` pool.
- Set `PARALLAIZE_INCUS_PROJECT` if you want Parallaize isolated inside a dedicated Incus project.

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

## Optional PostgreSQL persistence

Live Incus mode does not require PostgreSQL. You can run locally with JSON persistence only.

If you want the deployed-style persistence backend, start PostgreSQL first:

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
PARALLAIZE_PERSISTENCE=postgres \
PARALLAIZE_DATABASE_URL=postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize \
flox activate -d . -- pnpm start
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
