# Parallaize POC TODO

Last updated: 2026-03-21
Current phase: React/Tailwind dashboard delivered; real host integration next

## Mission

Build a server-first full stack TypeScript app that lets one operator run many isolated Ubuntu desktop VMs on a powerful Linux host, see them as a live grid, open any VM in the browser, and manage clone / kill / snapshot / resource-limit actions from one UI.

The Electron app is explicitly out of scope until the web proof of concept works.

## Current Repo Status

- A runnable end-to-end web POC now exists in this repo.
- The delivered POC uses a `mock` provider by default and persists state to `data/state.json`.
- The dashboard now runs as a React + Tailwind frontend served by the Node control plane.
- The dashboard, API, job flow, template capture, resource editing, and Caddy front-door config are implemented.
- Template capture now supports updating an existing template while preserving linked snapshot history.
- The remaining gap to the original vision is real Incus-backed VM lifecycle execution and real browser desktop sessions.

## Working Rules

- Keep this file current as tasks are completed or scope changes.
- Build the smallest vertical slice first: create VM -> view desktop -> control VM -> clone VM.
- Prefer one host and one operator for the POC. Do not design for clustering yet.
- Make infrastructure decisions that preserve a path to a richer version later, but do not overbuild now.
- Record any meaningful architecture change in the Decision Log section before moving on.

## POC Definition Of Done

The proof of concept is done when all of the following are true:

- A browser UI shows a grid of running desktop environments.
- The user can create a new desktop from a saved environment template.
- The user can open a desktop in the browser and interact with it.
- The user can clone, stop, delete, and snapshot a running desktop.
- CPU, RAM, and disk limits are configurable per VM and editable later.
- Environment templates can be created from a configured VM without destroying the original template history.
- The whole stack runs behind Caddy on a single Linux server.

## Scope

### In Scope For The First POC

- Server-hosted web app only
- Full VM isolation for desktops
- Ubuntu desktop guest image
- Live grid view
- Interactive browser session per VM
- Template and snapshot management
- Per-VM resource controls
- Basic persistence for metadata and state
- One-user admin authentication

### Out Of Scope For Now

- Electron packaging
- Multi-node orchestration
- Team / multi-tenant auth
- Billing, quotas, or usage accounting
- GPU scheduling
- External file mutation tooling
- Periodic script execution inside VMs

## Technical Direction

### Core Decisions

- VM manager: Incus
- VM type: full VMs, not containers
- Reverse proxy and TLS: Caddy
- Primary host filesystem: ZFS-backed Incus storage pool if available
- Fallback storage: btrfs only if ZFS is not practical on the target machine
- Guest OS baseline: Ubuntu Desktop image

### App Shape

- Apps-and-packages TypeScript repo layout
- `apps/web`: dashboard UI
- `apps/control`: API for VM, template, and session orchestration
- `packages/shared`: shared types and helpers
- `tests`: mock-provider verification
- Current persistence: JSON file for the proof of concept
- Planned persistence upgrade: PostgreSQL after real host integration starts

### Remote Desktop Decision

Guacamole is still worth evaluating, but it is not the shortest path to the first vertical slice.

Working decision for the POC:

- The current repo ships synthetic SVG desktop frames for the mock provider.
- Replace synthetic frames with guest VNC + noVNC/websockify when Incus integration starts.
- Revisit Apache Guacamole after the first real VM slice is working.

Reasoning:

- noVNC is easier to embed directly into a custom grid and detail view.
- Per-tile live canvases are straightforward for a first implementation.
- Guacamole becomes more attractive later if protocol brokering, recording, or stronger session mediation becomes important.

## Data Model To Implement

- `EnvironmentTemplate`
  - immutable snapshot reference
  - display name
  - description
  - default CPU / RAM / disk settings
  - guest setup notes
- `VmInstance`
  - template id
  - instance name
  - lifecycle state
  - CPU / RAM / disk limits
  - VNC connection info
  - created at / updated at
- `Snapshot`
  - VM id
  - source template id
  - storage reference
  - label
  - created at
- `ActionJob`
  - type: create / clone / start / stop / delete / snapshot / resize
  - target id
  - queued / running / success / failed
  - logs / error payload

## Execution Plan

### Phase 0: Repo Bootstrap

- [x] Convert raw notes into a structured, agent-friendly execution plan
- [x] Create an apps/packages TypeScript repo layout
- [x] Add `flox` + `pnpm` local environment control and typecheck/build scripts
- [ ] Add a local dev stack definition for PostgreSQL
- [x] Add a `README.md` with local setup and project goals

Exit criteria:

- Repo has a clean baseline structure and one command for build + typecheck.

### Phase 1: Host Integration Spike

- [ ] Install and configure Incus on the target host
- [ ] Create a reusable Ubuntu desktop base image
- [ ] Validate manual create / stop / delete / snapshot / clone flows
- [ ] Validate CPU, RAM, and disk limits can be set and changed
- [ ] Validate a guest VNC server can be reached from the host
- [ ] Document exact host commands and assumptions

Exit criteria:

- The host can run multiple desktop VMs manually and expose each one over VNC.

### Phase 2: Control Plane Backend

- [x] Build persisted state models for templates, VMs, snapshots, and jobs
- [x] Add a provider boundary with `mock` and `incus` modes
- [ ] Implement real Incus lifecycle and snapshot operations
- [ ] Implement real VNC session provisioning metadata
- [x] Add job execution for long-running actions
- [x] Add API endpoints for create, list, clone, stop, delete, snapshot, resize, template capture, and command injection
- [x] Add server-side validation for CPU, RAM, and disk inputs
- [ ] Replace JSON persistence with PostgreSQL

Exit criteria:

- The backend can manage VM lifecycle operations through an API with persisted state.

### Phase 3: Web Dashboard

- [x] Build the root grid page for VM tiles
- [x] Show per-tile status, template name, and resource settings
- [x] Add create, clone, stop, delete, and snapshot controls
- [x] Add a detail overlay with a live synthetic desktop view for the current POC
- [x] Migrate the dashboard frontend to React + Tailwind while keeping the existing API and SSE flow
- [ ] Replace the synthetic detail view with an embedded noVNC session
- [x] Add live status updates from the backend

Exit criteria:

- A user can manage and open desktops entirely through the browser UI.

### Phase 4: Environment Templates

- [x] Surface templates in the dashboard UI
- [x] Allow creating a template from a configured VM
- [x] Preserve snapshot history when a template is updated
- [x] Allow launching a VM from any saved template

Exit criteria:

- Templates are reusable, versioned enough for rollback, and visible in the UI.

### Phase 5: Reverse Proxy And Deployment

- [x] Put Caddy in front of the web app for local/proxy use
- [ ] Extend Caddy config for future VNC websocket routes
- [ ] Add production env configuration
- [ ] Add systemd or container-based service definitions for the app services
- [x] Document local run and proxy steps in `README.md`

Exit criteria:

- The stack can be started on the server and accessed through one Caddy-managed entrypoint.

## Immediate Next Tasks

These are the next tasks an agent should actually execute in order:

1. Install and validate Incus on the target host.
2. Create the first Ubuntu desktop base image and document the exact host commands.
3. Replace the mock provider lifecycle methods with real Incus-backed create/clone/start/stop/delete/snapshot operations.
4. Replace synthetic desktop frames with real guest VNC + noVNC/websockify transport.
5. Replace JSON persistence with PostgreSQL once the real host adapter shape is stable.

## Risks And Watchouts

- Live thumbnails for many VMs may be expensive. Start simple and measure before optimizing.
- Desktop VM boot times may be slow. Base-image and snapshot strategy will matter.
- Disk resizing semantics may differ from CPU/RAM changes and may require guest-side handling.
- VNC in the guest is acceptable for the POC, but not automatically the long-term production answer.
- ZFS should be preferred for clone/snapshot performance, but only if the host is already suitable for it.

## Open Questions

- Will the target host use ZFS already, or do we need a btrfs-based fallback from day one?
- Should the first auth layer be single shared admin auth or local-user accounts?
- Do we want templates to include startup commands and working-directory defaults immediately, or defer that?
- Is live tile rendering required to be truly continuous, or is a low-frequency refresh acceptable for the first pass?

## Decision Log

- 2026-03-21: Rewrote the original note dump into a structured execution plan.
- 2026-03-21: Set the initial target to a server-first web POC; Electron is deferred.
- 2026-03-21: Chose Incus as the VM manager and full VMs as the isolation boundary.
- 2026-03-21: Chose Caddy as the required front door for the stack.
- 2026-03-21: Chose ZFS-backed Incus storage as the preferred snapshot/clone strategy.
- 2026-03-21: Deferred Apache Guacamole for the first vertical slice; start with noVNC/websockify and revisit later.
- 2026-03-21: Switched local environment control to `flox` + `pnpm`.
- 2026-03-21: Delivered an end-to-end mock-provider POC with persisted state, live dashboard updates, and template capture.
- 2026-03-21: Chose JSON persistence for the first runnable POC and deferred PostgreSQL until the real host adapter is in place.
- 2026-03-21: Rebuilt the dashboard frontend as a bundled React + Tailwind app while preserving the existing Node HTTP server and SSE contract.
- 2026-03-21: Extended template capture so an existing template can be refreshed without losing its linked snapshot history.
