# Parallaize TODO

Last updated: 2026-04-01

This file tracks unresolved work only. Shipped behavior belongs in docs and git history.

Current focus: Selkies now ships as the default desktop path for newly created Incus VMs, with live guest bootstrap keeping launches aligned to the selected base image instead of publishing derived prepared images, periodic maintenance refreshes repairing already-running browser desktops, aggressive bridge repair clearing stale GNOME monitor layouts that older guests can accumulate, dashboard recovery controls exposing manual kick, reload, bridge-repair, and in-place desktop-layer switching actions alongside automatic browser-to-guest repair escalation for stubborn stream stalls, and the desktop transport split now modeled explicitly as Selkies vs shared x11vnc runtimes so running VMs can flip between direct VNC and Guacamole without a guest reboot while Selkies remains a separate guest bridge. Socket desktops now also stay mounted in background stage hosts the same way cached Selkies sessions do, so reopening a VNC or Guacamole VM can swap back instantly without renegotiating or collapsing hidden widths when sidebars move. Keep the three-transport control-plane and dashboard slices green while the remaining warm-boot issues are measured, the new live Chromium restart benchmark stays under the reconnect target, and the strengthened browser coverage stays reliable around create, sidebar preview, session resume, same-VM tab handoff, restart recovery paths, and live transport flips on already-running guests.

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
- [ ] Run one full host reboot validation on the live machine and compare cold restart-to-picture timing against the in-process host-process restart benchmark.
- [ ] Audit all Docker-published ports on the live host and keep `DOCKER-USER` policy aligned with the intended UFW exposure model.
- [ ] Add to the installation instructions how to get incus running on a macos; brew install colima; colima start --runtime incus
- [ ] When the user starts incus with the "dir" mode, guide them to enable lvm thin single-file mode. say what commands to run and what to add to the env file. Show this in the middle panel
- [ ] Add a little "reload" icon to the end of the "name" textfield when adding a new vm. This would generate a new random name (and background image string)
