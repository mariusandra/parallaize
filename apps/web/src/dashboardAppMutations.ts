import {
  startTransition,
  type ChangeEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import type {
  AuthStatus,
  CreateTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  HealthStatus,
  ReorderVmsInput,
  SnapshotInput,
  UpdateTemplateInput,
  UpdateVmInput,
  VmDetail,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmInstance,
  VmPowerAction,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import { buildRandomVmName } from "./vmNames.js";
import {
  activeCpuThresholdDefault,
  buildCreateDraftFromSource,
  buildCreateDraftFromSnapshot,
  buildCreateDraftFromTemplate,
  buildCreateDraftFromVm,
  buildCreateLaunchValidationError,
  buildTemplateCloneDraft,
  buildTemplateEditDraft,
  firstCreateSourceSelection,
  normalizeActiveCpuThreshold,
  parseInitCommandsDraft,
  parseRamDraftValue,
  reorderVmIds,
  resolveCreateSourceSelection,
  sameIdOrder,
  type CreateDraft,
  type TemplateCloneDraft,
  type TemplateEditDraft,
} from "./dashboardHelpers.js";
import {
  buildDefaultSnapshotLabel,
  buildResolutionDraft,
  clampDesktopFixedHeight,
  clampDesktopFixedWidth,
  clampDesktopViewportScale,
  clampDisplayedSidepanelWidth,
  clampRailWidthPreference,
  clampSidepanelWidthPreference,
  formatViewportScale,
  normalizeDesktopResolutionPreference,
  railCompactWidth,
  railExpandedMinWidth,
  railMaxWidth,
  sidepanelClosedWidth,
  sidepanelMaxWidth,
  sidepanelMinWidth,
  type CloneVmDialogState,
  type DesktopResolutionMode,
  type DesktopResolutionPreference,
  type Notice,
  type RenameDialogState,
  type ResolutionDraft,
  type SnapshotDialogState,
  type VmLogsDialogState,
} from "./dashboardShell.js";
import {
  AuthRequiredError,
  errorMessage,
  fetchJson,
  postJson,
} from "./dashboardTransport.js";

type SetState<T> = Dispatch<SetStateAction<T>>;

interface DashboardAppMutationsContext {
  summary: DashboardSummary | null;
  displayedVms: VmInstance[];
  createDraft: CreateDraft;
  cloneVmDialog: CloneVmDialogState | null;
  cloneVmDraft: string;
  snapshotDialog: SnapshotDialogState | null;
  renameDialog: RenameDialogState | null;
  renameDraft: string;
  templateEditDraft: TemplateEditDraft | null;
  templateCloneDraft: TemplateCloneDraft | null;
  activeCpuThresholdsByVm: Record<string, number>;
  detail: VmDetail | null;
  draggedVmId: string | null;
  vmRailOrderIds: string[] | null;
  vmReorderBusy: boolean;
  wideShellLayout: boolean;
  compactSidepanelLayout: boolean;
  railWidth: number;
  displayedSidepanelWidth: number;
  viewportWidth: number;
  appliedDesktopViewportScale: number;
  appliedDesktopWidth: number;
  appliedDesktopHeight: number;
  resolutionDraft: ResolutionDraft;
  emptyCreateDraft: CreateDraft;
  selectedVmIdRef: MutableRefObject<string | null>;
  lastResolutionRequestKeyRef: MutableRefObject<string | null>;
  railRef: RefObject<HTMLElement | null>;
  railResizeRef: MutableRefObject<{ panelLeft: number } | null>;
  sidepanelRef: RefObject<HTMLElement | null>;
  sidepanelResizeRef: MutableRefObject<{
    anchorClientX: number;
    anchorWidth: number;
    pendingClosedOpen: boolean;
  } | null>;
  vmDragDropCommittedRef: MutableRefObject<boolean>;
  setSummary: SetState<DashboardSummary | null>;
  setAuthState: SetState<"checking" | "ready" | "required">;
  setHealth: SetState<HealthStatus | null>;
  setDetail: SetState<VmDetail | null>;
  setVmFileBrowser: SetState<VmFileBrowserSnapshot | null>;
  setVmFileBrowserError: SetState<string | null>;
  setVmFileBrowserLoading: SetState<boolean>;
  setVmTouchedFiles: SetState<VmTouchedFilesSnapshot | null>;
  setVmTouchedFilesError: SetState<string | null>;
  setVmTouchedFilesLoading: SetState<boolean>;
  setVmDiskUsage: SetState<VmDiskUsageSnapshot | null>;
  setVmDiskUsageError: SetState<string | null>;
  setVmDiskUsageLoading: SetState<boolean>;
  setNotice: SetState<Notice | null>;
  setBusyLabel: SetState<string | null>;
  setCreateDirty: SetState<boolean>;
  setCreateDraft: SetState<CreateDraft>;
  setShowCreateDialog: SetState<boolean>;
  setCloneVmDialog: SetState<CloneVmDialogState | null>;
  setCloneVmDraft: SetState<string>;
  setSnapshotDialog: SetState<SnapshotDialogState | null>;
  setRenameDialog: SetState<RenameDialogState | null>;
  setRenameDraft: SetState<string>;
  setVmLogsDialog: SetState<VmLogsDialogState | null>;
  setVmLogsRefreshTick: SetState<number>;
  setTemplateCloneDraft: SetState<TemplateCloneDraft | null>;
  setTemplateEditDraft: SetState<TemplateEditDraft | null>;
  setShellMenuOpen: SetState<boolean>;
  setOpenVmMenuId: SetState<string | null>;
  setOpenTemplateMenuId: SetState<string | null>;
  setSelectedVmId: SetState<string | null>;
  setSidepanelCollapsedByVm: SetState<Record<string, true>>;
  setOverviewSidepanelCollapsed: SetState<boolean>;
  setDesktopResolutionByVm: SetState<Record<string, DesktopResolutionPreference>>;
  setResolutionDraft: SetState<ResolutionDraft>;
  setActiveCpuThresholdsByVm: SetState<Record<string, number>>;
  setVmRailOrderIds: SetState<string[] | null>;
  setDraggedVmId: SetState<string | null>;
  setVmReorderBusy: SetState<boolean>;
  setRailResizeActive: SetState<boolean>;
  setRailWidthPreference: SetState<number>;
  setSidepanelResizeActive: SetState<boolean>;
  setSidepanelWidthPreference: SetState<number>;
}

export function createDashboardAppMutations(context: DashboardAppMutationsContext) {
  const {
    summary,
    displayedVms,
    createDraft,
    cloneVmDialog,
    cloneVmDraft,
    snapshotDialog,
    renameDialog,
    renameDraft,
    templateEditDraft,
    templateCloneDraft,
    activeCpuThresholdsByVm,
    detail,
    draggedVmId,
    vmRailOrderIds,
    vmReorderBusy,
    wideShellLayout,
    compactSidepanelLayout,
    railWidth,
    displayedSidepanelWidth,
    viewportWidth,
    appliedDesktopViewportScale,
    appliedDesktopWidth,
    appliedDesktopHeight,
    resolutionDraft,
    emptyCreateDraft,
    selectedVmIdRef,
    lastResolutionRequestKeyRef,
    railRef,
    railResizeRef,
    sidepanelRef,
    sidepanelResizeRef,
    vmDragDropCommittedRef,
    setSummary,
    setAuthState,
    setHealth,
    setDetail,
    setVmFileBrowser,
    setVmFileBrowserError,
    setVmFileBrowserLoading,
    setVmTouchedFiles,
    setVmTouchedFilesError,
    setVmTouchedFilesLoading,
    setVmDiskUsage,
    setVmDiskUsageError,
    setVmDiskUsageLoading,
    setNotice,
    setBusyLabel,
    setCreateDirty,
    setCreateDraft,
    setShowCreateDialog,
    setCloneVmDialog,
    setCloneVmDraft,
    setSnapshotDialog,
    setRenameDialog,
    setRenameDraft,
    setVmLogsDialog,
    setVmLogsRefreshTick,
    setTemplateCloneDraft,
    setTemplateEditDraft,
    setShellMenuOpen,
    setOpenVmMenuId,
    setOpenTemplateMenuId,
    setSelectedVmId,
    setSidepanelCollapsedByVm,
    setOverviewSidepanelCollapsed,
    setDesktopResolutionByVm,
    setResolutionDraft,
    setActiveCpuThresholdsByVm,
    setVmRailOrderIds,
    setDraggedVmId,
    setVmReorderBusy,
    setRailResizeActive,
    setRailWidthPreference,
    setSidepanelResizeActive,
    setSidepanelWidthPreference,
  } = context;

  async function refreshSummary(): Promise<DashboardSummary> {
    const nextSummary = await fetchJson<DashboardSummary>("/api/summary");
    startTransition(() => {
      setSummary(nextSummary);
    });
    setAuthState("ready");
    return nextSummary;
  }

  async function refreshHealth(silent: boolean): Promise<HealthStatus | null> {
    try {
      const nextHealth = await fetchJson<HealthStatus>("/api/health");
      setHealth(nextHealth);
      return nextHealth;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return null;
      }

      if (!silent) {
        setNotice({
          tone: "error",
          message: errorMessage(error),
        });
      }

      return null;
    }
  }

  async function refreshDetail(vmId: string): Promise<void> {
    setDetail(await fetchJson<VmDetail>(`/api/vms/${vmId}`));
  }

  async function refreshVmFileBrowserSnapshot(
    vmId: string,
    path?: string,
  ): Promise<void> {
    setVmFileBrowserLoading(true);
    setVmFileBrowserError(null);

    try {
      const query = path && path.trim().length > 0
        ? `?path=${encodeURIComponent(path)}`
        : "";
      const snapshot = await fetchJson<VmFileBrowserSnapshot>(
        `/api/vms/${vmId}/files${query}`,
      );
      setVmFileBrowser(snapshot);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setVmFileBrowserError(errorMessage(error));
    } finally {
      setVmFileBrowserLoading(false);
    }
  }

  async function refreshVmTouchedFilesSnapshot(vmId: string): Promise<void> {
    setVmTouchedFilesLoading(true);
    setVmTouchedFilesError(null);

    try {
      const snapshot = await fetchJson<VmTouchedFilesSnapshot>(`/api/vms/${vmId}/files/touched`);
      setVmTouchedFiles(snapshot);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setVmTouchedFilesError(errorMessage(error));
    } finally {
      setVmTouchedFilesLoading(false);
    }
  }

  function requireLogin(): void {
    setAuthState("required");
    setHealth(null);
    setSummary(null);
    setDetail(null);
    setVmFileBrowser(null);
    setVmFileBrowserError(null);
    setVmFileBrowserLoading(false);
    setVmTouchedFiles(null);
    setVmTouchedFilesError(null);
    setVmTouchedFilesLoading(false);
    setVmDiskUsage(null);
    setVmDiskUsageError(null);
    setVmDiskUsageLoading(false);
    setNotice(null);
    setBusyLabel(null);
    setShellMenuOpen(false);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setVmLogsDialog(null);
    setSnapshotDialog(null);
  }

  async function handleLogout(): Promise<void> {
    try {
      await postJson<AuthStatus>("/api/auth/logout", {});
    } finally {
      requireLogin();
    }
  }

  async function runMutation(
    label: string,
    task: () => Promise<void>,
    successMessage?: string,
  ): Promise<void> {
    setBusyLabel(label);

    try {
      await task();
      if (successMessage) {
        setNotice({
          tone: "success",
          message: successMessage,
        });
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const selectedSource =
      summary
        ? resolveCreateSourceSelection(
            summary.templates,
            summary.snapshots,
            summary.vms,
            createDraft.launchSource,
          )
        : null;
    const createValidationError = buildCreateLaunchValidationError(
      selectedSource,
      createDraft.ramGb,
      createDraft.diskGb,
      {
        statefulClone: createDraft.statefulClone,
      },
    );

    if (!selectedSource) {
      setNotice({
        tone: "error",
        message: "Choose a template, snapshot, or existing VM before launching a workspace.",
      });
      return;
    }

    if (createValidationError) {
      setNotice({
        tone: "error",
        message: createValidationError,
      });
      return;
    }

    const requestedName = createDraft.name.trim();
    const requestedResources = {
      cpu: Number(createDraft.cpu),
      ramMb: parseRamDraftValue(createDraft.ramGb),
      diskGb: Number(createDraft.diskGb),
    };
    const pendingLabel =
      requestedName ||
      (selectedSource.kind === "vm" && selectedSource.sourceVm
        ? `${selectedSource.sourceVm.name}-clone`
        : "workspace");

    await runMutation(
      `Creating ${pendingLabel}`,
      async () => {
        const createdVm =
          selectedSource.kind === "vm" && selectedSource.sourceVm
            ? await postJson<VmInstance>(`/api/vms/${selectedSource.sourceVm.id}/clone`, {
                sourceVmId: selectedSource.sourceVm.id,
                name: requestedName,
                wallpaperName: createDraft.wallpaperName.trim() || requestedName,
                resources: requestedResources,
                networkMode: createDraft.networkMode,
                shutdownSourceBeforeClone: createDraft.shutdownSourceBeforeClone,
                stateful:
                  createDraft.statefulClone && !createDraft.shutdownSourceBeforeClone,
              })
            : await postJson<VmInstance>("/api/vms", {
                name: requestedName,
                wallpaperName: createDraft.wallpaperName.trim() || requestedName,
                resources: requestedResources,
                desktopTransport: createDraft.desktopTransport,
                networkMode: createDraft.networkMode,
                ...(selectedSource.kind === "snapshot"
                  ? { snapshotId: selectedSource.snapshot?.id }
                  : {
                      templateId: selectedSource.template.id,
                      initCommands: parseInitCommandsDraft(createDraft.initCommands),
                    }),
              } satisfies CreateVmInput);
        setCreateDirty(false);
        if (selectedSource.kind === "snapshot" && selectedSource.snapshot) {
          setCreateDraft(
            buildCreateDraftFromSnapshot(
              selectedSource.snapshot,
              selectedSource.template,
              selectedSource.sourceVm,
            ),
          );
        } else if (selectedSource.kind === "vm" && selectedSource.sourceVm) {
          setCreateDraft(
            buildCreateDraftFromVm(
              selectedSource.sourceVm,
              selectedSource.template,
            ),
          );
        } else {
          setCreateDraft(buildCreateDraftFromTemplate(selectedSource.template));
        }
        setVmSidepanelCollapsed(createdVm.id, false);
        setSelectedVmId(createdVm.id);
        setShowCreateDialog(false);
        await refreshSummary();
        await refreshDetail(createdVm.id);
      },
      selectedSource.kind === "snapshot"
        ? `Queued snapshot launch for ${pendingLabel}.`
        : selectedSource.kind === "vm"
          ? `Queued clone for ${pendingLabel}.`
          : `Queued create for ${pendingLabel}.`,
    );
  }

  function handleCreateField(field: keyof CreateDraft, value: string): void {
    setCreateDirty(true);
    setCreateDraft((current) => {
      switch (field) {
        case "launchSource":
          return {
            ...current,
            launchSource: value,
          };
        case "name":
          return {
            ...current,
            name: value,
          };
        case "wallpaperName":
          return current;
        case "cpu":
          return {
            ...current,
            cpu: value,
          };
        case "ramGb":
          return {
            ...current,
            ramGb: value,
          };
        case "diskGb":
          return {
            ...current,
            diskGb: value,
          };
        case "desktopTransport":
          return {
            ...current,
            desktopTransport: normalizeActiveVmDesktopTransport(value),
          };
        case "networkMode":
          return {
            ...current,
            networkMode: normalizeActiveVmNetworkMode(value),
          };
        case "initCommands":
          return {
            ...current,
            initCommands: value,
          };
        case "shutdownSourceBeforeClone":
        case "statefulClone":
          return current;
      }
    });
  }

  function handleCreateShutdownBeforeCloneChange(checked: boolean): void {
    setCreateDirty(true);
    setCreateDraft((current) => ({
      ...current,
      statefulClone: checked ? false : current.statefulClone,
      shutdownSourceBeforeClone: checked,
    }));
  }

  function handleCreateStatefulCloneChange(checked: boolean): void {
    setCreateDirty(true);
    setCreateDraft((current) => ({
      ...current,
      shutdownSourceBeforeClone: checked ? false : current.shutdownSourceBeforeClone,
      statefulClone: checked,
    }));
  }

  function randomizeCreateName(): void {
    const wallpaperName = buildRandomVmName();
    setCreateDirty(true);
    setCreateDraft((current) => ({
      ...current,
      name: wallpaperName,
      wallpaperName,
    }));
  }

  function handleCreateSourceChange(event: ChangeEvent<HTMLSelectElement>): void {
    if (!summary) {
      return;
    }

    const selectedSource = resolveCreateSourceSelection(
      summary.templates,
      summary.snapshots,
      summary.vms,
      event.target.value,
    );

    if (!selectedSource) {
      return;
    }

    setCreateDirty(false);
    setCreateDraft(
      buildCreateDraftFromSource(
        selectedSource,
        createDraft.name,
        createDraft.wallpaperName,
      ),
    );
  }

  function openCreateDialog(): void {
    const nextSource = summary
      ? resolveCreateSourceSelection(
          summary.templates,
          summary.snapshots,
          summary.vms,
          createDraft.launchSource,
        ) ?? firstCreateSourceSelection(summary.templates, summary.snapshots, summary.vms)
      : null;

    setCreateDirty(false);
    setCreateDraft(nextSource ? buildCreateDraftFromSource(nextSource) : emptyCreateDraft);
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setShowCreateDialog(true);
  }

  function openCreateDialogForTemplate(template: EnvironmentTemplate): void {
    setCreateDirty(false);
    setCreateDraft(buildCreateDraftFromTemplate(template));
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setShowCreateDialog(true);
  }

  function openTemplateCloneDialog(template: EnvironmentTemplate): void {
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setTemplateCloneDraft(buildTemplateCloneDraft(template));
  }

  function openTemplateEditDialog(template: EnvironmentTemplate): void {
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setTemplateEditDraft(buildTemplateEditDraft(template));
  }

  function closeTemplateEditDialog(): void {
    setTemplateEditDraft(null);
  }

  function handleTemplateEditField(
    field: keyof TemplateEditDraft,
    value: string,
  ): void {
    setTemplateEditDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  }

  function closeTemplateCloneDialog(): void {
    setTemplateCloneDraft(null);
  }

  function handleTemplateCloneField(
    field: keyof TemplateCloneDraft,
    value: string,
  ): void {
    setTemplateCloneDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  }

  function openVmLogsDialog(vm: VmInstance): void {
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setVmLogsDialog({
      error: null,
      loading: true,
      logs: null,
      refreshing: false,
      vmId: vm.id,
      vmName: vm.name,
    });
  }

  function closeVmLogsDialog(): void {
    setVmLogsDialog(null);
  }

  function refreshVmLogsDialog(): void {
    setVmLogsRefreshTick((current) => current + 1);
  }

  function closeCloneVmDialog(): void {
    setCloneVmDialog(null);
    setCloneVmDraft("");
  }

  function closeSnapshotDialog(): void {
    setSnapshotDialog(null);
  }

  function handleSnapshotLabelChange(value: string): void {
    setSnapshotDialog((current) =>
      current
        ? {
            ...current,
            label: value,
          }
        : current,
    );
  }

  function handleSnapshotStatefulChange(checked: boolean): void {
    setSnapshotDialog((current) =>
      current
        ? {
            ...current,
            stateful: current.canCaptureRam ? checked : false,
          }
        : current,
    );
  }

  function closeRenameDialog(): void {
    setRenameDialog(null);
    setRenameDraft("");
  }

  async function handleRenameVm(vm: VmInstance): Promise<void> {
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setRenameDialog({
      kind: "vm",
      id: vm.id,
      currentName: vm.name,
    });
    setRenameDraft(vm.name);
  }

  async function handleRenameTemplate(template: EnvironmentTemplate): Promise<void> {
    openTemplateEditDialog(template);
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!renameDialog) {
      return;
    }

    const name = renameDraft.trim();

    if (!name || name === renameDialog.currentName) {
      return;
    }

    if (renameDialog.kind === "vm") {
      await runMutation(
        `Renaming ${renameDialog.currentName}`,
        async () => {
          await postJson<VmInstance>(
            `/api/vms/${renameDialog.id}/update`,
            {
              name,
            } satisfies UpdateVmInput,
          );
          closeRenameDialog();
          await refreshSummary();
          if (selectedVmIdRef.current === renameDialog.id) {
            await refreshDetail(renameDialog.id);
          }
        },
        `Renamed workspace to ${name}.`,
      );
      return;
    }

    await runMutation(
      `Renaming ${renameDialog.currentName}`,
      async () => {
        await postJson<EnvironmentTemplate>(
          `/api/templates/${renameDialog.id}/update`,
          {
            name,
            description: renameDialog.description,
          } satisfies UpdateTemplateInput,
        );
        closeRenameDialog();
        await refreshSummary();
      },
      `Renamed template to ${name}.`,
    );
  }

  function activeCpuThresholdForVm(vmId: string): number {
    return normalizeActiveCpuThreshold(
      activeCpuThresholdsByVm[vmId] ?? activeCpuThresholdDefault,
    );
  }

  function handleSetActiveCpuThreshold(vm: VmInstance): void {
    const nextValue = window.prompt(
      "Active threshold (%)",
      String(activeCpuThresholdForVm(vm.id)),
    );

    if (nextValue === null) {
      return;
    }

    const parsed = Number(nextValue.replace(/%/gu, "").trim());

    if (!Number.isFinite(parsed)) {
      setNotice({
        tone: "error",
        message: "Active threshold must be a number between 0 and 100.",
      });
      return;
    }

    const nextThreshold = normalizeActiveCpuThreshold(parsed);
    setActiveCpuThresholdsByVm((current) => {
      if (nextThreshold === activeCpuThresholdDefault) {
        if (!(vm.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[vm.id];
        return next;
      }

      if (current[vm.id] === nextThreshold) {
        return current;
      }

      return {
        ...current,
        [vm.id]: nextThreshold,
      };
    });
  }

  async function handleEditTemplateSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!templateEditDraft) {
      return;
    }

    const name = templateEditDraft.name.trim();

    if (!name) {
      return;
    }

    await runMutation(
      `Updating ${templateEditDraft.name.trim() || "template"}`,
      async () => {
        await postJson<EnvironmentTemplate>(
          `/api/templates/${templateEditDraft.templateId}/update`,
          {
            name,
            description: templateEditDraft.description.trim(),
            initCommands: parseInitCommandsDraft(templateEditDraft.initCommands),
          } satisfies UpdateTemplateInput,
        );
        closeTemplateEditDialog();
        await refreshSummary();
      },
      `Updated template ${name}.`,
    );
  }

  async function handleTemplateCloneSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!templateCloneDraft) {
      return;
    }

    const payload: CreateTemplateInput = {
      sourceTemplateId: templateCloneDraft.sourceTemplateId,
      name: templateCloneDraft.name.trim(),
      description: templateCloneDraft.description.trim(),
      initCommands: parseInitCommandsDraft(templateCloneDraft.initCommands),
    };

    await runMutation(
      `Saving template ${payload.name || "template"}`,
      async () => {
        const createdTemplate = await postJson<EnvironmentTemplate>("/api/templates", payload);
        closeTemplateCloneDialog();
        await refreshSummary();
        setCreateDirty(false);
        setCreateDraft(buildCreateDraftFromTemplate(createdTemplate));
      },
      `Saved template ${payload.name}.`,
    );
  }

  async function handleDeleteTemplate(template: EnvironmentTemplate): Promise<void> {
    setOpenTemplateMenuId(null);

    const linkedVmCount =
      summary?.vms.filter((entry) => entry.templateId === template.id).length ?? 0;

    if (linkedVmCount > 0) {
      setNotice({
        tone: "error",
        message:
          `${template.name} is still attached to ${linkedVmCount} ` +
          `VM${linkedVmCount === 1 ? "" : "s"}. Delete those workspaces first.`,
      });
      return;
    }

    if (!window.confirm(`Delete template ${template.name}?`)) {
      return;
    }

    await runMutation(
      `Deleting ${template.name}`,
      async () => {
        await postJson(`/api/templates/${template.id}/delete`, {});
        await refreshSummary();
      },
      `Deleted template ${template.name}.`,
    );
  }

  function setVmSidepanelCollapsed(vmId: string, collapsed: boolean): void {
    setSidepanelCollapsedByVm((current) => {
      if (collapsed) {
        if (current[vmId]) {
          return current;
        }

        return {
          ...current,
          [vmId]: true,
        };
      }

      if (!current[vmId]) {
        return current;
      }

      const next = { ...current };
      delete next[vmId];
      return next;
    });
  }

  function setCurrentSidepanelCollapsed(collapsed: boolean): void {
    const activeVmId = selectedVmIdRef.current;

    if (activeVmId) {
      setVmSidepanelCollapsed(activeVmId, collapsed);
      return;
    }

    setOverviewSidepanelCollapsed(collapsed);
  }

  function setVmDesktopResolutionPreference(
    vmId: string,
    preference: DesktopResolutionPreference,
  ): void {
    const normalized = normalizeDesktopResolutionPreference(preference);

    setDesktopResolutionByVm((current) => {
      const existing = current[vmId];

      if (
        existing &&
        existing.mode === normalized.mode &&
        existing.scale === normalized.scale &&
        existing.width === normalized.width &&
        existing.height === normalized.height
      ) {
        return current;
      }

      return {
        ...current,
        [vmId]: normalized,
      };
    });
  }

  function applyViewportScalePreference(vmId: string, scaleValue: number): void {
    const requestedScale = Number.isFinite(scaleValue)
      ? scaleValue
      : appliedDesktopViewportScale;
    const nextScale = clampDesktopViewportScale(requestedScale);

    setVmDesktopResolutionPreference(vmId, {
      mode: "viewport",
      scale: nextScale,
      width: appliedDesktopWidth,
      height: appliedDesktopHeight,
    });
    setResolutionDraft((current) => ({
      ...current,
      mode: "viewport",
      scale: formatViewportScale(nextScale),
    }));
    lastResolutionRequestKeyRef.current = null;
  }

  function applyResolutionMode(vmId: string, mode: DesktopResolutionMode): void {
    if (mode === "viewport") {
      applyViewportScalePreference(vmId, Number(resolutionDraft.scale));
      return;
    }

    const requestedWidth = Number(resolutionDraft.width);
    const requestedHeight = Number(resolutionDraft.height);
    const nextWidth = Number.isFinite(requestedWidth)
      ? clampDesktopFixedWidth(requestedWidth)
      : appliedDesktopWidth;
    const nextHeight = Number.isFinite(requestedHeight)
      ? clampDesktopFixedHeight(requestedHeight)
      : appliedDesktopHeight;

    setVmDesktopResolutionPreference(vmId, {
      mode: "fixed",
      scale: appliedDesktopViewportScale,
      width: nextWidth,
      height: nextHeight,
    });
    setResolutionDraft(
      buildResolutionDraft(
        "fixed",
        appliedDesktopViewportScale,
        nextWidth,
        nextHeight,
      ),
    );
    lastResolutionRequestKeyRef.current = null;
  }

  function selectVm(vmId: string): void {
    setSelectedVmId(vmId);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
  }

  function openHomepage(): void {
    setSelectedVmId(null);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
    }
  }

  function inspectVm(vmId: string): void {
    setSelectedVmId(vmId);
    setVmSidepanelCollapsed(vmId, false);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
  }

  function currentVmRailIds(): string[] {
    return (summary?.vms ?? displayedVms).map((vm) => vm.id);
  }

  async function persistVmRailOrder(vmIds: string[]): Promise<void> {
    setVmReorderBusy(true);

    try {
      const nextSummary = await postJson<DashboardSummary>(
        "/api/vms/reorder",
        {
          vmIds,
        } satisfies ReorderVmsInput,
      );
      startTransition(() => {
        setSummary(nextSummary);
      });
      setVmRailOrderIds(null);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
      setVmRailOrderIds(null);
      await refreshSummary();
    } finally {
      setVmReorderBusy(false);
    }
  }

  function handleVmTileDragStart(
    vmId: string,
    event: ReactDragEvent<HTMLElement>,
  ): void {
    if (vmReorderBusy) {
      event.preventDefault();
      return;
    }

    vmDragDropCommittedRef.current = false;
    setDraggedVmId(vmId);
    setVmRailOrderIds(currentVmRailIds());
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", vmId);
  }

  function handleVmTileDragOver(
    targetVmId: string,
    event: ReactDragEvent<HTMLElement>,
  ): void {
    if (!draggedVmId || draggedVmId === targetVmId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setVmRailOrderIds((current) =>
      reorderVmIds(current ?? currentVmRailIds(), draggedVmId, targetVmId),
    );
  }

  function commitVmRailOrder(nextOrder: string[]): void {
    vmDragDropCommittedRef.current = true;
    setDraggedVmId(null);

    if (sameIdOrder(nextOrder, currentVmRailIds())) {
      setVmRailOrderIds(null);
      return;
    }

    setVmRailOrderIds(nextOrder);
    void persistVmRailOrder(nextOrder);
  }

  function handleVmStripDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (!draggedVmId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleVmStripDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (!draggedVmId) {
      return;
    }

    event.preventDefault();
    commitVmRailOrder(vmRailOrderIds ?? currentVmRailIds());
  }

  function handleVmTileDragEnd(): void {
    if (!vmDragDropCommittedRef.current) {
      setVmRailOrderIds(null);
    }

    setDraggedVmId(null);
  }

  function handleVmTileDrop(
    targetVmId: string,
    event: ReactDragEvent<HTMLElement>,
  ): void {
    if (!draggedVmId) {
      return;
    }

    event.preventDefault();
    const nextOrder = reorderVmIds(vmRailOrderIds ?? currentVmRailIds(), draggedVmId, targetVmId);
    event.stopPropagation();
    commitVmRailOrder(nextOrder);
  }

  function handleRailResizeStart(): void {
    if (!wideShellLayout) {
      return;
    }

    const panelLeft = railRef.current?.getBoundingClientRect().left;

    if (panelLeft === undefined) {
      return;
    }

    railResizeRef.current = { panelLeft };
    setRailResizeActive(true);
  }

  function handleRailResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!wideShellLayout) {
      return;
    }

    const currentWidth = railWidth;
    let nextWidth: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth =
          currentWidth <= railExpandedMinWidth ? railCompactWidth : currentWidth - 16;
        break;
      case "ArrowRight":
        nextWidth =
          currentWidth <= railCompactWidth ? railExpandedMinWidth : currentWidth + 16;
        break;
      case "Home":
        nextWidth = railCompactWidth;
        break;
      case "End":
        nextWidth = railMaxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (nextWidth === null) {
      return;
    }
    setRailWidthPreference(clampRailWidthPreference(nextWidth));
  }

  function handleSidepanelResizeStart(pointerClientX: number): void {
    if (compactSidepanelLayout) {
      return;
    }

    sidepanelResizeRef.current = {
      anchorClientX: pointerClientX,
      anchorWidth: displayedSidepanelWidth,
      pendingClosedOpen: false,
    };
    setSidepanelResizeActive(true);
  }

  function handleSidepanelClosedResizeStart(
    pointerClientX: number,
    handleCenterX: number,
  ): void {
    if (compactSidepanelLayout) {
      return;
    }

    const openingWidth = handleCenterX - pointerClientX;

    if (openingWidth >= sidepanelMinWidth) {
      const activatedWidth = clampDisplayedSidepanelWidth(openingWidth, viewportWidth);
      sidepanelResizeRef.current = {
        anchorClientX: pointerClientX,
        anchorWidth: activatedWidth,
        pendingClosedOpen: false,
      };
      setCurrentSidepanelCollapsed(false);
      setSidepanelWidthPreference(activatedWidth);
      setSidepanelResizeActive(true);
      return;
    }

    sidepanelResizeRef.current = {
      anchorClientX: handleCenterX,
      anchorWidth: sidepanelClosedWidth,
      pendingClosedOpen: true,
    };
    setCurrentSidepanelCollapsed(true);
    setSidepanelResizeActive(true);
  }

  function handleSidepanelResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (compactSidepanelLayout) {
      return;
    }

    const currentWidth = displayedSidepanelWidth;
    let nextWidth: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth =
          currentWidth <= sidepanelClosedWidth ? sidepanelMinWidth : currentWidth + 24;
        break;
      case "ArrowRight":
        nextWidth =
          currentWidth <= sidepanelMinWidth ? sidepanelClosedWidth : currentWidth - 24;
        break;
      case "Home":
        nextWidth = sidepanelClosedWidth;
        break;
      case "End":
        nextWidth = sidepanelMaxWidth;
        break;
      default:
        break;
    }

    if (nextWidth === null) {
      return;
    }

    event.preventDefault();
    const normalizedWidth = clampSidepanelWidthPreference(nextWidth);
    setCurrentSidepanelCollapsed(normalizedWidth === sidepanelClosedWidth);

    if (normalizedWidth > sidepanelClosedWidth) {
      setSidepanelWidthPreference(normalizedWidth);
    }
  }

  async function handleVmAction(
    vmId: string,
    action: VmPowerAction,
  ): Promise<void> {
    const vmName = summary?.vms.find((vm) => vm.id === vmId)?.name ?? vmId;

    await runMutation(
      `${action} ${vmName}`,
      async () => {
        await postJson(`/api/vms/${vmId}/${action}`, {});
        await refreshSummary();
        if (selectedVmIdRef.current === vmId) {
          await refreshDetail(vmId);
        }
      },
      `Queued ${action} for ${vmName}.`,
    );
  }

  async function handleClone(vm: VmInstance): Promise<void> {
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
    const wallpaperName = buildRandomVmName();
    setCloneVmDialog({
      canCaptureRam: vm.status === "running",
      ramMb: vm.resources.ramMb,
      sourceVmId: vm.id,
      sourceVmName: vm.name,
      sourceVmStatus: vm.status,
      stateful: vm.status === "running",
      wallpaperName,
    });
    setCloneVmDraft(wallpaperName);
  }

  function handleCloneStatefulChange(checked: boolean): void {
    setCloneVmDialog((current) =>
      current
        ? {
            ...current,
            stateful: current.canCaptureRam ? checked : false,
          }
        : current,
    );
  }

  async function handleCloneVmSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!cloneVmDialog) {
      return;
    }

    const name = cloneVmDraft.trim();

    if (!name) {
      return;
    }

    await runMutation(
      `Cloning ${cloneVmDialog.sourceVmName}`,
      async () => {
        const clone = await postJson<VmInstance>(`/api/vms/${cloneVmDialog.sourceVmId}/clone`, {
          sourceVmId: cloneVmDialog.sourceVmId,
          name,
          wallpaperName: cloneVmDialog.wallpaperName,
          stateful: cloneVmDialog.canCaptureRam ? cloneVmDialog.stateful : false,
        });
        closeCloneVmDialog();
        setVmSidepanelCollapsed(clone.id, false);
        setSelectedVmId(clone.id);
        await refreshSummary();
        await refreshDetail(clone.id);
      },
      `Queued clone for ${cloneVmDialog.sourceVmName}.`,
    );
  }

  async function handleSnapshot(vm: VmInstance): Promise<void> {
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
    setSnapshotDialog({
      canCaptureRam: vm.status === "running",
      label: buildDefaultSnapshotLabel(),
      ramMb: vm.resources.ramMb,
      stateful: vm.status === "running",
      vmId: vm.id,
      vmName: vm.name,
      vmStatus: vm.status,
    });
  }

  async function handleSnapshotSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!snapshotDialog) {
      return;
    }

    const dialog = snapshotDialog;
    const payload: SnapshotInput = {
      label: dialog.label.trim() || undefined,
      stateful: dialog.canCaptureRam ? dialog.stateful : false,
    };

    await runMutation(
      `Snapshotting ${dialog.vmName}`,
      async () => {
        await postJson(`/api/vms/${dialog.vmId}/snapshot`, payload);
        closeSnapshotDialog();
        await refreshSummary();
        if (selectedVmIdRef.current === dialog.vmId) {
          await refreshDetail(dialog.vmId);
        }
      },
      `Queued snapshot for ${dialog.vmName}.`,
    );
  }

  async function handleDelete(vm: VmInstance): Promise<void> {
    if (!window.confirm(`Delete ${vm.name}?`)) {
      return;
    }

    await runMutation(
      `Deleting ${vm.name}`,
      async () => {
        await postJson(`/api/vms/${vm.id}/delete`, {});
        if (selectedVmIdRef.current === vm.id) {
          setSelectedVmId(null);
          setDetail(null);
        }
        await refreshSummary();
      },
      `Queued delete for ${vm.name}.`,
    );
  }

  return {
    activeCpuThresholdForVm,
    applyResolutionMode,
    applyViewportScalePreference,
    closeCloneVmDialog,
    closeRenameDialog,
    closeSnapshotDialog,
    closeTemplateCloneDialog,
    closeTemplateEditDialog,
    closeVmLogsDialog,
    commitVmRailOrder,
    currentVmRailIds,
    handleClone,
    handleCloneVmSubmit,
    handleCloneStatefulChange,
    handleCreate,
    handleCreateField,
    handleCreateShutdownBeforeCloneChange,
    handleCreateStatefulCloneChange,
    handleCreateSourceChange,
    randomizeCreateName,
    handleDelete,
    handleDeleteTemplate,
    handleEditTemplateSubmit,
    handleLogout,
    handleRailResizeKeyDown,
    handleRailResizeStart,
    handleRenameSubmit,
    handleRenameTemplate,
    handleRenameVm,
    handleSetActiveCpuThreshold,
    handleSidepanelClosedResizeStart,
    handleSidepanelResizeKeyDown,
    handleSidepanelResizeStart,
    handleSnapshot,
    handleSnapshotLabelChange,
    handleSnapshotStatefulChange,
    handleSnapshotSubmit,
    handleTemplateCloneField,
    handleTemplateCloneSubmit,
    handleTemplateEditField,
    handleVmAction,
    handleVmStripDragOver,
    handleVmStripDrop,
    handleVmTileDragEnd,
    handleVmTileDragOver,
    handleVmTileDragStart,
    handleVmTileDrop,
    inspectVm,
    openCreateDialog,
    openCreateDialogForTemplate,
    openHomepage,
    openTemplateCloneDialog,
    openTemplateEditDialog,
    openVmLogsDialog,
    refreshDetail,
    refreshHealth,
    refreshSummary,
    refreshVmFileBrowserSnapshot,
    refreshVmLogsDialog,
    refreshVmTouchedFilesSnapshot,
    requireLogin,
    runMutation,
    selectVm,
    setCurrentSidepanelCollapsed,
    setVmDesktopResolutionPreference,
    setVmSidepanelCollapsed,
    toggleFullscreen,
  };
}

function normalizeActiveVmNetworkMode(value: string): CreateDraft["networkMode"] {
  return value === "dmz" ? "dmz" : "default";
}

function normalizeActiveVmDesktopTransport(value: string): CreateDraft["desktopTransport"] {
  return value === "selkies" || value === "guacamole" ? value : "vnc";
}
