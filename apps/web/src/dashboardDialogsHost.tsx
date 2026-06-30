import type { FormEvent, JSX } from "react";

import type { DashboardSummary, EnvironmentTemplate } from "../../../packages/shared/src/types.js";

import {
  CloneVmDialog,
  CreateProjectDialog,
  CreateVmDialog,
  RenameDialog,
  SnapshotDialog,
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
  type TemplateEnvDraft,
  type TemplateScriptDraft,
} from "./dashboardHelpers.js";
import type {
  CloneVmDialogState,
  ProjectDraft,
  RenameDialogState,
  SnapshotDialogState,
  VmLogsDialogState,
} from "./dashboardShell.js";

interface DashboardDialogsHostProps {
  busy: boolean;
  cloneVmDialog: CloneVmDialogState | null;
  cloneVmDraft: string;
  createDraft: CreateDraft;
  createProjectDraft: ProjectDraft;
  editingProjectId: string | null;
  createProjectId: string;
  displayedTemplates: EnvironmentTemplate[];
  renameDialog: RenameDialogState | null;
  renameDraft: string;
  showCreateProjectDialog: boolean;
  showCreateDialog: boolean;
  snapshotDialog: SnapshotDialogState | null;
  summary: DashboardSummary;
  templateCloneDraft: TemplateCloneDraft | null;
  templateEditDraft: TemplateEditDraft | null;
  vmLogsDialog: VmLogsDialogState | null;
  onCloneDraftChange: (value: string) => void;
  onCloneStatefulChange: (checked: boolean) => void;
  onCloseCloneVmDialog: () => void;
  onCloseCreateDialog: () => void;
  onCloseCreateProjectDialog: () => void;
  onCloseRenameDialog: () => void;
  onCloseSnapshotDialog: () => void;
  onCloseTemplateCloneDialog: () => void;
  onCloseTemplateEditDialog: () => void;
  onCloseVmLogsDialog: () => void;
  onCloneVmSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateFieldChange: (field: keyof CreateDraft, value: string) => void;
  onCreateProjectFieldChange: (field: keyof ProjectDraft, value: string) => void;
  onCreateShutdownBeforeCloneChange: (checked: boolean) => void;
  onCreateStatefulCloneChange: (checked: boolean) => void;
  onCreateRandomizeName: () => void;
  onCreateProjectSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreateSourceChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onCreateSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRefreshVmLogsDialog: () => void;
  onRenameDraftChange: (value: string) => void;
  onRenameSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSnapshotLabelChange: (value: string) => void;
  onSnapshotStatefulChange: (checked: boolean) => void;
  onSnapshotSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateCloneFieldChange: (
    field: keyof TemplateCloneDraft,
    value: string,
  ) => void;
  onTemplateCloneAddEnvVar: () => void;
  onTemplateCloneRemoveEnvVar: (envVarId: string) => void;
  onTemplateCloneEnvVarChange: (
    envVarId: string,
    field: keyof TemplateEnvDraft,
    value: string,
  ) => void;
  onTemplateCloneAddScript: () => void;
  onTemplateCloneRemoveScript: (scriptId: string) => void;
  onTemplateCloneScriptChange: (
    scriptId: string,
    field: keyof TemplateScriptDraft,
    value: string,
  ) => void;
  onTemplateCloneGenerateScripts: () => Promise<void>;
  onTemplateCloneSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateEditFieldChange: (
    field: keyof TemplateEditDraft,
    value: string,
  ) => void;
  onTemplateEditAddEnvVar: () => void;
  onTemplateEditRemoveEnvVar: (envVarId: string) => void;
  onTemplateEditEnvVarChange: (
    envVarId: string,
    field: keyof TemplateEnvDraft,
    value: string,
  ) => void;
  onTemplateEditAddScript: () => void;
  onTemplateEditRemoveScript: (scriptId: string) => void;
  onTemplateEditScriptChange: (
    scriptId: string,
    field: keyof TemplateScriptDraft,
    value: string,
  ) => void;
  onTemplateEditGenerateScripts: () => Promise<void>;
  onTemplateEditSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function DashboardDialogsHost({
  busy,
  cloneVmDialog,
  cloneVmDraft,
  createDraft,
  createProjectDraft,
  editingProjectId,
  createProjectId,
  displayedTemplates,
  renameDialog,
  renameDraft,
  showCreateProjectDialog,
  showCreateDialog,
  snapshotDialog,
  summary,
  templateCloneDraft,
  templateEditDraft,
  vmLogsDialog,
  onCloneDraftChange,
  onCloneStatefulChange,
  onCloseCloneVmDialog,
  onCloseCreateDialog,
  onCloseCreateProjectDialog,
  onCloseRenameDialog,
  onCloseSnapshotDialog,
  onCloseTemplateCloneDialog,
  onCloseTemplateEditDialog,
  onCloseVmLogsDialog,
  onCloneVmSubmit,
  onCreateFieldChange,
  onCreateProjectFieldChange,
  onCreateShutdownBeforeCloneChange,
  onCreateStatefulCloneChange,
  onCreateRandomizeName,
  onCreateProjectSubmit,
  onCreateSourceChange,
  onCreateSubmit,
  onRefreshVmLogsDialog,
  onRenameDraftChange,
  onRenameSubmit,
  onSnapshotLabelChange,
  onSnapshotStatefulChange,
  onSnapshotSubmit,
  onTemplateCloneFieldChange,
  onTemplateCloneAddEnvVar,
  onTemplateCloneRemoveEnvVar,
  onTemplateCloneEnvVarChange,
  onTemplateCloneAddScript,
  onTemplateCloneRemoveScript,
  onTemplateCloneScriptChange,
  onTemplateCloneGenerateScripts,
  onTemplateCloneSubmit,
  onTemplateEditFieldChange,
  onTemplateEditAddEnvVar,
  onTemplateEditRemoveEnvVar,
  onTemplateEditEnvVarChange,
  onTemplateEditAddScript,
  onTemplateEditRemoveScript,
  onTemplateEditScriptChange,
  onTemplateEditGenerateScripts,
  onTemplateEditSubmit,
}: DashboardDialogsHostProps): JSX.Element {
  const createProject =
    summary.projects.find((project) => project.id === createProjectId) ?? summary.projects[0];
  const editingProject =
    summary.projects.find((project) => project.id === editingProjectId) ?? null;

  return (
    <>
      {showCreateProjectDialog ? (
        <CreateProjectDialog
          busy={busy}
          currentProject={
            editingProject
              ? {
                  githubUrl: editingProject.githubUrl,
                  name: editingProject.name,
                }
              : null
          }
          draft={createProjectDraft}
          mode={editingProject ? "edit" : "create"}
          onClose={onCloseCreateProjectDialog}
          onFieldChange={onCreateProjectFieldChange}
          onSubmit={onCreateProjectSubmit}
        />
      ) : null}
      {showCreateDialog ? (
        <CreateVmDialog
          busy={busy}
          createDraft={createDraft}
          projectName={createProject?.name ?? "Default"}
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
            createDraft.ramGb,
            createDraft.diskGb,
            {
              statefulClone: createDraft.statefulClone,
            },
          )}
          onClose={onCloseCreateDialog}
          onFieldChange={onCreateFieldChange}
          onShutdownBeforeCloneChange={onCreateShutdownBeforeCloneChange}
          onStatefulCloneChange={onCreateStatefulCloneChange}
          onRandomizeName={onCreateRandomizeName}
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
          onAddEnvVar={onTemplateCloneAddEnvVar}
          onRemoveEnvVar={onTemplateCloneRemoveEnvVar}
          onEnvVarChange={onTemplateCloneEnvVarChange}
          onAddScript={onTemplateCloneAddScript}
          onRemoveScript={onTemplateCloneRemoveScript}
          onScriptChange={onTemplateCloneScriptChange}
          onGenerateScripts={onTemplateCloneGenerateScripts}
          onSubmit={onTemplateCloneSubmit}
        />
      ) : null}
      {templateEditDraft ? (
        <TemplateEditDialog
          busy={busy}
          draft={templateEditDraft}
          onClose={onCloseTemplateEditDialog}
          onFieldChange={onTemplateEditFieldChange}
          onAddEnvVar={onTemplateEditAddEnvVar}
          onRemoveEnvVar={onTemplateEditRemoveEnvVar}
          onEnvVarChange={onTemplateEditEnvVarChange}
          onAddScript={onTemplateEditAddScript}
          onRemoveScript={onTemplateEditRemoveScript}
          onScriptChange={onTemplateEditScriptChange}
          onGenerateScripts={onTemplateEditGenerateScripts}
          onSubmit={onTemplateEditSubmit}
        />
      ) : null}
      {cloneVmDialog ? (
        <CloneVmDialog
          busy={busy}
          dialog={cloneVmDialog}
          draft={cloneVmDraft}
          onClose={onCloseCloneVmDialog}
          onDraftChange={onCloneDraftChange}
          onStatefulChange={onCloneStatefulChange}
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
      {snapshotDialog ? (
        <SnapshotDialog
          busy={busy}
          dialog={snapshotDialog}
          onClose={onCloseSnapshotDialog}
          onLabelChange={onSnapshotLabelChange}
          onStatefulChange={onSnapshotStatefulChange}
          onSubmit={onSnapshotSubmit}
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
