# Untrusted Collection Model

Last updated: 2026-03-29

This note defines the first trusted collection path for running Git-backed agent work in untrusted worker VMs.

## Threat Model

Trust boundaries:

- Worker VM: untrusted. Assume guest code, agent output, browser session contents, and guest-persisted credentials can all be exfiltrated or modified by the workload.
- Control plane and collection worker: trusted. These components may hold write-capable credentials, perform review, and push upstream.
- Upstream Git remote: trusted destination, but it must never receive direct write credentials inside an untrusted guest.

Goals:

- Workers can clone and inspect repositories.
- Workers can produce reviewable repository state for collection.
- Only the trusted side can push upstream.

Non-goals for the first slice:

- In-guest direct pushes.
- Blind sync from guest to upstream.
- Per-file policy enforcement inside the guest.

## Provider-Agnostic Repo Source Metadata

Parallaize now carries provider-agnostic repo metadata on templates and VMs:

- `readOnlyUrl`: the clone URL safe to hand to untrusted guests
- `trustedPushUrl`: optional URL used only by the trusted collector
- `ref`: branch or ref to clone or review against
- `workspacePath`: intended repository path inside the guest
- `collectionEnabled`: whether this workspace participates in the trusted collection flow

Current product surface:

- Template clone and template edit dialogs can save default repo-source settings.
- Workspace create can override repo-source settings per VM.
- The workspace sidepanel can update repo-source settings for an existing VM.
- Template capture preserves the VM repo-source settings unless a later update replaces them.

## First Collection Architecture

The first collection model should stay deliberately conservative:

1. Worker VM clones the repository from `readOnlyUrl`.
2. Guest work happens inside `workspacePath`.
3. When collection is requested, the guest prepares a handoff artifact instead of pushing:
   - preferred: `git bundle`
   - fallback: patch export or reviewed archive
4. A trusted collector pulls that artifact over an authenticated channel, ideally SSH from collector to worker.
5. The collector materializes the candidate diff in a clean trusted workspace.
6. The collector runs validation:
   - git integrity checks
   - merge-base and drift checks against the target ref
   - repo-specific build/test policy
7. After review and validation, only the collector pushes to `trustedPushUrl`.

This keeps the untrusted guest out of the write path while still letting the product present a single workspace-oriented flow.

## Credentials And Identity

Credential model:

- Worker guest receives only read-only clone credentials.
- Trusted collector holds write-capable upstream credentials.
- Collector-to-worker access should be separate from upstream write identity.

Operational expectations:

- Generate distinct SSH keys for worker clone access and trusted collection access.
- Surface which credentials exist in the UI and persistence state, including whether collection is enabled.
- Support rotation and revocation without rebuilding templates.
- Never reuse upstream push keys inside worker guests.

## Guest-Side Collect Action

The first guest-facing action should be `Collect`, not `Push`.

Expected behavior:

- verify that repo-source metadata exists and collection is enabled
- confirm the target `workspacePath`
- create a reviewable handoff artifact
- record artifact metadata in job output and activity logs
- hand control back to the trusted collector for validation and sync

## Trusted Validation And Sync-Back

The trusted side should own these steps:

- queue collection submissions
- fetch or pull the guest artifact
- reconstruct a candidate branch in a clean trusted workspace
- inspect diff, status, and branch drift
- run repo policy checks
- mark the submission approved or rejected
- push approved state upstream from the trusted side only

If policy checks fail, the trusted side should keep the artifact for inspection instead of discarding it immediately.

## Fallback And Recovery

Minimum fallback paths to support:

- manual patch export when bundle generation fails
- manual collection from an abandoned worker disk or snapshot
- upstream branch drift detected after guest work started
- rejected collection with a preserved artifact for local inspection
- collection-worker outage, where the UI can still export bundle or patch artifacts for manual trusted review
