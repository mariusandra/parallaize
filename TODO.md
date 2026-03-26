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
- [x] Run live `pnpm smoke:incus` against PostgreSQL-backed state and capture any host-specific fixes or recovery steps.
- [x] Replace the in-memory admin session token set with server-side sessions that have expiry, rotation, and a documented restart story.
- [x] Design a DMZ network mode for VMs: guest-initiated traffic should reach the public internet, DNS, DHCP, and package mirrors, but not the host, other guests, or private RFC1918 and ULA networks unless explicitly allowed.
- [x] Validate how the DMZ mode is enforced on real hosts and keep required host-initiated control-plane access working for VNC, guest agent operations, and forwarded services.

Current notes:

- On March 26, 2026, the PostgreSQL-backed live smoke run needed two fixes on this host: `smoke:incus` now sizes the create request from template metadata, and captured-template creates now recover from the newest compatible snapshot when the published `parallaize-template-*` image alias is missing.
- On March 26, 2026, live DMZ validation on `parallaize-vm-0048-ubuntu-agent-forge-01-clone` confirmed the intended guest-side isolation: DNS to `10.36.140.1:53` still worked, while guest TCP to `10.36.140.1:3000` timed out. It also exposed that the legacy managed `parallaize-airgap` ACL on this host still only allowed host TCP ingress to `5900`, which blocks forwarded guest HTTP until a current DMZ re-apply rewrites that ACL.
- The clean packaged `amd64` validation item remains open because the March 26, 2026 live host is still mixed between a manually started Flox `incusd` and distro `incus.socket` on `/var/lib/incus/unix.socket`.

## Next

- [ ] Turn guest and template prep into a repeatable scripted flow or tight checklist instead of relying on scattered bootstrap notes.
- [ ] Tune the default Ubuntu VM desktop defaults during template prep: set the Ubuntu dock on the right, use 32px dock icons, and start each VM with a random wallpaper chosen from the installed Ubuntu wallpaper set.
- [ ] On first boot of the default Ubuntu VM, install `indicator-multiload` via `sudo apt install indicator-multiload` and make sure it starts automatically as part of the default desktop session.
- [ ] Improve template lifecycle ergonomics: clearer provenance, better update and capture flow, and more useful snapshot and note history.
- [ ] Add a UI file browser for the VM, starting at `workspacePath` instead of trying to expose the whole guest filesystem on day one.
- [ ] Add a best-effort "files touched in this session" view. Start with something explainable such as a launch-time manifest plus `mtime` and `ctime` diffs or command-history-aware scans, and be explicit about the limits.
- [ ] Stress PostgreSQL persistence under repeated create, clone, delete, and snapshot churn, not just the happy path.
- [ ] Document PostgreSQL operator recovery more clearly, including backup and export, import and restore, and the singleton-row storage shape.
- [ ] Validate the packaged PostgreSQL deployment path end to end, including install, upgrade, export, restore, and service restart ordering.
- [ ] Add hostname-based forwarded-service routing while keeping the current path-based routing as the low-ops fallback.

## Untrusted AI Workloads

Target slice: run agents against Git-backed codebases inside untrusted worker VMs without giving those guests GitHub logins or push-capable credentials. Start with a trusted collection VM or service that can pull work out of workers, queue it for verification, and only sync approved changes back upstream.

- [ ] Write down the threat model and trust boundaries for this flow: worker VMs are untrusted, they should only get read-only repo access, the collection layer is trusted, and no guest should be able to push directly to the canonical remote.
- [ ] Add repo-source configuration in the UI and API: worker clone URL, optional separate collection push URL, branch or ref to start from, workspace path, and whether collection is enabled for that workspace.
- [ ] Define the first supported collection architecture around a control VM that can SSH into worker VMs and pull Git state or diffs from them while holding the only read-write upstream repo credentials.
- [ ] Automate SSH key and Git identity provisioning for this model: per-worker read-only clone credentials, control-VM access into workers for collection, rotation and revocation, and clear visibility in the UI into which keys and users exist for each workspace.
- [ ] Add a guest-side `Collect` action that only appears when a collection target exists. Pressing it should package the current repo state for handoff instead of attempting an in-guest push.
- [ ] Choose the first collection transport and keep it simple: start with control-VM pull over SSH or `git bundle`, treat each handoff as a reviewable set of Git diffs, and store session metadata so the provenance is obvious.
- [ ] Build a verification queue on the collection side where submitted diffs can be inspected, tested in a clean environment, approved, rejected, or sent back for another agent run.
- [ ] Implement the sync-back step after verification: import approved changes into a trusted clone on the collection side, then push to the configured upstream branch or a staging branch without ever handing write credentials to the worker VM.
- [ ] Support generic Git providers instead of baking this around GitHub login state. Entering the relevant read-only and read-write Git URLs in the UI should be enough to wire up the first version.
- [ ] Document fallback and recovery paths: manual patch or bundle export, abandoned-worker collection, conflict handling when the upstream branch moves, and how to recover if the collection VM is unavailable.

## Later

- [ ] Validate the generated `arm64` `.deb` on a real `arm64` Incus and QEMU host before promoting it beyond experimental.
- [ ] Add package signing once the supported package matrix is stable.
- [ ] Document wildcard DNS and Tailscale expectations for hostname-based forwarded routing.
- [ ] Add some way to monitor actual guest disk usage and surface low-space warnings before the Ubuntu desktop hits "1 GB left" conditions inside the VM.
