# Parallaize TODO

Last updated: 2026-03-28

This file tracks unresolved work only. Shipped behavior belongs in docs and git history.

Current focus: start the first trusted collection flow for untrusted AI workloads.

Completed implementation details now live in:

- `docs/live-incus-setup.md`
- `docs/incus-storage-benchmarks.md`
- `docs/template-prep.md`
- `docs/postgres-operations.md`
- `docs/packaging.md`
- `docs/apt-repository.md`

## Current Slice: Untrusted AI Workloads

Target slice: run agents against Git-backed codebases inside untrusted worker VMs without handing write-capable upstream credentials to those guests.

- [ ] Write down the threat model and trust boundaries: worker VMs are untrusted, workers get read-only repo access, collection is trusted, and only the collection side can push upstream.
- [ ] Add repo-source configuration in the UI and API that stays provider-agnostic: read-only clone URL, optional trusted push URL, branch or ref, workspace path, and whether collection is enabled for that workspace.
- [ ] Define the first collection architecture around a trusted control VM or service that pulls state from workers over SSH or `git bundle` and treats each handoff as a reviewable Git diff.
- [ ] Automate SSH key and Git identity provisioning for that model, including worker read-only clone credentials, trusted collection access into workers, rotation, revocation, and UI visibility into what credentials exist.
- [ ] Add a guest-side `Collect` action that packages the current repo state for handoff instead of attempting an in-guest push.
- [ ] Build the trusted verification and sync-back path: queue submitted diffs, inspect and test them in a clean environment, approve or reject them, then push approved changes from the trusted side only.
- [ ] Document fallback and recovery flows: manual patch or bundle export, abandoned-worker collection, upstream branch drift, conflicts, and collection-service outage handling.
