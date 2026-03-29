# Parallaize TODO

Last updated: 2026-03-29

This file tracks unresolved work only. Shipped behavior belongs in docs and git history.

Current focus: the maintainability cleanup slice is complete. Keep the extracted control-plane seams, dashboard seams, and package-asset generation green while the next feature slice is scoped.

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

- [ ] Resume the trusted/untrusted collection architecture only after the control plane and dashboard seams above are smaller and better tested.
- [ ] Evaluate Selkies as an alternative browser desktop transport once the current runtime boundaries are cleaner.
