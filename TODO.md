# Parallaize TODO

Last updated: 2026-03-22
Current focus: validate PostgreSQL persistence on the live Incus path, codify guest template/VNC bootstrap, and tighten operator-session hardening.

## Current State

- The web POC is runnable end to end with the React dashboard, Node control plane, Caddy front door, noVNC browser sessions, forwarded guest-service routes, and Incus-backed VM lifecycle operations.
- Real-host validation already covers template capture, browser VNC through Caddy, forwarded guest HTTP services, cookie-backed login, and the `pnpm smoke:incus` path.
- State persistence now has a proper backend boundary: JSON remains available for tests and fallback, and PostgreSQL is wired in as a deployable backend.
- The main unfinished work is no longer core product plumbing. It is now persistence rollout polish, template/bootstrap repeatability, auth/session hardening, and ops cleanup.

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

### P3: UX And Performance

- [ ] Measure live thumbnail cost with several active VMs before adding more preview behavior.
- [ ] Decide whether tile previews should stay low-frequency snapshots or move toward a more continuous stream.
- [ ] Revisit Guacamole or stronger session brokering only if noVNC becomes a real product blocker.

## Next Up

1. Validate PostgreSQL-backed persistence against the real Incus smoke path.
2. Document PostgreSQL backup/recovery and the expected table shape for deployed hosts.
3. Codify the guest template/VNC bootstrap workflow so new base images are repeatable.

## Decision Log

- 2026-03-22: Verified the real `incus` server boots cleanly against both JSON and PostgreSQL persistence; the PostgreSQL backend seeded and served state from the local Docker PostgreSQL stack.
- 2026-03-22: Added a persistence admin CLI for JSON/PostgreSQL export, import, and direct copy so deployment state can be migrated without manual edits.
- 2026-03-22: Added persistence diagnostics to the store boundary, exposed them through `/api/health`, and surfaced backend/degraded-state status in the operator UI.
- 2026-03-22: Replaced the hard-wired JSON store with a pluggable JSON/PostgreSQL state-store boundary. PostgreSQL persists the full app state in a singleton JSONB row; JSON remains available for tests and fallback.
- 2026-03-21: Chose Incus full VMs, Caddy, and noVNC as the shortest path to the first server-first browser POC.
- 2026-03-21: Kept guest workload services out of the base image and modeled them as forwarded-port defaults captured on templates.
- 2026-03-21: Added a standing rule to boot the real Incus-mode server after meaningful backend or infra changes.
