# macOS Desktop App

Parallaize Desktop is a lightweight native macOS wrapper around the existing web dashboard. It uses SwiftUI, WKWebView, and the system `ssh` binary. It does not bundle Electron or a browser runtime.

## Build

```bash
flox activate -d . -- bash scripts/build-macos-app.sh
```

The app bundle is written to:

```text
artifacts/macos/Parallaize.app
```

You can also compile only the Swift target:

```bash
swift build --package-path apps/desktop -c release
```

## How It Connects

Each desktop server entry stores:

- a display name
- an SSH target, exactly as you would pass it to `ssh`
- the remote Parallaize HTTP port, defaulting to `3000`
- whether the server should run from the packaged service or a dev checkout

When you connect, the app:

1. Runs a probe through `/usr/bin/ssh`.
2. Reads the installed Debian package version with `dpkg-query`.
3. Reads `parallaize.service` status with `systemctl`.
4. Reads UFW firewall status when available.
5. Installs Parallaize from the signed APT archive if the package is missing.
6. Starts `parallaize.service` if the package is installed but inactive.
7. Opens an SSH local forward to `127.0.0.1:<remote-port>`.
8. Loads the forwarded dashboard in WKWebView.

The webview maps dashboard Fullscreen API calls to native macOS window fullscreen. This keeps the in-app fullscreen control and the green window button in sync while avoiding WebKit's separate element-fullscreen window.

If the forwarded dashboard stops loading, the SSH process exits, or the local forwarded health check stops responding, the app tears down the stale tunnel and retries the SSH connection automatically with backoff.

## Server Actions

The connected app surface is intentionally minimal: the selected server opens directly into the webview. Server configuration lives in the sidebar context menu.

Right-click a server in the sidebar to:

- reconnect
- switch between packaged service and dev checkout mode
- enable or disable UFW
- remove the server

## Dev Mode

When you choose **Use Dev Checkout...**, the app asks for a remote checkout folder. The default is:

```text
/home/marius/Projects/Parralaize/parallaize
```

In dev mode the app skips the Debian package and `parallaize.service` setup. Instead it syncs the local checkout to the remote folder with `rsync` over SSH, then runs:

1. `pnpm install` when `node_modules` is missing.
2. `pnpm build`.
3. `HOST=127.0.0.1 PORT=<remote-port> pnpm start` in the background.

The sync excludes generated and heavy paths such as `.git`, `node_modules`, `dist`, `artifacts`, `.flox/cache`, `.flox/log`, and the managed dev PID/log files. If the app is not launched from this repository or from `artifacts/macos/Parallaize.app`, set `PARALLAIZE_DESKTOP_SYNC_SOURCE` to the local checkout path.

When `flox` exists on the remote host, those commands run through:

```bash
flox activate -d . -- <command>
```

The managed dev process writes:

```text
.parallaize-desktop-dev.pid
.parallaize-desktop-dev.log
```

inside the checkout folder. Switching the server back to packaged mode stops only that managed PID before reconnecting through the packaged flow.

## Remote Host Requirements

Automatic setup assumes an Ubuntu/Debian-style host with:

- SSH access through your normal macOS SSH config or agent
- key-based SSH auth, because the app runs SSH in batch mode
- passwordless `sudo -n` for package install, service start, and firewall changes
- `apt-get`, `systemd`, and UFW if you want firewall management
- for dev mode, a usable checkout with `pnpm` available directly or through Flox

If SSH or sudo requires an interactive password, the app reports the command failure in the setup log. In that case, bootstrap the server manually using the packaged install flow in [packaging.md](packaging.md), then reconnect from the desktop app.

## Firewall Toggle

The per-server firewall switch configures UFW:

- enabled: `deny incoming`, `allow outgoing`, `allow OpenSSH`, then `ufw --force enable`
- disabled: `ufw disable`

The intended production shape is still SSH-only inbound access with Parallaize bound to `127.0.0.1`.
