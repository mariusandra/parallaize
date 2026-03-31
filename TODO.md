# Parallaize TODO

Last updated: 2026-03-31

This file tracks unresolved work only. Shipped behavior belongs in docs and git history.

Current focus: Selkies now ships as the default desktop path for newly created Incus VMs, with live guest bootstrap keeping launches aligned to the selected base image instead of publishing derived prepared images, periodic maintenance refreshes repairing already-running browser desktops, aggressive bridge repair clearing stale GNOME monitor layouts that older guests can accumulate, dashboard recovery controls exposing manual kick, reload, and bridge-repair actions alongside automatic browser-to-guest repair escalation for stubborn stream stalls, and a guest-originated WebSocket stream-health heartbeat now feeding automatic background bridge repair when the guest runtime itself degrades. Keep the dual-transport control-plane and dashboard slices green while the remaining warm-boot issues are measured and the strengthened Chromium/Playwright browser coverage stays reliable around create, sidebar preview, session resume, and same-VM tab handoff paths.

The Blocks 1-4 cleanup details now live in `docs/refactor-map.md` and the surrounding tests/docs. Only deferred work remains here.

Completed implementation details now live in:

- `docs/live-incus-setup.md`
- `docs/incus-storage-benchmarks.md`
- `docs/template-prep.md`
- `docs/postgres-operations.md`
- `docs/packaging.md`
- `docs/apt-repository.md`
- `docs/refactor-map.md`

## Deferred Until Next Slice

- [ ] Run side-by-side live benchmarks for create, start, clone, and snapshot-launch flows using `desktopReadyMs`, then publish the Selkies vs VNC delta in docs.
- [ ] Publish a tested production TURN deployment recipe and live validation flow for Selkies remote access now that host-to-guest relay env plumbing exists.
- [ ] Add to the installation instructions how to get incus running on a macos; brew install colima; colima start --runtime incus
- [ ] When the user starts incus with the "dir" mode, guide them to enable lvm thin single-file mode. say what commands to run and what to add to the env file. Show this in the middle panel
- [ ] Add a little "reload" icon to the end of the "name" textfield when adding a new vm. This would generate a new random name (and background image string)
