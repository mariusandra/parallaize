# Parallaize POC TODO

Last updated: 2026-03-21
Current phase: Real Incus-backed browser VNC sessions, Caddy guest-service forwarding, and host bridge internet access are validated; remaining work is codifying the guest VNC bootstrap, browser-session polish, persistence hardening, automation, and template polish

## Mission

Build a server-first full stack TypeScript app that lets one operator run many isolated Ubuntu desktop VMs on a powerful Linux host, see them as a live grid, open any VM in the browser, and manage clone / kill / snapshot / resource-limit actions from one UI.

The Electron app is explicitly out of scope until the web proof of concept works.

## Current Repo Status

- A runnable end-to-end web POC now exists in this repo.
- The delivered POC uses a `mock` provider by default and persists state to `data/state.json`.
- The dashboard now runs as a React + Tailwind frontend served by the Node control plane.
- The dashboard, API, job flow, template capture, resource editing, and Caddy front-door config are implemented.
- The dashboard UI now also ships a tighter split-screen shell with a collapsible VM rail, live thumbnail previews for reachable VNC guests, a fullscreen browser desktop stage, and a light/dark mode toggle.
- Template capture now supports updating an existing template while preserving linked snapshot history.
- The control plane now contains a real Incus CLI-backed provider, template launch-source tracking, embedded noVNC browser transport, and configurable guest-service forwarding.
- The control plane now supports a shared single-admin browser session flow with Basic Auth fallback when admin credentials are supplied through env vars.
- This machine now has `incus`, `incusd`, `attr`, and `qemu_kvm` available through the repo Flox environment.
- This host also needed the Ubuntu system packages `attr`, `ovmf`, `qemu-system-x86`, and `qemu-utils` for a VM-capable Incus runtime.
- The Incus daemon is now initialized, reachable from the dashboard user via `/var/lib/incus/unix.socket`, and the provider card can report `ready` in the browser.
- A manual `incus launch images:ubuntu/noble/desktop --vm` probe succeeded on this host, then was deleted after validation.
- Host validation also exposed an IPv6-only guest path, so the provider now falls back to a global IPv6 address when no global IPv4 address is present.
- Real-host validation now covers a captured template image, guest VNC reachability, browser noVNC sessions, and Caddy-backed guest-service forwarding.
- The built-in VNC WebSocket bridge now preserves raw binary RFB traffic, and the automated test suite includes a byte-for-byte bridge regression test.
- Live host validation now confirms `vm-0003` completes a real RFB handshake through both `ws://:3000/api/vms/vm-0003/vnc` and Caddy's `ws://:8080/api/vms/vm-0003/vnc` once the guest advertises x11vnc on IPv6-safe port `5901`.
- Browser-level validation now confirms a real Chromium session reaches `Desktop connected.` through the same-origin Caddy bridge at `http://monster:8080/?vm=vm-0003`, and the frontend no longer falls back to a direct control-plane websocket on `:3000`.
- An automated `pnpm smoke:incus` path now validates create -> VNC ready -> guest HTTP injection -> restart -> Caddy forward -> cleanup on the live host.
- This host's UFW default-drop policy also needed explicit `incusbr0` DHCP, DNS, and forward allowances before guests would receive IPv4 leases and regain outbound internet access.

## Working Rules

- Keep this file current as tasks are completed or scope changes.
- After each code change, and again at the end of every TODO run, restart the server in real mode (`PARALLAIZE_PROVIDER=incus`) with an Incus-backed state file and confirm it boots before considering the task complete.
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
- [x] Add a local dev stack definition for PostgreSQL
- [x] Add a `README.md` with local setup and project goals

Exit criteria:

- Repo has a clean baseline structure and one command for build + typecheck.

### Phase 1: Host Integration Spike

- [x] Install and configure Incus on the target host
- [x] Create a reusable Ubuntu desktop base image
- [x] Validate manual create / stop / delete / snapshot / clone flows
- [x] Validate CPU, RAM, and disk limits can be set and changed
- [x] Validate a guest VNC server can be reached from the host
- [x] Document exact host commands and assumptions

Exit criteria:

- The host can run multiple desktop VMs manually and expose each one over VNC.

### Phase 2: Control Plane Backend

- [x] Build persisted state models for templates, VMs, snapshots, and jobs
- [x] Add a provider boundary with `mock` and `incus` modes
- [x] Implement real Incus lifecycle and snapshot operations
- [x] Implement real VNC session provisioning metadata
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
- [x] Replace the synthetic detail view with an embedded noVNC session
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
- [x] Extend Caddy config for future VNC websocket routes
- [x] Add production env configuration
- [x] Add systemd or container-based service definitions for the app services
- [x] Document local run and proxy steps in `README.md`

Exit criteria:

- The stack can be started on the server and accessed through one Caddy-managed entrypoint.

## Immediate Next Tasks

These are the next tasks an agent should actually execute in order:

1. Run a live browser interaction pass against a host-backed VM now that the built-in VNC bridge preserves raw binary RFB traffic end to end.
2. Replace JSON persistence with PostgreSQL once the host-backed adapter shape is stable.
3. Audit seeded templates and docs against the current guest-service preset policy so the image/bootstrap split stays explicit.
4. Clean up probe and validation VMs, then tighten template capture/update ergonomics around the validated image path.
5. Evaluate whether the new cookie-backed single-admin session flow needs expiry/rotation refinements beyond the initial browser-login pass.

## Risks And Watchouts

- Live thumbnails for many VMs may be expensive. Start simple and measure before optimizing.
- Desktop VM boot times may be slow. Base-image and snapshot strategy will matter.
- Disk resizing semantics may differ from CPU/RAM changes and may require guest-side handling.
- VNC in the guest is acceptable for the POC, but not automatically the long-term production answer.
- ZFS should be preferred for clone/snapshot performance, but only if the host is already suitable for it.

## Open Questions

- Will the target host use ZFS already, or do we need a btrfs-based fallback from day one?
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
- 2026-03-21: Implemented a real Incus CLI-backed provider for lifecycle, snapshot, template publish, and guest command execution while keeping synthetic rendering until noVNC is wired in.
- 2026-03-21: Changed templates to track a real launch source and VMs to track provider references plus VNC session metadata so captured templates can boot from published images later.
- 2026-03-21: Added `incus` to the repo Flox environment so the project now ships both `incus` and `incusd` binaries locally.
- 2026-03-21: Promoted provider state to a live host-readiness model and surfaced Incus binary, transport, session, and next-step diagnostics directly in the React dashboard.
- 2026-03-21: Bootstrapped a working local Incus daemon by combining the Flox-provided `incusd` binary with Ubuntu host packages for firmware and QEMU tooling.
- 2026-03-21: Validated the first manual Ubuntu VM launch on this host and updated the provider session resolver to fall back to IPv6 guest addresses when IPv4 is absent.
- 2026-03-21: Replaced the synthetic detail pane with an embedded noVNC client backed by a built-in WebSocket-to-TCP bridge in the Node control plane.
- 2026-03-21: Added per-VM forwarded guest-service routes so Caddy can front guest HTTP/WebSocket apps through `/vm/:id/forwards/:forwardId/`.
- 2026-03-21: Simplified the operator dashboard around the real session view, forward configuration, command console, and core lifecycle controls.
- 2026-03-21: Added deployment scaffolding for Caddy, systemd, env files, and a local PostgreSQL dev stack while keeping JSON persistence as the active store.
- 2026-03-21: Reworked the web build to emit a browser-safe bundled noVNC asset after patching the upstream package's top-level-await issue during build time.
- 2026-03-21: Captured a reusable Incus image alias with a resilient guest `x11vnc` service, then validated fresh VM browser VNC sessions and Caddy-backed guest-service forwarding on the live host.
- 2026-03-21: Added a host-backed `pnpm smoke:incus` automation path that provisions a throwaway VM, verifies browser VNC, injects a guest HTTP service, validates Caddy forwarding, and cleans the VM up afterward.
- 2026-03-21: Added shared single-user Basic Auth at the control plane so the dashboard, API, VNC bridge, SSE stream, and forwarded guest-service routes can be protected with env-configured admin credentials.
- 2026-03-21: Hardened the built-in VNC bridge to keep raw WebSocket-to-TCP traffic in Buffer mode and added a regression test that verifies byte-for-byte passthrough in both directions.
- 2026-03-21: Verified that this host's Incus bridge was healthy but UFW was dropping guest DHCP, DNS, and forwarded traffic; added the required `incusbr0` UFW allowances so new VM boots now receive IPv4 leases and outbound internet access.
- 2026-03-21: Replaced the browser-facing Basic Auth challenge with a cookie-backed single-admin login flow while keeping Basic Auth header support for CLI clients and smoke automation.
- 2026-03-21: Decided that template images should only ship the core desktop and VNC bootstrap; workload-specific guest services remain forwarded-port defaults captured on templates instead of being baked into the base image.
- 2026-03-21: Added a standing working rule to boot the control plane in real Incus mode after each change so host-backed regressions surface immediately.
