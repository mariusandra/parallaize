# Parallaize TODO

Last updated: 2026-03-27

This file tracks unresolved work only. Shipped behavior belongs in docs and git history.

Current focus: finish the last live-host packaged validation gaps on clean distro-managed Incus `amd64` and real `arm64` hosts before starting the first trusted collection flow for untrusted AI workloads.

Completed implementation details now live in:

- `docs/live-incus-setup.md`
- `docs/template-prep.md`
- `docs/postgres-operations.md`
- `docs/packaging.md`
- `docs/apt-repository.md`

## Current

- [ ] Repeat the Ubuntu 24.04 `amd64` packaged install validation on a clean distro-managed Incus host and close the remaining daemon-conflict ambiguity before calling that path fully supported.
- [ ] Validate the generated `arm64` `.deb` on a real `arm64` Incus and QEMU host before promoting it beyond experimental.

Validation notes:

- On March 27, 2026, the signed Ubuntu 24.04 `amd64` APT archive path was replayed in a clean Ubuntu 24.04 `amd64` container: initial key bootstrap succeeded, `apt-get install parallaize` installed `0.1.10-1`, and `apt-get install --only-upgrade parallaize` upgraded the same host to `0.1.10-2`.
- On March 27, 2026, the packaged PostgreSQL deployment path was replayed in a clean Ubuntu 24.04 `amd64` container using the packaged env file plus the packaged `parallaize`, `parallaize-persistence`, and Caddy launchers: health stayed `ok`, export/import worked, an upgrade to `0.1.10-3` succeeded, and restoring the baseline export brought VM count back from 2 to 1.

Open validation note:

- The March 26, 2026 live packaged-host run still cannot close the support claim by itself because that machine was mixed between a manually started Flox `incusd` and distro `incus.socket` on `/var/lib/incus/unix.socket`.

## Next Slice: Untrusted AI Workloads

Target slice: run agents against Git-backed codebases inside untrusted worker VMs without handing write-capable upstream credentials to those guests.

- [ ] Write down the threat model and trust boundaries: worker VMs are untrusted, workers get read-only repo access, collection is trusted, and only the collection side can push upstream.
- [ ] Add repo-source configuration in the UI and API that stays provider-agnostic: read-only clone URL, optional trusted push URL, branch or ref, workspace path, and whether collection is enabled for that workspace.
- [ ] Define the first collection architecture around a trusted control VM or service that pulls state from workers over SSH or `git bundle` and treats each handoff as a reviewable Git diff.
- [ ] Automate SSH key and Git identity provisioning for that model, including worker read-only clone credentials, trusted collection access into workers, rotation, revocation, and UI visibility into what credentials exist.
- [ ] Add a guest-side `Collect` action that packages the current repo state for handoff instead of attempting an in-guest push.
- [ ] Build the trusted verification and sync-back path: queue submitted diffs, inspect and test them in a clean environment, approve or reject them, then push approved changes from the trusted side only.
- [ ] Document fallback and recovery flows: manual patch or bundle export, abandoned-worker collection, upstream branch drift, conflicts, and collection-service outage handling.
