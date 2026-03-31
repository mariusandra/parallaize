import type { ChangeEvent, FormEvent, JSX } from "react";

import { formatResources, formatTimestamp } from "../../../packages/shared/src/helpers.js";
import type { EnvironmentTemplate, VmLogsSnapshot } from "../../../packages/shared/src/types.js";

import type {
  CreateDraft,
  CreateSourceGroup,
  CreateSourceSelection,
  TemplateCloneDraft,
  TemplateEditDraft,
} from "./dashboardHelpers.js";
import { createSourceSupportsDesktopTransportChoice } from "./dashboardHelpers.js";
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
  draft: string;
  sourceVmName: string;
  onClose: () => void;
  onDraftChange: (value: string) => void;
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

interface VmLogsDialogProps {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
  vmName: string;
  onClose: () => void;
  onRefresh: () => void;
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

export function CreateVmDialog({
  busy,
  createDraft,
  selectedSource,
  sourceGroups,
  validationError,
  onClose,
  onFieldChange,
  onShutdownBeforeCloneChange,
  onSubmit,
  onSourceChange,
}: CreateVmDialogProps): JSX.Element {
  const snapshotSelected = selectedSource?.kind === "snapshot";
  const cloneVmSelected = selectedSource?.kind === "vm";
  const cloneSourceRunning = cloneVmSelected && selectedSource.sourceVm?.status === "running";
  const reuseExistingDiskState = snapshotSelected || cloneVmSelected;
  const desktopTransportChoiceVisible =
    createSourceSupportsDesktopTransportChoice(selectedSource);
  const lanAccessDisabled = createDraft.networkMode === "dmz";
  const sourceSummary =
    selectedSource?.kind === "snapshot" && selectedSource.snapshot
      ? `Snapshot ${selectedSource.snapshot.label} from ${selectedSource.sourceVm?.name ?? selectedSource.template.name}.`
      : selectedSource?.kind === "vm" && selectedSource.sourceVm
        ? `Clone the current workspace state from ${selectedSource.sourceVm.name}.`
        : selectedSource
          ? `Template ${selectedSource.template.name} will provision a fresh workspace.`
          : "Choose a template, snapshot, or existing VM to define the initial workspace state.";

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
                <label
                  className={`transport-choice ${createDraft.desktopTransport === "selkies" ? "transport-choice--selected" : ""}`}
                >
                  <input
                    checked={createDraft.desktopTransport === "selkies"}
                    className="transport-choice__input"
                    disabled={busy}
                    name="desktopTransport"
                    onChange={() => onFieldChange("desktopTransport", "selkies")}
                    type="radio"
                    value="selkies"
                  />
                  <div className="transport-choice__body">
                    <strong>Selkies</strong>
                    <p className="transport-choice__copy">
                      60fps, needs plenty of CPU/GPU.
                    </p>
                  </div>
                </label>

                <label
                  className={`transport-choice ${createDraft.desktopTransport === "vnc" ? "transport-choice--selected" : ""}`}
                >
                  <input
                    checked={createDraft.desktopTransport === "vnc"}
                    className="transport-choice__input"
                    disabled={busy}
                    name="desktopTransport"
                    onChange={() => onFieldChange("desktopTransport", "vnc")}
                    type="radio"
                    value="vnc"
                  />
                  <div className="transport-choice__body">
                    <strong>VNC</strong>
                    <p className="transport-choice__copy">Slow but proven.</p>
                  </div>
                </label>
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
              Some apps might have stale state and lockfiles when you clone a running VM. Shut it
              down first if you need a cleaner copy.
            </InlineWarningNote>
          ) : null}

          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={createDraft.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="agent-lab-01"
              disabled={busy}
            />
          </label>

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
  draft,
  sourceVmName,
  onClose,
  onDraftChange,
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
            <h2 className="dialog-panel__title">Clone {sourceVmName}</h2>
            <p className="dialog-panel__copy">
              Create a new workspace from the current VM without leaving the dashboard UI.
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
              placeholder={`${sourceVmName}-clone`}
              disabled={busy}
              autoFocus
            />
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedDraft.length === 0}
          >
            Queue clone
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
