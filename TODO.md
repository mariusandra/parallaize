# Parallaize TODO

Last updated: 2026-03-25
Current focus: package Parallaize cleanly for Ubuntu 24.04 `amd64`, keep the `arm64` `.deb` artifact buildable from the same flow, and then validate the packaged install on a live Incus host.

## Current State

- The web POC is runnable end to end with the React dashboard, Node control plane, Caddy front door, noVNC browser sessions, forwarded guest-service routes, and Incus-backed VM lifecycle operations.
- Real-host validation already covers template capture, browser VNC through Caddy, forwarded guest HTTP services, cookie-backed login, and the `pnpm smoke:incus` path.
- State persistence now has a proper backend boundary: JSON remains available for tests and fallback, and PostgreSQL is wired in as a deployable backend.
- The main unfinished work is no longer core product plumbing. It is now persistence rollout polish, template/bootstrap repeatability, auth/session hardening, and ops cleanup.

## Working Rules

- Keep this file current when scope changes or a major task lands.
- Prefer finishing one verified vertical slice over adding speculative features.
- Leave package/app/docs version numbers unchanged during normal engineering work. Only the manual GitHub release workflow should update release-version references.
- After backend or infra changes, run `pnpm build`, `pnpm test`, and boot the real server with `pnpm start`.
- When touching Incus/Caddy/guest-network behavior, verify on the live host when feasible.

## Recently Completed

- [x] Real Incus lifecycle, snapshot, clone, and template-publish flows
- [x] Embedded noVNC browser sessions through the built-in VNC bridge
- [x] Caddy-backed guest HTTP/WebSocket forwarding
- [x] Shared single-admin cookie login with Basic Auth fallback
- [x] Host-backed `pnpm smoke:incus` automation
- [x] Pluggable persistence backend with PostgreSQL support and JSON fallback
- [x] Browser-to-guest and guest-to-browser clipboard flow for the main noVNC session, with browser-API fallback handling
- [x] Configurable guest bootstrap defaults for higher inotify watcher limits in new Incus VMs
- [x] Packaged-install foundation with bundled Node runtime, staged `.deb` builder, packaged systemd/Caddy assets, and a packaging decision note
- [x] Dispatch-driven release automation that bumps versioned package/docs references, builds package artifacts, uploads them to the archive bucket, pushes the release commit back to GitHub, and publishes GitHub releases with Debian assets
- [x] Host internet/bootstrap diagnostics plus guest desktop self-heal for packaged Incus VMs so X11/VNC converge even after a bad first boot
- [x] Repeated guest desktop bootstrap retries during running-session refresh so cloud-init-disabled Ubuntu desktop images can still recover VNC once the guest agent comes up
- [x] On-demand VM log modal that reads Incus console/info logs from the VM action menu and keeps polling while the modal stays open

## Priority Backlog

### P0: Persistence Rollout

- [ ] Run a full live `pnpm smoke:incus` pass with `PARALLAIZE_PERSISTENCE=postgres` and capture any host-specific fixes.
- [x] Add a supported import/export path so existing JSON state can be migrated into PostgreSQL without manual editing.
- [x] Surface persistence backend and persistence-failure status in `/api/health` and the operator UI/provider diagnostics.
- [ ] Document PostgreSQL backup/recovery and the expected table shape for deployed hosts.

### P1: Guest Template And Bootstrap Polish

- [ ] Turn the current guest VNC bootstrap notes into a repeatable template-prep checklist or script.
- [ ] Audit seeded templates and docs so forwarded services stay workload-specific and are not implied to be part of the base image.
- [ ] Tighten template capture/update ergonomics around real launch sources, snapshot history, and template notes.
- [ ] Clean up any leftover probe/validation instances and document the maintenance path.

### P1: Auth And Session Hardening

- [ ] Add server-side session expiry/rotation instead of relying on an in-memory token set with manual replacement.
- [ ] Decide whether admin sessions should survive a restart or be intentionally invalidated on boot, then document that behavior.
- [ ] Add targeted tests around login/logout/session expiry behavior.

### P2: Operations And Verification

- [ ] Add a lightweight server smoke check that boots the control plane and asserts `/api/health` plus `/api/summary`.
- [ ] Verify the PostgreSQL store under repeated create/clone/delete churn, not just the happy path.
- [ ] Record the exact production env/systemd flow for PostgreSQL-backed deployments.

### P2: Packaging And Upgrades

- [x] Write a packaging decision note comparing Ubuntu `.deb` installs against an npm-only install path; npm should remain the dev/operator source path, while deployed installs need a real system package because systemd, Incus access, QEMU helpers, and optional Caddy live outside Node.
- [x] Inventory packaged-install dependencies explicitly: bundled Node runtime, Incus CLI/socket access, optional Caddy, `attr`, VM-capable QEMU/OVMF helpers, optional PostgreSQL, and the systemd/env-file layout.
- [x] Decide first supported package targets: Ubuntu 24.04 LTS `amd64` `.deb` first, while `.deb` `arm64` remains experimental until it is validated on a live host.
- [x] Design an upgrade path for packaged installs: preflight checks, state backup/export, service restart ordering, rollback expectations, and current persistence/schema expectations.
- [ ] Install the generated Ubuntu 24.04 `amd64` `.deb` on a live host that uses a clean distro-managed Incus daemon and verify the packaged service units against real Incus, optional Caddy, and the packaged env file.
- [ ] Validate the generated `arm64` packages on a real `arm64` Incus/QEMU host before promoting them beyond experimental.
- [ ] Add package-signing to the release workflow once the package formats and support matrix settle.

### P2: Forwarded Service Routing

- [ ] Design host-based forwarded-service routing so operators can map a VM plus guest port to a stable HTTP/HTTPS hostname instead of only `/vm/:id/forwards/:forwardId/` paths.
- [ ] Verify whether the intended Tailscale deployment can terminate wildcard hostnames for self-hosted service routing; if not, document the fallback model for self-hosted wildcard DNS plus Caddy.
- [ ] Keep a fallback path-based or explicit-port routing mode for environments where wildcard host routing is not available or is too operationally heavy.

### P3: UX And Performance

- [ ] Measure live thumbnail cost with several active VMs before adding more preview behavior.
- [ ] Decide whether tile previews should stay low-frequency snapshots or move toward a more continuous stream.
- [ ] Validate clipboard sync on the live Incus desktop path and note any guest-side VNC server quirks that still block rich clipboard behavior.
- [ ] Revisit Guacamole or stronger session brokering only if noVNC becomes a real product blocker.

## Next Up

After each completed todo step, create a commit. Use a brief commit message that summarizes what was just done in the same style as the rewritten history.

1. Install and validate the generated Ubuntu 24.04 `amd64` `.deb` on a live host with a clean distro-managed Incus daemon.
2. Validate the generated `arm64` packages on a real `arm64` Incus/QEMU host.
3. Add package-signing to the release workflow once the package formats and support matrix settle.

## Decision Log

- 2026-03-25: Added startup recovery for interrupted boot/provision jobs so a control-plane restart no longer leaves a still-running Incus VM stranded in `error` without session/bootstrap refresh.
- 2026-03-25: Fixed a control-plane regression where new Incus VMs with only a guest IP were being treated as live VNC sessions, which stopped the missing-session refresh loop from retrying the guest desktop bootstrap after agent-ready recovery.
- 2026-03-25: Live-debugged a packaged `0.1.1` install on `devbox`, confirmed the Ubuntu desktop image had `cloud-init` disabled by generator, and moved the Incus guest desktop bootstrap retry into the normal missing-session refresh path so VNC self-heals after the guest agent becomes ready.
- 2026-03-25: Added host internet/bootstrap diagnostics for the Incus provider, made `/api/health` degrade on host egress failures, and switched guest desktop bootstrap to a retrying systemd service so `x11vnc` and the X11 GDM config can recover after a failed first boot.
- 2026-03-25: Extended the release workflow to create and push a GitHub release tag and attach the generated `amd64` and `arm64` Debian packages as GitHub release assets.
- 2026-03-25: Removed RPM package generation from the shared builder and release workflow after CI publish failures on cross-architecture Fedora container runs; Debian packages remain the only emitted artifacts.
- 2026-03-25: Documented the dedicated Hetzner packaged-install workflow for Ubuntu 24.04, including SSH-only UFW rules, localhost binding, and SSH port forwarding, and clarified the basic VM-to-template-or-fleet usage on the docs landing page.
- 2026-03-25: Added a dispatch-driven GitHub release workflow that updates package/docs version references, builds Debian artifacts, uploads them to Cloudflare R2, and pushes the release commit back to `main`.
- 2026-03-24: Installed the Ubuntu 24.04 `amd64` `.deb` on the live host, confirmed the packaged systemd units boot, and found two follow-ups: the package must add `parallaize` to `incus-admin` on Ubuntu, and full Incus-path validation should happen on a clean distro-managed Incus host because this machine already had a manual Flox `incusd` bound to the same socket path.
- 2026-03-24: Chose packaged host installs over npm-only deploys for real deployments, bundled the Node 24 runtime into the package, and made Ubuntu 24.04 `amd64` `.deb` the first supported package target while keeping `arm64` `.deb` experimental.
- 2026-03-22: Verified the real `incus` server boots cleanly against both JSON and PostgreSQL persistence; the PostgreSQL backend seeded and served state from the local Docker PostgreSQL stack.
- 2026-03-22: Added a persistence admin CLI for JSON/PostgreSQL export, import, and direct copy so deployment state can be migrated without manual edits.
- 2026-03-22: Added persistence diagnostics to the store boundary, exposed them through `/api/health`, and surfaced backend/degraded-state status in the operator UI.
- 2026-03-22: Added browser-session clipboard plumbing to the noVNC wrapper so the main stage can accept browser paste input and surface guest clipboard updates back to the operator.
- 2026-03-22: Replaced the hard-wired JSON store with a pluggable JSON/PostgreSQL state-store boundary. PostgreSQL persists the full app state in a singleton JSONB row; JSON remains available for tests and fallback.
- 2026-03-21: Chose Incus full VMs, Caddy, and noVNC as the shortest path to the first server-first browser POC.
- 2026-03-21: Kept guest workload services out of the base image and modeled them as forwarded-port defaults captured on templates.
- 2026-03-21: Added a standing rule to boot the real Incus-mode server after meaningful backend or infra changes.
