# Refactor Map

Last updated: 2026-03-29

This note is the current architecture map for the refactor program. It describes the dependency direction we want to keep, the main runtime flows that exist today, the largest ownership seams, and the first split targets.

## Dependency Direction

Target direction:

1. `packages/shared`: stable contracts, helpers, and types with no Node, React, or app-runtime imports.
2. Pure feature logic inside each runtime: selectors, formatters, validation, and state-shaping helpers that should only depend on shared contracts plus same-runtime pure modules.
3. Runtime adapters at the edge:
   - `apps/control/src/providers.ts`, `apps/control/src/store.ts`, `apps/control/src/network.ts`, `apps/control/src/config.ts`
   - browser-only hooks and transport adapters such as `apps/web/src/NoVncViewport.tsx`, `apps/web/src/desktopResolution.ts`, and storage/document helpers inside the dashboard
4. Composition roots and entrypoints only:
   - `apps/control/src/server.ts`
   - `apps/web/src/main.tsx`
   - CLI and build entrypoints under `scripts/`

Current enforcement:

- `tests/layering.test.ts` blocks web-to-control imports, control-to-web imports, and Node/React imports from `packages/shared`.
- `tests/layering.test.ts` also keeps `dashboardTransport.ts` and `dashboardFullscreen.ts` React-free, keeps `store-normalize.ts` free of Node/pg adapters, and prevents cross-pollination between the JSON and PostgreSQL persistence backends.

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

- `DashboardApp.tsx` -> browser APIs, dashboard transport/fullscreen services, desktop helpers, noVNC adapter, and shared contracts.
- `server.ts` -> config/store/provider/manager/network bridge plus auth/session, route modules, event-stream service, and release-cache wiring.
- `manager.ts` -> shared helpers/contracts, provider interface, state store, and template-default helpers.
- `providers.ts` -> shared helpers/contracts, guest bootstrap scripts, Incus CLI, sockets, and host probes.
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

`apps/control/src/manager.ts` currently mixes these groups:

- Dashboard reads:
  - `getProviderState()`
  - `getSummary()`
  - `getVmDetail()`
  - `getVmFrame()`
- Guest inspection reads:
  - `getVmLogs()`
  - `browseVmFiles()`
  - `readVmFile()`
  - `getVmTouchedFiles()`
  - `getVmDiskUsage()`
- VM lifecycle:
  - `createVm()`
  - `cloneVm()`
  - `startVm()`
  - `stopVm()`
  - `restartVm()`
  - `deleteVm()`
  - `resizeVm()`
  - `updateVm()`
  - `reorderVms()`
- Snapshot lifecycle:
  - `snapshotVm()`
  - `launchVmFromSnapshot()`
  - `restoreVmSnapshot()`
- Template lifecycle:
  - `captureTemplate()`
  - `createTemplate()`
  - `updateTemplate()`
  - `deleteTemplate()`
- Commands, networking, and resolution:
  - `injectCommand()`
  - `setVmResolution()`
  - `setVmNetworkMode()`
  - `updateVmForwardedPorts()`
- Background orchestration:
  - job queueing and reporting
  - failed/interrupted job recovery
  - provider-state sync
  - session refresh loop
  - host and VM telemetry sampling

## Provider Surface Inventory

`apps/control/src/providers.ts` currently covers two implementations behind one interface:

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

`apps/web/src/DashboardApp.tsx` currently owns these feature areas in one file:

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
  - create, clone VM, rename, template clone, template edit, VM logs
- Browser-only persistence:
  - localStorage-backed rail width, sidepanel width, live preview preference, overview collapse, CPU thresholds, and resolution preferences
- Browser-only event plumbing:
  - summary SSE stream
  - live VM log SSE stream
  - storage and visibility events

## Ownership Boundaries To Keep

- Persisted state normalization belongs in `apps/control/src/store-normalize.ts` and future persistence-focused helpers. Callers should consume normalized state, not replicate migration rules.
- Persistence adapters belong in `apps/control/src/store-json.ts` and `apps/control/src/store-postgres.ts`. Callers should stay on the `StateStore` interface exported by `apps/control/src/store.ts`.
- Raw Incus CLI details belong in `apps/control/src/providers.ts` and future Incus-only submodules. `manager.ts`, `server.ts`, and `packages/shared` should only depend on provider contracts and provider state.
- Browser-only storage, DOM, fullscreen, and visibility APIs belong in the web app only. Shared contracts and control-plane code should not know about them.
- Browser fetch/SSE transport details belong in `apps/web/src/dashboardTransport.ts`, and fullscreen coordination belongs in `apps/web/src/dashboardFullscreen.ts`, not in shared contracts or control-plane code.

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

## Success Metrics

- Hotspot files move below rough budgets:
  - `DashboardApp.tsx` under 3k LOC
  - `providers.ts` under 2.5k LOC
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
  - Target seam: dashboard read models, VM lifecycle commands, template/snapshot lifecycle, job orchestration, and session-refresh workers.
- `apps/control/src/providers.ts`
  - Target seam: provider interface, mock provider, Incus lifecycle, Incus guest inspection, Incus network/ACL management, and command/streaming helpers.
- `apps/control/src/store.ts`
  - Landed seam: `store.ts` facade over store interface, JSON backend, PostgreSQL backend, and normalization/migration helpers.
- `apps/web/src/DashboardApp.tsx`
  - Landed seam: dashboard transport/fullscreen services extracted.
  - Next extraction target: app-shell state, workspace stage, dialogs, sidepanel features, and browser-persistence/resolution-control hooks.
- `apps/web/src/NoVncViewport.tsx`
  - Target seam: noVNC loader, connection-state reducer, clipboard helpers, and viewport observers.
- `apps/web/src/styles.css`
  - Target seam: tokens, shell layout, workspace layout, dialog styles, sidepanel styles, and feature-local styles.
- `apps/control/src/ubuntu-guest-init.ts`
  - Target seam: template-init scripts, desktop repair scripts, wallpaper/bootstrap helpers, and guest command snippets.
