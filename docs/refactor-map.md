# Refactor Map

Last updated: 2026-03-29

This note is the current architecture map for the refactor program. It describes the dependency direction we want to keep, the main runtime flows that exist today, the largest ownership seams, and the first split targets.

## Dependency Direction

Target direction:

1. `packages/shared`: stable contracts, helpers, and types with no Node, React, or app-runtime imports.
2. Pure feature logic inside each runtime: selectors, formatters, validation, and state-shaping helpers that should only depend on shared contracts plus same-runtime pure modules.
3. Runtime adapters at the edge:
   - `apps/control/src/providers.ts`, `apps/control/src/providers-contracts.ts`, `apps/control/src/providers-incus.ts`, `apps/control/src/store.ts`, `apps/control/src/network.ts`, `apps/control/src/config.ts`
   - browser-only hooks and transport adapters such as `apps/web/src/NoVncViewport.tsx`, `apps/web/src/desktopResolution.ts`, `apps/web/src/dashboardPersistence.ts`, and `apps/web/src/dashboardResolutionControl.ts`
4. Composition roots and entrypoints only:
   - `apps/control/src/server.ts`
   - `apps/web/src/main.tsx`
   - CLI and build entrypoints under `scripts/`

Current enforcement:

- `tests/layering.test.ts` blocks web-to-control imports, control-to-web imports, and Node/React imports from `packages/shared`.
- `tests/layering.test.ts` also keeps `dashboardTransport.ts`, `dashboardFullscreen.ts`, `dashboardPersistence.ts`, `dashboardResolutionControl.ts`, and `dashboardShell.ts` React-free, keeps `store-normalize.ts` free of Node/pg adapters, and prevents cross-pollination between the JSON and PostgreSQL persistence backends.

## Entrypoints And Runtime Flows

Entrypoints:

- `apps/control/src/server.ts`: composition root that loads config, builds the provider/store/manager, wires `server-events.ts`, attaches the forwarded-service bridge, and delegates grouped HTTP handling to `server-routes-*.ts`.
- `apps/web/src/main.tsx`: mounts `DashboardApp`.
- `apps/control/src/persistence-cli.ts`: admin persistence tooling.
- `scripts/*.ts|*.mjs`: build, smoke, packaging, and release entrypoints.

Main runtime flows:

- Auth flow: `/api/auth/login`, `/api/auth/status`, and `/api/auth/logout` are handled in `server.ts`; session records are persisted in store state.
- Dashboard summary flow: the web app loads `/api/summary`, then detail, health, release metadata, and event streams as needed.
- VM mutation flow: the server decodes inputs, `DesktopManager` validates and records jobs, and `DesktopProvider` implementations perform provider-specific work.
- Session/rendering flow: the manager refreshes VM sessions, the server exposes VNC bridge paths and frame SVGs, and the web app renders the active desktop through `NoVncViewport`.
- Forwarded-service flow: `VmNetworkBridge` owns proxied HTTP/WebSocket requests once the main server has authenticated the request.

Top dependency chains today:

- `DashboardApp.tsx` -> browser APIs, dashboard transport/fullscreen/persistence/resolution-control services, extracted dialog/rail/shared-ui modules, desktop helpers, noVNC adapter, and shared contracts.
- `server.ts` -> config/store/provider/manager/network bridge plus auth/session, route modules, event-stream service, and release-cache wiring.
- `manager.ts` -> composition root over `manager-core.ts`, `manager-read-models.ts`, `manager-commands.ts`, and `manager-workers.ts`.
- `providers.ts` -> facade over `providers-contracts.ts` plus the heavy runtime in `providers-incus.ts`.
- `providers-incus.ts` -> shared helpers/contracts, guest bootstrap scripts, Incus CLI, sockets, and host probes.
- `store.ts` -> store composition and re-exports over `store-types.ts`, `store-normalize.ts`, `store-json.ts`, and `store-postgres.ts`.

## HTTP Surface Inventory

HTTP route groups are now split across `apps/control/src/server-routes-public.ts`, `apps/control/src/server-routes-system.ts`, `apps/control/src/server-routes-vms.ts`, and `apps/control/src/server-routes-templates.ts`:

- Auth:
  - `POST /api/auth/login`
  - `GET /api/auth/status`
  - `POST /api/auth/logout`
- Shell and static assets:
  - `GET|HEAD /`
  - `GET|HEAD /favicon.svg`
  - `GET|HEAD /favicon.ico`
  - `GET|HEAD /assets/*`
- Health and release metadata:
  - `GET /api/health`
  - `POST /api/incus/storage/action`
  - `GET /api/version/latest`
- Summary and event streams:
  - `GET /api/summary`
  - `GET /events`
- VM reads:
  - `GET /api/vms/:vmId`
  - `GET /api/vms/:vmId/frame.svg`
  - `GET /api/vms/:vmId/logs/live`
  - `GET /api/vms/:vmId/files`
  - `GET /api/vms/:vmId/files/download`
  - `GET /api/vms/:vmId/touched-files`
  - `GET /api/vms/:vmId/disk-usage`
- VM writes:
  - `POST /api/vms`
  - `POST /api/vms/reorder`
  - `POST /api/vms/:vmId/update`
  - `POST /api/vms/:vmId/forwards`
  - `POST /api/vms/:vmId/network`
  - `POST /api/vms/:vmId/resolution`
  - `POST /api/vms/:vmId/resolution-control/claim`
  - `POST /api/vms/:vmId/{clone,start,stop,restart,delete,snapshot,resize,template,input}`
  - `POST /api/vms/:vmId/snapshots/:snapshotId/{launch,restore}`
- Template writes:
  - `POST /api/templates`
  - `POST /api/templates/:templateId/{update,delete}`
- Forwarded services:
  - `VmNetworkBridge.maybeHandleRequest(...)`
  - HTTP upgrade handling on `server.on("upgrade", ...)`

## Manager Surface Inventory

`DesktopManager` is now a thin coordinator over these files:

- `apps/control/src/manager-core.ts`
  - shared state helpers, validation, ID builders, telemetry/session shapers, and template/snapshot utility logic
- `apps/control/src/manager-read-models.ts`
  - `getProviderState()`
  - `getSummary()`
  - `getVmDetail()`
  - `getVmFrame()`
  - guest inspection reads such as logs, files, touched files, and disk usage
- `apps/control/src/manager-commands.ts`
  - VM lifecycle, snapshot lifecycle, template lifecycle, commands, networking, and forwarded-port mutations
- `apps/control/src/manager-workers.ts`
  - provider-state sync
  - failed/interrupted job recovery
  - session refresh loop
  - host and VM telemetry sampling
- `apps/control/src/manager.ts`
  - composition, listener fan-out, and the small private helpers that still bind store/provider side effects together

## Provider Surface Inventory

`apps/control/src/providers.ts` is now a small facade over `apps/control/src/providers-contracts.ts` and `apps/control/src/providers-incus.ts`.

`apps/control/src/providers-incus.ts` still covers two implementations behind one interface, but it now delegates template-publish and VM-create progress parsing/status normalization to `apps/control/src/providers-incus-progress.ts`:

- Host probing and provider health:
  - `refreshState()`
  - `sampleHostTelemetry()`
  - `sampleVmTelemetry()`
  - `observeVmPowerState()`
- VM lifecycle:
  - `createVm()`
  - `cloneVm()`
  - `startVm()`
  - `stopVm()`
  - `deleteVm()`
  - `resizeVm()`
  - `setNetworkMode()`
  - `setDisplayResolution()`
- Snapshot and template capture:
  - `snapshotVm()`
  - `launchVmFromSnapshot()`
  - `restoreVmToSnapshot()`
  - `captureTemplate()`
- Guest bootstrap and session attach:
  - `refreshVmSession()`
  - guest-agent retries
  - desktop bootstrap repair
  - reachable-session probing
- Logs and file inspection:
  - `readVmLogs()`
  - `streamVmLogs()`
  - `readVmDiskUsage()`
  - `browseVmFiles()`
  - `readVmFile()`
  - `readVmTouchedFiles()`
- Rendering:
  - `tickVm()`
  - `renderFrame()`

Incus-specific internals still span networking ACLs, guest DNS profile sync, Incus CLI execution, streaming publish progress parsing, and multiple guest-side helper script builders.

## Dashboard Surface Inventory

`apps/web/src/DashboardApp.tsx` still owns these feature areas in one file, but more shell state and surfaces now live beside it:

- App shell:
  - initial boot, summary loading, health polling, release polling
  - rail layout, resizing, shell menu, theme, fullscreen
- Auth:
  - login form, logout flow, auth-required recovery
- Workspace stage:
  - selected VM routing, live desktop session retention, noVNC stage rendering
  - resolution-control lease handling, viewport sizing, fullscreen keyboard lock
- Workspace sidepanel:
  - VM actions, resize, network mode, forwards, command console
  - file browser, touched files, disk usage, snapshot launch/restore, template capture
  - repo-source editing for trusted collection metadata
- Dialogs:
  - create, clone VM, rename, template clone, template edit, and VM logs now render through `apps/web/src/dashboardDialogs.tsx`
- Rail and shared UI:
  - `apps/web/src/dashboardRail.tsx` now owns the rail tile/icon layer
  - `apps/web/src/dashboardUi.tsx` now owns reusable popover, telemetry, class-name, and log-output helpers
- Shell and stage helpers:
  - `apps/web/src/dashboardShell.ts` now owns shell-state types plus pure rail-width, sidepanel-width, and desktop-resolution helpers
  - `apps/web/src/dashboardStage.tsx` now owns empty/boot/log/fallback stage surfaces plus the viewport-control lock overlay
- Inspector and overview panels:
  - `apps/web/src/dashboardSidepanel.tsx` now owns the VM inspector, overview panel, resize handles, and template cards
- Browser-only persistence:
  - `apps/web/src/dashboardPersistence.ts` now owns localStorage-backed rail width, sidepanel width, live preview preference, overview collapse, CPU thresholds, and resolution preferences
  - `apps/web/src/dashboardResolutionControl.ts` now owns browser-tab client IDs plus lease claim/release coordination
- Browser-only event plumbing:
  - summary SSE stream
  - live VM log SSE stream
  - storage and visibility events

## Ownership Boundaries To Keep

- Persisted state normalization belongs in `apps/control/src/store-normalize.ts` and future persistence-focused helpers. Callers should consume normalized state, not replicate migration rules.
- Persistence adapters belong in `apps/control/src/store-json.ts` and `apps/control/src/store-postgres.ts`. Callers should stay on the `StateStore` interface exported by `apps/control/src/store.ts`.
- Raw Incus CLI details belong in `apps/control/src/providers-incus.ts` and future Incus-only submodules. `manager.ts`, `server.ts`, and `packages/shared` should only depend on provider contracts and provider state.
- Browser-only storage, DOM, fullscreen, and visibility APIs belong in the web app only. Shared contracts and control-plane code should not know about them.
- Browser fetch/SSE transport details belong in `apps/web/src/dashboardTransport.ts`, and fullscreen coordination belongs in `apps/web/src/dashboardFullscreen.ts`, not in shared contracts or control-plane code.
- Browser-local storage/document helpers belong in `apps/web/src/dashboardPersistence.ts`, and resolution-control lease storage belongs in `apps/web/src/dashboardResolutionControl.ts`, not inline in `DashboardApp.tsx`.

## Current Characterization Coverage

High-risk behavior is already pinned by tests before major extractions:

- Auth login/logout, session rotation, summary gating, release metadata, SSE shutdown, and resolution-control claims:
  - `tests/server.test.ts`
- VM log append shaping and store/backend boundary enforcement for the new seams:
  - `tests/dashboard-transport.test.ts`
  - `tests/layering.test.ts`
- VM create/clone/start/stop/delete, snapshot flows, template capture, forwarded services, provider mutations, and noVNC route derivation:
  - `tests/manager.test.ts`
- noVNC adapter behavior:
  - `tests/novnc.test.ts`
- Displayed session and dashboard desktop-session selectors:
  - `tests/desktop-session.test.ts`
- Resolution-control queueing and lease parsing:
  - `tests/desktop-resolution.test.ts`
- Browser storage and browser lease coordination:
  - `tests/dashboard-persistence.test.ts`
  - `tests/dashboard-resolution-control.test.ts`

## Success Metrics

- Hotspot files move below rough budgets:
  - `DashboardApp.tsx` under 3k LOC
  - `providers-incus.ts` under 2.5k LOC
  - `manager.ts` under 1.5k LOC
  - `server.ts` under 900 LOC
  - `styles.css` split into smaller feature files
- New feature work changes one feature folder plus one contract surface, not several unrelated runtime files.
- Tests map to one behavior slice at a time instead of one giant suite per runtime.
- Cross-layer imports trend downward and stay enforced by `tests/layering.test.ts`.

## Split Notes For First Hotspots

- `apps/control/src/server.ts`
  - Landed seam: composition root + route modules + auth/session service + event-stream service + release-cache service.
  - Next extraction target: shutdown/socket lifecycle helpers if `server.ts` grows again.
- `apps/control/src/manager.ts`
  - Landed seam: `manager.ts` now composes `manager-core.ts`, `manager-read-models.ts`, `manager-commands.ts`, and `manager-workers.ts`.
  - Next extraction target: pull the remaining private job/publish glue out if the coordinator starts growing again.
- `apps/control/src/providers.ts`
  - Landed seam: `providers.ts` is now a thin facade over `providers-contracts.ts` and `providers-incus.ts`.
  - Additional seam: shared provider contracts/constants now live in `providers-contracts.ts`, while publish/create progress parsing and status normalization live in `providers-incus-progress.ts`.
  - Next extraction target: peel host/network/guest/file-inspection helper categories out of `providers-incus.ts`.
- `apps/control/src/store.ts`
  - Landed seam: `store.ts` facade over store interface, JSON backend, PostgreSQL backend, and normalization/migration helpers.
- `apps/web/src/DashboardApp.tsx`
  - Landed seam: dashboard transport/fullscreen/persistence/resolution-control services extracted, with dialogs in `dashboardDialogs.tsx`, rail tiles/icons in `dashboardRail.tsx`, reusable UI in `dashboardUi.tsx`, pure shell helpers in `dashboardShell.ts`, stage surfaces in `dashboardStage.tsx`, and overview/inspector panels in `dashboardSidepanel.tsx`.
  - Next extraction target: the remaining app-shell orchestration, shell menu logic, and residual inline render branches.
- `apps/web/src/NoVncViewport.tsx`
  - Target seam: noVNC loader, connection-state reducer, clipboard helpers, and viewport observers.
- `apps/web/src/styles.css`
  - Landed seam: `styles.css` is now an import hub over `styles/tokens.css`, `styles/rail.css`, `styles/stage.css`, `styles/sidepanel.css`, and `styles/dialogs-novnc.css`.
  - Next extraction target: keep feature-local rules moving closer to the components that own them if additional UI work grows those files again.
- `apps/control/src/ubuntu-guest-init.ts`
  - Target seam: template-init scripts, desktop repair scripts, wallpaper/bootstrap helpers, and guest command snippets.
