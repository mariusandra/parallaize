# Parallaize TODO

Last updated: 2026-03-23
Current focus: codify guest template/VNC bootstrap, scope packaging and deployment choices, and design host-routed service access.

## Current State

- The web POC is runnable end to end with the React dashboard, Node control plane, Caddy front door, noVNC browser sessions, forwarded guest-service routes, and Incus-backed VM lifecycle operations.
- Real-host validation already covers template capture, browser VNC through Caddy, forwarded guest HTTP services, cookie-backed login, and the `pnpm smoke:incus` path against both JSON and PostgreSQL persistence.
- State persistence now has a proper backend boundary: JSON remains available for tests and fallback, and PostgreSQL is wired in as a deployable backend.
- The main unfinished work is no longer core product plumbing. It is now persistence rollout polish, template/bootstrap repeatability, packaging/deployment cleanup, and ops verification.

## Working Rules

- Keep this file current when scope changes or a major task lands.
- Prefer finishing one verified vertical slice over adding speculative features.
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

## Priority Backlog

### P0: Persistence Rollout

- [x] Run a full live `pnpm smoke:incus` pass with `PARALLAIZE_PERSISTENCE=postgres` and capture any host-specific fixes.
- [x] Add a supported import/export path so existing JSON state can be migrated into PostgreSQL without manual editing.
- [x] Surface persistence backend and persistence-failure status in `/api/health` and the operator UI/provider diagnostics.
- [x] Document PostgreSQL backup/recovery and the expected table shape for deployed hosts.

### P1: Guest Template And Bootstrap Polish

- [ ] Turn the current guest VNC bootstrap notes into a repeatable template-prep checklist or script.
- [ ] Audit seeded templates and docs so forwarded services stay workload-specific and are not implied to be part of the base image.
- [ ] Tighten template capture/update ergonomics around real launch sources, snapshot history, and template notes.
- [ ] Clean up any leftover probe/validation instances and document the maintenance path.

### P1: Auth And Session Hardening

- [x] Add server-side session expiry/rotation instead of relying on an in-memory token set with manual replacement.
- [x] Decide whether admin sessions should survive a restart or be intentionally invalidated on boot, then document that behavior.
- [x] Add targeted tests around login/logout/session expiry behavior.

### P2: Operations And Verification

- [x] Add a lightweight server smoke check that boots the control plane and asserts `/api/health` plus `/api/summary`.
- [x] Verify the PostgreSQL store under repeated create/clone/delete churn, not just the happy path.
- [x] Record the exact production env/systemd flow for PostgreSQL-backed deployments.

### P2: Packaging And Upgrades

- [ ] Write a packaging decision note comparing Ubuntu `.deb` installs against an npm-only install path; npm should likely remain the dev/operator source path, while deployed installs probably need a real system package because Incus, Caddy, systemd, and host QEMU helpers live outside Node.
- [ ] Inventory packaged-install dependencies explicitly: Node runtime or bundled binary, Incus CLI/socket access, Caddy, `attr`, VM-capable QEMU/OVMF helpers, optional PostgreSQL, and the systemd/env-file layout.
- [ ] Decide first supported package targets, likely Ubuntu 24.04 LTS `amd64` first, then add `arm64` only after the live Incus/QEMU path is verified on that architecture.
- [ ] Design an upgrade path for packaged installs: preflight checks, state backup/export, service restart ordering, rollback expectations, and how persistence/schema changes are handled safely.

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

1. Codify the guest template/VNC bootstrap workflow so new base images are repeatable.
2. Write the packaging decision note for deployed installs versus the npm/operator path.
3. Inventory packaged-install dependencies and upgrade constraints for the first supported target.

## Decision Log

- 2026-03-23: Added a dedicated `pnpm smoke:incus:churn` verifier for PostgreSQL-backed live hosts. A two-iteration run on this machine repeatedly created, booted, cloned, and deleted Incus VMs while polling the singleton `app_state` row directly, confirming that PostgreSQL state converges with the live control-plane view after churn and cleanup.
- 2026-03-23: Validated the live `pnpm smoke:incus` path against PostgreSQL-backed persistence. The run surfaced two host-specific VNC issues: the control-plane default guest VNC port had drifted to `5901` while the guest bootstrap still targeted `5900`, and captured-template launches could keep a stale `x11vnc -auth guess` service because cloud-init did not reliably rewrite it. Fixed both by restoring the default to `5900`, adding a config regression test, and repairing the guest VNC launcher/service over `incus exec` before the provider waits for the browser session.
- 2026-03-23: Added server-side browser-session expiry plus rotation, kept sessions intentionally in-memory across restarts, and covered login/logout/rotation/expiry behavior with built-server integration tests.
- 2026-03-23: Recorded the PostgreSQL-backed `/opt/parallaize` plus systemd deployment flow, env-file shape, and optional Caddy enablement in the README.
- 2026-03-23: Added a lightweight server smoke test that boots the built control plane in mock mode and validates `/api/health` plus `/api/summary`.
- 2026-03-23: Documented PostgreSQL operator backup/recovery flows, JSON fallback recovery, and the deployed `app_state` singleton table contract in the README.
- 2026-03-22: Verified the real `incus` server boots cleanly against both JSON and PostgreSQL persistence; the PostgreSQL backend seeded and served state from the local Docker PostgreSQL stack.
- 2026-03-22: Added a persistence admin CLI for JSON/PostgreSQL export, import, and direct copy so deployment state can be migrated without manual edits.
- 2026-03-22: Added persistence diagnostics to the store boundary, exposed them through `/api/health`, and surfaced backend/degraded-state status in the operator UI.
- 2026-03-22: Added browser-session clipboard plumbing to the noVNC wrapper so the main stage can accept browser paste input and surface guest clipboard updates back to the operator.
- 2026-03-22: Replaced the hard-wired JSON store with a pluggable JSON/PostgreSQL state-store boundary. PostgreSQL persists the full app state in a singleton JSONB row; JSON remains available for tests and fallback.
- 2026-03-21: Chose Incus full VMs, Caddy, and noVNC as the shortest path to the first server-first browser POC.
- 2026-03-21: Kept guest workload services out of the base image and modeled them as forwarded-port defaults captured on templates.
- 2026-03-21: Added a standing rule to boot the real Incus-mode server after meaningful backend or infra changes.
