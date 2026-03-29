import type { FormEvent, JSX } from "react";

import type { DashboardSummary, EnvironmentTemplate } from "../../../packages/shared/src/types.js";

import {
  CloneVmDialog,
  CreateVmDialog,
  RenameDialog,
  TemplateCloneDialog,
  TemplateEditDialog,
  VmLogsDialog,
} from "./dashboardDialogs.js";
import {
  buildCreateLaunchValidationError,
  buildCreateSourceGroups,
  resolveCreateSourceSelection,
  type CreateDraft,
  type TemplateCloneDraft,
  type TemplateEditDraft,
} from "./dashboardHelpers.js";
import type {
  CloneVmDialogState,
  RenameDialogState,
  VmLogsDialogState,
} from "./dashboardShell.js";

interface DashboardDialogsHostProps {
  busy: boolean;
  cloneVmDialog: CloneVmDialogState | null;
  cloneVmDraft: string;
  createDraft: CreateDraft;
  displayedTemplates: EnvironmentTemplate[];
  renameDialog: RenameDialogState | null;
  renameDraft: string;
  showCreateDialog: boolean;
  summary: DashboardSummary;
  templateCloneDraft: TemplateCloneDraft | null;
  templateEditDraft: TemplateEditDraft | null;
  vmLogsDialog: VmLogsDialogState | null;
  onCloneDraftChange: (value: string) => void;
  onCloseCloneVmDialog: () => void;
  onCloseCreateDialog: () => void;
  onCloseRenameDialog: () => void;
  onCloseTemplateCloneDialog: () => void;
  onCloseTemplateEditDialog: () => void;
  onCloseVmLogsDialog: () => void;
  onCloneVmSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateFieldChange: (field: keyof CreateDraft, value: string) => void;
  onCreateShutdownBeforeCloneChange: (checked: boolean) => void;
  onCreateSourceChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onCreateSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRefreshVmLogsDialog: () => void;
  onRenameDraftChange: (value: string) => void;
  onRenameSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateCloneFieldChange: (
    field: keyof TemplateCloneDraft,
    value: string,
  ) => void;
  onTemplateCloneSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateEditFieldChange: (
    field: keyof TemplateEditDraft,
    value: string,
  ) => void;
  onTemplateEditSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function DashboardDialogsHost({
  busy,
  cloneVmDialog,
  cloneVmDraft,
  createDraft,
  displayedTemplates,
  renameDialog,
  renameDraft,
  showCreateDialog,
  summary,
  templateCloneDraft,
  templateEditDraft,
  vmLogsDialog,
  onCloneDraftChange,
  onCloseCloneVmDialog,
  onCloseCreateDialog,
  onCloseRenameDialog,
  onCloseTemplateCloneDialog,
  onCloseTemplateEditDialog,
  onCloseVmLogsDialog,
  onCloneVmSubmit,
  onCreateFieldChange,
  onCreateShutdownBeforeCloneChange,
  onCreateSourceChange,
  onCreateSubmit,
  onRefreshVmLogsDialog,
  onRenameDraftChange,
  onRenameSubmit,
  onTemplateCloneFieldChange,
  onTemplateCloneSubmit,
  onTemplateEditFieldChange,
  onTemplateEditSubmit,
}: DashboardDialogsHostProps): JSX.Element {
  return (
    <>
      {showCreateDialog ? (
        <CreateVmDialog
          busy={busy}
          createDraft={createDraft}
          selectedSource={resolveCreateSourceSelection(
            summary.templates,
            summary.snapshots,
            summary.vms,
            createDraft.launchSource,
          )}
          sourceGroups={buildCreateSourceGroups(summary.templates, summary.snapshots, summary.vms)}
          validationError={buildCreateLaunchValidationError(
            resolveCreateSourceSelection(
              summary.templates,
              summary.snapshots,
              summary.vms,
              createDraft.launchSource,
            ),
            createDraft.diskGb,
          )}
          onClose={onCloseCreateDialog}
          onFieldChange={onCreateFieldChange}
          onShutdownBeforeCloneChange={onCreateShutdownBeforeCloneChange}
          onSubmit={onCreateSubmit}
          onSourceChange={onCreateSourceChange}
        />
      ) : null}
      {templateCloneDraft ? (
        <TemplateCloneDialog
          busy={busy}
          draft={templateCloneDraft}
          sourceTemplate={
            displayedTemplates.find((entry) => entry.id === templateCloneDraft.sourceTemplateId) ?? null
          }
          onClose={onCloseTemplateCloneDialog}
          onFieldChange={onTemplateCloneFieldChange}
          onSubmit={onTemplateCloneSubmit}
        />
      ) : null}
      {templateEditDraft ? (
        <TemplateEditDialog
          busy={busy}
          draft={templateEditDraft}
          onClose={onCloseTemplateEditDialog}
          onFieldChange={onTemplateEditFieldChange}
          onSubmit={onTemplateEditSubmit}
        />
      ) : null}
      {cloneVmDialog ? (
        <CloneVmDialog
          busy={busy}
          draft={cloneVmDraft}
          sourceVmName={cloneVmDialog.sourceVmName}
          onClose={onCloseCloneVmDialog}
          onDraftChange={onCloneDraftChange}
          onSubmit={onCloneVmSubmit}
        />
      ) : null}
      {renameDialog ? (
        <RenameDialog
          busy={busy}
          currentName={renameDialog.currentName}
          draft={renameDraft}
          entityLabel={renameDialog.kind === "vm" ? "Workspace" : "Template"}
          onClose={onCloseRenameDialog}
          onDraftChange={onRenameDraftChange}
          onSubmit={onRenameSubmit}
        />
      ) : null}
      {vmLogsDialog ? (
        <VmLogsDialog
          error={vmLogsDialog.error}
          loading={vmLogsDialog.loading}
          logs={vmLogsDialog.logs}
          refreshing={vmLogsDialog.refreshing}
          vmName={vmLogsDialog.vmName}
          onClose={onCloseVmLogsDialog}
          onRefresh={onRefreshVmLogsDialog}
        />
      ) : null}
    </>
  );
}
