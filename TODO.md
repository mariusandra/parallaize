# Parallaize TODO

Last updated: 2026-03-29

This file tracks unresolved work only. Shipped behavior belongs in docs and git history.

Current focus: finish the provider split and keep peeling stateful UI surfaces out of `DashboardApp.tsx` now that the manager and browser-persistence seams are smaller.

Untrusted AI workflow work is deferred until the cleanup slices below are in materially better shape.

Completed implementation details now live in:

- `docs/live-incus-setup.md`
- `docs/incus-storage-benchmarks.md`
- `docs/template-prep.md`
- `docs/postgres-operations.md`
- `docs/packaging.md`
- `docs/apt-repository.md`
- `docs/refactor-map.md`

## Current Slice: Maintainability Cleanup

Goal: reduce file size, cross-cutting state, and duplicated helper logic in the control plane and dashboard before adding more feature surface.

### Block 1: Control Plane Decomposition

- [x] Extract auth/session handling from `apps/control/src/server.ts` into `apps/control/src/server-auth.ts`.
- [x] Extract generic HTTP/static/download/SSE helpers from `apps/control/src/server.ts` into `apps/control/src/server-http.ts`.
- [x] Extract latest-release parsing/cache logic from `apps/control/src/server.ts` into `apps/control/src/server-release.ts`.
- [x] Extract event stream and VM log-tail lifecycle code out of `apps/control/src/server.ts`.
- [x] Split `apps/control/src/server.ts` route handling into grouped route modules.
- [x] Split `apps/control/src/manager.ts` into read models, VM/template/snapshot commands, and background orchestration workers.
- [ ] Break `apps/control/src/providers.ts` into provider contracts, mock provider, Incus lifecycle, guest inspection, networking, and streaming helpers.
- [x] Separate `apps/control/src/store.ts` into store interface, normalization/migration helpers, JSON persistence, and PostgreSQL persistence.
- [x] Add targeted unit coverage for extracted control-plane helpers so behavior does not depend only on giant end-to-end suites.

### Block 2: Dashboard Decomposition

- [x] Extract create/template workflow helpers, VM browser/touched-file formatting, job/progress selectors, and health/status label helpers out of `apps/web/src/DashboardApp.tsx` into `apps/web/src/dashboardHelpers.ts`.
- [x] Extract leaf dashboard primitives from `apps/web/src/DashboardApp.tsx` into `apps/web/src/dashboardPrimitives.tsx`.
- [ ] Move app shell, overview, workspace stage, sidepanel sections, and dialog surfaces into focused components.
- [x] Pull browser-only fetch/SSE plumbing and fullscreen handling into dedicated services.
- [x] Pull browser-only persistence and resolution-control coordination into dedicated hooks/services.
- [ ] Split `apps/web/src/styles.css` into tokens, shell layout, workspace layout, dialogs, sidepanel, and feature-local sections/files.
- [x] Add targeted tests around extracted browser helpers so the view-model logic is characterized outside the monolith component.

### Block 3: Guardrails And Characterization

- [x] Keep `docs/refactor-map.md` aligned with live ownership seams, file budgets, and the next extraction targets.
- [x] Expand `tests/layering.test.ts` and neighboring guardrail tests so runtime boundaries stay enforced while files move.
- [ ] Remove dead helpers and duplicate formatting/state logic as extracted modules become the single source of truth.
- [ ] Keep `TODO.md` current whenever scope changes or a major cleanup slice lands.

### Block 4: Scripts, Packaging, And Docs Cleanup

- [ ] Normalize responsibilities under `scripts/` and trim duplicated packaging/config logic between `infra/` and `packaging/`.
- [ ] Audit README and operational docs for stale references after refactors land.
- [ ] Keep `pnpm build`, `pnpm test`, and `pnpm start` green after every verified cleanup slice.

## Deferred Until Cleanup Lands

- [ ] Resume the trusted/untrusted collection architecture only after the control plane and dashboard seams above are smaller and better tested.
- [ ] Evaluate Selkies as an alternative browser desktop transport once the current runtime boundaries are cleaner.
