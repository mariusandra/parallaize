# Incus Storage Benchmarks

This note captures the practical storage and cloning results from the live Parallaize host on 2026-03-28 so they do not stay trapped in shell history.

## Short version

- `disk` is the Incus device type for the root disk. It is not the storage backend.
- The original slow backend here was the `default` storage pool with the `dir` driver.
- The host was migrated to a thin-LVM pool named `parallaize-lvm`.
- For fast local fan-out, clone from a snapshot on `parallaize-lvm`.
- `publish` is much slower than direct clone and should be treated as an image-export step, not the hot path for repeated local clones.

## Current host state

- Incus version: `6.22`
- Current fast pool: `parallaize-lvm`
- Driver: `lvm`
- Thin pool mode: enabled
- Default profile root pool: `parallaize-lvm`
- Old pool: `default`
- Old driver: `dir`
- `default` is now unused

## Storage driver learning

For this host and workload, thin-LVM was the best fit.

- `dir` works, but clone and snapshot operations are materially slower.
- `lvm` with thin provisioning gives fast local clones and snapshots for VMs.
- `zfs` is also a valid high-performance option, but it was not the path used on this machine.
- `btrfs` was not chosen for VM storage here.

## Measured timings

These numbers came from direct local tests on this host.

### `dir` versus thin-LVM

| Operation | `dir` | `lvm` thin | Result |
| --- | ---: | ---: | --- |
| Warm `incus init` from local VM image | `10.06s` | `1.18s` | about `8.5x` faster on thin-LVM |
| `incus snapshot create` | `2.93s` | `0.95s` | about `3.1x` faster on thin-LVM |
| `incus copy` from snapshot | `2.40s` | `1.07s` | about `2.3x` faster on thin-LVM |
| First cold `incus init` | `9.61s` | `7.48s` | about `1.3x` faster on thin-LVM |

### Same-pool clone timings on `parallaize-lvm`

These were measured after the migration, using a throwaway VM on the new pool.

| Operation | Time | Notes |
| --- | ---: | --- |
| `incus init <cached-image> <vm> --vm` | `1.24s` | Create a base VM from a locally available image |
| `incus copy <stopped-vm> <new-vm>` | `1.06s` | Fast local clone from a stopped VM |
| `incus snapshot create <vm> clean` | `0.94s` | Fast checkpoint creation |
| `incus copy <vm>/clean <new-vm>` | `1.03s` | Fast local clone from a snapshot |
| `incus publish <vm>/clean --alias <alias>` | `101.12s` | Slow path; generates an image artifact |
| `incus init <alias> <new-vm> --vm` | `28.10s` | Much slower than direct clone |

## What is fastest

For repeated local provisioning on this host, the ranking is:

1. Clone from a snapshot on `parallaize-lvm`
2. Clone from a stopped VM on `parallaize-lvm`
3. Create from a published image or template alias
4. Clone from a running VM

`1` and `2` are very close in raw speed. Snapshot clone wins overall because it gives a fixed, reproducible base instead of cloning whatever drifted into the current VM.

## Recommended workflow

Keep one golden VM and one named clean snapshot, then clone from that snapshot every time.

```bash
incus snapshot create gold-vm clean --reuse
incus copy gold-vm/clean new-vm
```

This is the fastest repeatable path found on this host.

If you want a quick one-off duplicate of a known stopped VM, this is also fast:

```bash
incus copy gold-vm new-vm
```

If you need a portable image or a reusable captured template artifact, use `publish`, but expect it to be much slower:

```bash
incus publish gold-vm/clean --alias gold-template --reuse
incus init gold-template new-vm --vm
```

## Guidance for running VMs

Do not treat a running VM as the fast path for provisioning.

- Same-host live cloning of a running VM was not the recommended hot path here.
- Live migration exists for VMs, but that is about moving running VMs, not about the fastest local fan-out workflow.
- If you need a precise point-in-time base, create a snapshot first and clone from that snapshot.
- If you need guest RAM state as well, use a stateful snapshot only when you specifically need that behavior.

## Practical conclusion

The best local Parallaize template pipeline on this machine is:

1. Keep the master VM on `parallaize-lvm`
2. Stop it or otherwise put it in the exact state you want
3. Refresh a single known-good snapshot
4. Clone from that snapshot for every new workspace
5. Only `publish` when you actually need an image artifact or want to preserve a template outside the direct clone path

## Operational footnote

During this work, broken backup requests from 2026-03-26 left stale Incus background operations behind.

- `incus operation delete` could not remove them because Incus marked them `may_cancel: false`.
- The persistent rows had to be removed from the global `operations` table.
- `incusd` then had to be restarted to flush the daemon's in-memory operation set.

That cleanup path is a last resort and should only be used after confirming there is no live backup process still running.
