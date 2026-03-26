# Parallaize TODO

Last updated: 2026-03-26

This file is intentionally future-facing. Shipped work belongs in docs and git history, not in a growing done list here.

Current focus: close the remaining deployment-validation gaps, harden security and isolation, and add better guest introspection from the UI.

## Already Solid Enough To Stop Re-Tracking

- Incus-backed VM lifecycle, template capture and clone, snapshots, and browser VNC sessions work end to end.
- Forwarded guest HTTP and WebSocket services, guest command execution, live logs, and single-admin cookie auth are already in place.
- JSON and PostgreSQL persistence both exist, and packaged Ubuntu `.deb` builds now cover `amd64` plus experimental `arm64`.

## Now

- [ ] Repeat the Ubuntu 24.04 `amd64` packaged install validation on a clean distro-managed Incus host and close the remaining daemon-conflict ambiguity before calling that path fully supported.
- [ ] Run live `pnpm smoke:incus` against PostgreSQL-backed state and capture any host-specific fixes or recovery steps.
- [ ] Replace the in-memory admin session token set with server-side sessions that have expiry, rotation, and a documented restart story.
- [ ] Design a DMZ network mode for VMs: guest-initiated traffic should reach the public internet, DNS, DHCP, and package mirrors, but not the host, other guests, or private RFC1918 and ULA networks unless explicitly allowed.
- [ ] Validate how the DMZ mode is enforced on real hosts and keep required host-initiated control-plane access working for VNC, guest agent operations, and forwarded services.

## Next

- [ ] Turn guest and template prep into a repeatable scripted flow or tight checklist instead of relying on scattered bootstrap notes.
- [ ] Improve template lifecycle ergonomics: clearer provenance, better update and capture flow, and more useful snapshot and note history.
- [ ] Add a UI file browser for the VM, starting at `workspacePath` instead of trying to expose the whole guest filesystem on day one.
- [ ] Add a best-effort "files touched in this session" view. Start with something explainable such as a launch-time manifest plus `mtime` and `ctime` diffs or command-history-aware scans, and be explicit about the limits.
- [ ] Stress PostgreSQL persistence under repeated create, clone, delete, and snapshot churn, not just the happy path.
- [ ] Document PostgreSQL operator recovery more clearly, including backup and export, import and restore, and the singleton-row storage shape.
- [ ] Validate the packaged PostgreSQL deployment path end to end, including install, upgrade, export, restore, and service restart ordering.
- [ ] Add hostname-based forwarded-service routing while keeping the current path-based routing as the low-ops fallback.

## Later

- [ ] Validate the generated `arm64` `.deb` on a real `arm64` Incus and QEMU host before promoting it beyond experimental.
- [ ] Add package signing once the supported package matrix is stable.
- [ ] Document wildcard DNS and Tailscale expectations for hostname-based forwarded routing.
