import type { ChangeEvent, FormEvent, JSX } from "react";

import { formatRam, formatResources, formatTimestamp } from "../../../packages/shared/src/helpers.js";
import type { EnvironmentTemplate, VmLogsSnapshot } from "../../../packages/shared/src/types.js";

import type {
  CreateDraft,
  CreateSourceGroup,
  CreateSourceSelection,
  TemplateCloneDraft,
  TemplateEditDraft,
} from "./dashboardHelpers.js";
import { createSourceSupportsDesktopTransportChoice } from "./dashboardHelpers.js";
import { desktopTransportChoiceLabel, desktopTransportChoices } from "./desktopTransportChoices.js";
import {
  liveCaptureWarningCopy,
  liveCloneWarningCopy,
  type CloneVmDialogState,
  type SnapshotDialogState,
} from "./dashboardShell.js";
import { InlineWarningNote, NumberField } from "./dashboardPrimitives.js";
import { VmLogOutput } from "./dashboardUi.js";

interface CreateVmDialogProps {
  busy: boolean;
  createDraft: CreateDraft;
  selectedSource: CreateSourceSelection | null;
  sourceGroups: CreateSourceGroup[];
  validationError: string | null;
  onClose: () => void;
  onFieldChange: (field: keyof CreateDraft, value: string) => void;
  onShutdownBeforeCloneChange: (checked: boolean) => void;
  onStatefulCloneChange: (checked: boolean) => void;
  onRandomizeName: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSourceChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

interface TemplateCloneDialogProps {
  busy: boolean;
  draft: TemplateCloneDraft;
  sourceTemplate: EnvironmentTemplate | null;
  onClose: () => void;
  onFieldChange: (field: keyof TemplateCloneDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface TemplateEditDialogProps {
  busy: boolean;
  draft: TemplateEditDraft;
  onClose: () => void;
  onFieldChange: (field: keyof TemplateEditDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface CloneVmDialogProps {
  busy: boolean;
  dialog: CloneVmDialogState;
  draft: string;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onStatefulChange: (checked: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface RenameDialogProps {
  busy: boolean;
  currentName: string;
  draft: string;
  entityLabel: string;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface SnapshotDialogProps {
  busy: boolean;
  dialog: SnapshotDialogState;
  onClose: () => void;
  onLabelChange: (value: string) => void;
  onStatefulChange: (checked: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface VmLogsDialogProps {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
  vmName: string;
  onClose: () => void;
  onRefresh: () => void;
}

function RefreshNameIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="M12.75 5.75V3.5h-2.25M3.6 6.2A4.75 4.75 0 0 1 12.75 5.75M3.25 10.25v2.25H5.5m6.9-2.7A4.75 4.75 0 0 1 3.25 10.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

export function RenameDialog({
  busy,
  currentName,
  draft,
  entityLabel,
  onClose,
  onDraftChange,
  onSubmit,
}: RenameDialogProps): JSX.Element {
  const normalizedDraft = draft.trim();
  const unchanged = normalizedDraft.length === 0 || normalizedDraft === currentName;

  return (
    <div
      className="dialog-backdrop"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">{entityLabel}</p>
            <h2 className="dialog-panel__title">Rename {entityLabel.toLowerCase()}</h2>
            <p className="dialog-panel__copy">
              This stays inside the dashboard, so browser fullscreen remains active.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={currentName}
              disabled={busy}
              autoFocus
            />
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || unchanged}
          >
            Save name
          </button>
        </form>
      </section>
    </div>
  );
}

export function VmLogsDialog({
  error,
  loading,
  logs,
  refreshing,
  vmName,
  onClose,
  onRefresh,
}: VmLogsDialogProps): JSX.Element {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel dialog-panel--logs"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Workspace logs</p>
            <h2 className="dialog-panel__title">Logs for {vmName}</h2>
            <p className="dialog-panel__copy">
              Streams {logs?.source ?? "the VM log stream"} live while this modal stays open.
            </p>
          </div>
          <div className="chip-row">
            <button
              className="button button--ghost"
              type="button"
              onClick={onRefresh}
              disabled={loading || refreshing}
            >
              {loading || refreshing ? "Connecting..." : "Reconnect"}
            </button>
            <button className="button button--ghost" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="chip-row vm-logs__meta">
          {logs ? <span className="surface-pill mono-font">{logs.providerRef}</span> : null}
          <span className="surface-pill">{logs?.source ?? "Loading logs..."}</span>
          {logs ? (
            <span className="surface-pill">Updated {formatTimestamp(logs.fetchedAt)}</span>
          ) : null}
        </div>

        {error ? <p className="empty-copy">Live stream issue: {error}</p> : null}
        {loading && !logs ? <p className="empty-copy">Loading logs...</p> : null}

        {logs && logs.content.trim().length > 0 ? (
          <VmLogOutput className="vm-logs__output mono-font" content={logs.content} />
        ) : null}

        {!loading && logs && logs.content.trim().length === 0 ? (
          <p className="empty-copy">No VM log output is available yet.</p>
        ) : null}
      </section>
    </div>
  );
}

export function SnapshotDialog({
  busy,
  dialog,
  onClose,
  onLabelChange,
  onStatefulChange,
  onSubmit,
}: SnapshotDialogProps): JSX.Element {
  const normalizedLabel = dialog.label.trim();

  return (
    <div
      className="dialog-backdrop"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <section
        className="dialog-panel dialog-panel--snapshot"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Workspace snapshot</p>
            <h2 className="dialog-panel__title">Capture {dialog.vmName}</h2>
            <p className="dialog-panel__copy">
              Save a restorable checkpoint now. Leave RAM enabled to resume apps,
              terminals, and guest state exactly where they were.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <div className="snapshot-dialog__hero">
            <div className="snapshot-dialog__hero-copy">
              <strong>{dialog.vmName}</strong>
              <p>
                {dialog.stateful
                  ? `Restore will need at least ${formatRam(dialog.ramMb)} RAM to reload the saved memory image.`
                  : "This will save the disk state only, so the workspace boots cleanly on restore."}
              </p>
            </div>
            <div className="chip-row">
              <span
                className={
                  dialog.stateful
                    ? "surface-pill surface-pill--success"
                    : "surface-pill"
                }
              >
                {dialog.stateful ? "RAM included" : "Disk only"}
              </span>
              <span className="surface-pill">{dialog.vmStatus}</span>
            </div>
          </div>

          <label className="field-shell">
            <span>Label</span>
            <input
              className="field-input"
              value={dialog.label}
              onChange={(event) => onLabelChange(event.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>

          {dialog.canCaptureRam ? (
            <InlineWarningNote title="Live capture">{liveCaptureWarningCopy}</InlineWarningNote>
          ) : null}

          <label
            className={`snapshot-dialog__toggle ${dialog.stateful ? "snapshot-dialog__toggle--selected" : ""} ${dialog.canCaptureRam ? "" : "snapshot-dialog__toggle--disabled"}`}
          >
            <input
              checked={dialog.stateful}
              className="snapshot-dialog__toggle-input"
              disabled={busy || !dialog.canCaptureRam}
              onChange={(event) => onStatefulChange(event.target.checked)}
              type="checkbox"
            />
            <div className="snapshot-dialog__toggle-copy">
              <strong>Include RAM for pause/resume</strong>
              <p>
                {dialog.canCaptureRam
                  ? `Recommended for running workspaces. This keeps open applications and session memory in ${formatRam(dialog.ramMb)} of saved state.`
                  : "RAM capture is only available while the workspace is running. This snapshot will be disk-only."}
              </p>
            </div>
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedLabel.length === 0}
          >
            {dialog.stateful ? "Capture snapshot with RAM" : "Capture snapshot"}
          </button>
        </form>
      </section>
    </div>
  );
}

export function CreateVmDialog({
  busy,
  createDraft,
  selectedSource,
  sourceGroups,
  validationError,
  onClose,
  onFieldChange,
  onShutdownBeforeCloneChange,
  onStatefulCloneChange,
  onRandomizeName,
  onSubmit,
  onSourceChange,
}: CreateVmDialogProps): JSX.Element {
  const snapshotSelected = selectedSource?.kind === "snapshot";
  const cloneVmSelected = selectedSource?.kind === "vm";
  const cloneSourceRunning = cloneVmSelected && selectedSource.sourceVm?.status === "running";
  const cloneRamRequested = cloneSourceRunning && !createDraft.shutdownSourceBeforeClone && createDraft.statefulClone;
  const reuseExistingDiskState = snapshotSelected || cloneVmSelected;
  const desktopTransportChoiceVisible =
    createSourceSupportsDesktopTransportChoice(selectedSource);
  const lanAccessDisabled = createDraft.networkMode === "dmz";
  const sourceSummary =
    selectedSource?.kind === "snapshot" && selectedSource.snapshot
      ? selectedSource.snapshot.stateful
        ? `Snapshot ${selectedSource.snapshot.label} from ${selectedSource.sourceVm?.name ?? selectedSource.template.name}. Launching a new workspace starts from disk only; use restore on the original workspace to resume saved RAM.`
        : `Snapshot ${selectedSource.snapshot.label} from ${selectedSource.sourceVm?.name ?? selectedSource.template.name}.`
      : selectedSource?.kind === "vm" && selectedSource.sourceVm
        ? `Clone the current workspace state from ${selectedSource.sourceVm.name}.`
        : selectedSource
          ? `Template ${selectedSource.template.name} will provision a fresh workspace.`
          : "Choose a template, snapshot, or existing VM to define the initial workspace state.";
  const nameFieldId = "create-vm-name";

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Create workspace</p>
            <h2 className="dialog-panel__title">Launch a VM</h2>
            <p className="dialog-panel__copy">
              Keep the rail lean. Launch from a template, saved snapshot, or existing VM here,
              then manage the rest in the sidepanel.
            </p>
          </div>
          <button className="button button--ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Source</span>
            <select
              className="field-input"
              value={createDraft.launchSource}
              onChange={onSourceChange}
              disabled={busy}
            >
              {sourceGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <p className="empty-copy">{sourceSummary}</p>

          {desktopTransportChoiceVisible ? (
            <div className="field-shell">
              <span>Desktop streaming</span>
              <div className="transport-choice-grid">
                {desktopTransportChoices.map((choice) => (
                  <label
                    key={choice.value}
                    className={`transport-choice ${createDraft.desktopTransport === choice.value ? "transport-choice--selected" : ""}`}
                  >
                    <input
                      checked={createDraft.desktopTransport === choice.value}
                      className="transport-choice__input"
                      disabled={busy}
                      name="desktopTransport"
                      onChange={() => onFieldChange("desktopTransport", choice.value)}
                      type="radio"
                      value={choice.value}
                    />
                    <div className="transport-choice__body">
                      <strong>{desktopTransportChoiceLabel(choice.value)}</strong>
                      <p className="transport-choice__copy">{choice.copy}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {cloneSourceRunning ? (
            <label
              className="field-shell"
              style={{ alignItems: "center", gap: "0.6rem", gridAutoFlow: "column", justifyContent: "start" }}
            >
              <input
                checked={createDraft.shutdownSourceBeforeClone}
                disabled={busy}
                onChange={(event) => onShutdownBeforeCloneChange(event.target.checked)}
                type="checkbox"
              />
              <span>Shutdown the VM before cloning</span>
            </label>
          ) : null}

          {cloneSourceRunning && !createDraft.shutdownSourceBeforeClone ? (
            <InlineWarningNote title="Running clone source">
              {cloneRamRequested
                ? liveCloneWarningCopy
                : "Some apps might have stale state and lockfiles when you clone a running VM. Shut it down first if you need a cleaner copy."}
            </InlineWarningNote>
          ) : null}

          {cloneSourceRunning ? (
            <label className="snapshot-dialog__toggle">
              <input
                checked={cloneRamRequested}
                className="snapshot-dialog__toggle-input"
                disabled={busy || createDraft.shutdownSourceBeforeClone}
                onChange={(event) => onStatefulCloneChange(event.target.checked)}
                type="checkbox"
              />
              <div className="snapshot-dialog__toggle-copy">
                <strong>Include RAM for instant resume</strong>
                <p>
                  {createDraft.shutdownSourceBeforeClone
                    ? "Turn off shutdown-before-clone to carry open apps and in-memory state into the fork."
                    : `Keep the live session from ${selectedSource?.sourceVm?.name ?? "the source VM"}, including open apps and ${formatRam(selectedSource?.sourceVm?.resources.ramMb ?? 0)} of saved memory state.`}
                </p>
              </div>
            </label>
          ) : null}

          <div className="field-shell">
            <label htmlFor={nameFieldId}>Name</label>
            <div className="field-input-action">
              <input
                id={nameFieldId}
                className="field-input field-input-action__input"
                value={createDraft.name}
                onChange={(event) => onFieldChange("name", event.target.value)}
                placeholder="agent-lab-01"
                disabled={busy}
              />
              <button
                className="field-input-action__button"
                type="button"
                aria-label="Generate random VM"
                title="Generate random VM"
                disabled={busy}
                onClick={onRandomizeName}
              >
                <RefreshNameIcon />
              </button>
            </div>
          </div>

          <div className="compact-grid compact-grid--triple">
            <NumberField
              disabled={busy}
              label="CPU"
              value={createDraft.cpu}
              onChange={(value) => onFieldChange("cpu", value)}
            />
            <NumberField
              disabled={busy}
              allowDecimal
              label="RAM GB"
              value={createDraft.ramGb}
              onChange={(value) => onFieldChange("ramGb", value)}
            />
            <NumberField
              disabled={busy}
              label="Disk GB"
              value={createDraft.diskGb}
              onChange={(value) => onFieldChange("diskGb", value)}
            />
          </div>

          <label
            className="field-shell"
            style={{
              alignItems: "center",
              gap: "0.6rem",
              gridAutoFlow: "column",
              justifyContent: "start",
            }}
          >
            <input
              checked={lanAccessDisabled}
              disabled={busy}
              onChange={(event) =>
                onFieldChange("networkMode", event.target.checked ? "dmz" : "default")}
              type="checkbox"
            />
            <span>Disable LAN access</span>
          </label>

          <p className="empty-copy">
            {lanAccessDisabled
              ? "LAN access is disabled. The workspace uses the DMZ profile, which keeps guest internet and public DNS access while restricting host and private-range access unless explicitly allowed."
              : "LAN access is enabled. The workspace uses the default bridge, including normal host and LAN reachability."}
          </p>

          {!reuseExistingDiskState ? (
            <>
              <label className="field-shell">
                <span>Init commands</span>
                <textarea
                  className="field-input field-input--tall field-input--mono"
                  value={createDraft.initCommands}
                  onChange={(event) => onFieldChange("initCommands", event.target.value)}
                  placeholder={"sudo apt-get update\nsudo apt-get install -y ripgrep"}
                  disabled={busy}
                  spellCheck={false}
                />
              </label>

              <p className="empty-copy">
                These run once on first boot for this VM only. Use template edit or clone when
                you want to save them as the default for future launches.
              </p>
            </>
          ) : null}

          {validationError ? (
            <div className="inline-note">
              <strong>Launch blocked</strong>
              <p>{validationError}</p>
            </div>
          ) : null}

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || selectedSource === null || validationError !== null}
          >
            Queue workspace
          </button>
        </form>
      </section>
    </div>
  );
}

export function TemplateCloneDialog({
  busy,
  draft,
  sourceTemplate,
  onClose,
  onFieldChange,
  onSubmit,
}: TemplateCloneDialogProps): JSX.Element {
  const normalizedName = draft.name.trim();

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Template clone</p>
            <h2 className="dialog-panel__title">Save a reusable template</h2>
            <p className="dialog-panel__copy">
              Clone the selected base template, then add one command per line for the
              first boot script.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          {sourceTemplate ? (
            <div className="dialog-panel__template">
              <div className="dialog-panel__template-head">
                <strong>{sourceTemplate.name}</strong>
                <span className="surface-pill">
                  {formatResources(sourceTemplate.defaultResources)}
                </span>
              </div>
              <p>{sourceTemplate.description}</p>
            </div>
          ) : null}

          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="Ubuntu Agent Forge Custom"
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="field-shell">
            <span>Description</span>
            <textarea
              className="field-input field-input--tall"
              value={draft.description}
              onChange={(event) => onFieldChange("description", event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field-shell">
            <span>Init commands</span>
            <textarea
              className="field-input field-input--tall field-input--mono"
              value={draft.initCommands}
              onChange={(event) => onFieldChange("initCommands", event.target.value)}
              placeholder={"sudo apt-get update\nsudo apt-get install -y nodejs npm"}
              disabled={busy}
              spellCheck={false}
            />
          </label>

          <p className="empty-copy">
            First-boot commands run once on fresh launches from this template. Leave the list
            empty if you only want a renamed clone of the base template.
          </p>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedName.length === 0}
          >
            Save template
          </button>
        </form>
      </section>
    </div>
  );
}

export function TemplateEditDialog({
  busy,
  draft,
  onClose,
  onFieldChange,
  onSubmit,
}: TemplateEditDialogProps): JSX.Element {
  const normalizedName = draft.name.trim();

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Template</p>
            <h2 className="dialog-panel__title">Edit template</h2>
            <p className="dialog-panel__copy">
              Update the saved name, description, and first-boot init commands in one place.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="field-shell">
            <span>Description</span>
            <textarea
              className="field-input field-input--tall"
              value={draft.description}
              onChange={(event) => onFieldChange("description", event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field-shell">
            <span>Init commands</span>
            <textarea
              className="field-input field-input--tall field-input--mono"
              value={draft.initCommands}
              onChange={(event) => onFieldChange("initCommands", event.target.value)}
              placeholder={"sudo apt-get update\nsudo apt-get install -y nodejs npm"}
              disabled={busy}
              spellCheck={false}
            />
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedName.length === 0}
          >
            Save template
          </button>
        </form>
      </section>
    </div>
  );
}

export function CloneVmDialog({
  busy,
  dialog,
  draft,
  onClose,
  onDraftChange,
  onStatefulChange,
  onSubmit,
}: CloneVmDialogProps): JSX.Element {
  const normalizedDraft = draft.trim();

  return (
    <div
      className="dialog-backdrop"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Clone workspace</p>
            <h2 className="dialog-panel__title">Clone {dialog.sourceVmName}</h2>
            <p className="dialog-panel__copy">
              Create a new workspace from the current VM without leaving the dashboard UI.
              Keep RAM enabled when you want the fork to resume open apps and terminals.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={`${dialog.sourceVmName}-clone`}
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="snapshot-dialog__toggle">
            <input
              checked={dialog.stateful}
              className="snapshot-dialog__toggle-input"
              disabled={busy || !dialog.canCaptureRam}
              onChange={(event) => onStatefulChange(event.target.checked)}
              type="checkbox"
            />
            <div className="snapshot-dialog__toggle-copy">
              <strong>Include RAM for instant resume</strong>
              <p>
                {dialog.canCaptureRam
                  ? `Recommended for running workspaces. This carries open apps and ${formatRam(dialog.ramMb)} of saved memory state into the clone.`
                  : "RAM cloning is only available while the source workspace is running. This clone will be disk-only."}
              </p>
            </div>
          </label>

          {dialog.stateful ? (
            <InlineWarningNote title="Live RAM clone">{liveCloneWarningCopy}</InlineWarningNote>
          ) : null}

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedDraft.length === 0}
          >
            {dialog.stateful ? "Queue clone with RAM" : "Queue clone"}
          </button>
        </form>
      </section>
    </div>
  );
}

export function TemplateInitCommandsPreview({
  commands,
  truncateAfter,
}: {
  commands: string[];
  truncateAfter?: number;
}): JSX.Element {
  const visibleCommands =
    truncateAfter && truncateAfter > 0 ? commands.slice(0, truncateAfter) : commands;
  const hiddenCount = Math.max(0, commands.length - visibleCommands.length);

  return (
    <div className="template-init-preview">
      <div className="template-init-preview__head">
        <strong>First boot</strong>
        <span className="surface-pill">
          {commands.length} init command{commands.length === 1 ? "" : "s"}
        </span>
      </div>
      {commands.length > 0 ? (
        <>
          <pre className="template-init-preview__output mono-font">
            {visibleCommands.join("\n")}
          </pre>
          {hiddenCount > 0 ? (
            <p className="empty-copy">
              +{hiddenCount} more command{hiddenCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </>
      ) : (
        <p className="empty-copy">No first-boot init commands.</p>
      )}
    </div>
  );
}
