import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type JSX,
} from "react";

import type {
  DashboardSummary,
  VmInstance,
  VmPowerAction,
  WorkspaceProject,
} from "../../../packages/shared/src/types.js";

import { RailCreateIcon, RailHomeIcon, RailSettingsIcon, VmTile } from "./dashboardRail.js";
import {
  activeCpuThresholdDefault,
  buildWorkspaceProjectGroups,
} from "./dashboardHelpers.js";
import { providerStatusDotClassName, providerStatusTitle } from "./dashboardHelpers.js";
import type { ThemeMode } from "./dashboardShell.js";
import { RailResizeHandle } from "./dashboardSidepanel.js";
import {
  formatRamUsage,
  joinClassNames,
  PortalPopover,
  TelemetryPanel,
} from "./dashboardUi.js";

interface DashboardWorkspaceRailProps {
  summary: DashboardSummary;
  appVersionLabel: string;
  authEnabled: boolean;
  collapsedProjects: Record<string, true>;
  compactRail: boolean;
  draggedVmId: string | null;
  effectiveSidePanelCollapsed: boolean;
  fullscreenActive: boolean;
  isBusy: boolean;
  latestReleaseHref: string | null;
  newerReleaseAvailable: boolean;
  openProjectMenuId: string | null;
  openVmMenuId: string | null;
  railRef: RefObject<HTMLElement | null>;
  railResizeActive: boolean;
  railWidth: number;
  releaseIndicatorSeverity: string | null;
  renderedVms: VmInstance[];
  selectedVmId: string | null;
  shellMenuButtonRef: RefObject<HTMLButtonElement | null>;
  shellMenuOpen: boolean;
  showLivePreviews: boolean;
  supportsLiveDesktop: boolean;
  themeMode: ThemeMode;
  wideShellLayout: boolean;
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onHideInspector: (vmId: string) => void;
  onLogout: () => void;
  onOpenCreateDialog: (projectId?: string) => void;
  onOpenCreateProjectDialog: () => void;
  onEditProject: (project: WorkspaceProject) => void;
  onOpenHomepage: () => void;
  onOpenLogs: (vm: VmInstance) => void;
  onPasteLocal: (vm: VmInstance) => void;
  onInspectVm: (vmId: string) => void;
  onProjectAction: (
    project: WorkspaceProject,
    action: "start" | "stop" | "restart" | "delete",
  ) => Promise<void>;
  onProjectDragOver: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectDrop: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectVmListDragOver: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectVmListDrop: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectMenuToggle: (projectId: string) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: () => void;
  onToggleCompactRail: () => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onSelectVm: (vmId: string) => void;
  onSetActiveCpuThreshold: (vm: VmInstance) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onToggleFullscreen: () => void;
  onToggleLivePreviews: () => void;
  onToggleShellMenu: () => void;
  onCloseShellMenu: () => void;
  onToggleTheme: () => void;
  onVmMenuToggle: (vmId: string) => void;
  onPowerAction: (vmId: string, action: VmPowerAction) => Promise<void>;
  onVmTileDragEnd: () => void;
  onVmTileDragOver: (targetVmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmTileDragStart: (vmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmTileDrop: (targetVmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmStripDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onVmStripDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  resolveActiveCpuThreshold: (vmId: string) => number;
  resolveMirroredStageFrameRef: (vmId: string) => RefObject<HTMLIFrameElement | null> | null;
}

interface ProjectSectionProps {
  collapsed: boolean;
  compact: boolean;
  draggedVmId: string | null;
  effectiveSidePanelCollapsed: boolean;
  isBusy: boolean;
  menuOpen: boolean;
  openVmMenuId: string | null;
  project: WorkspaceProject;
  selectedVmId: string | null;
  showLivePreviews: boolean;
  vms: VmInstance[];
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onHideInspector: (vmId: string) => void;
  onOpenCreateDialog: (projectId?: string) => void;
  onEditProject: (project: WorkspaceProject) => void;
  onOpenLogs: (vm: VmInstance) => void;
  onPasteLocal: (vm: VmInstance) => void;
  onInspectVm: (vmId: string) => void;
  onProjectAction: (
    project: WorkspaceProject,
    action: "start" | "stop" | "restart" | "delete",
  ) => Promise<void>;
  onProjectDragOver: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectDrop: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectVmListDragOver: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectVmListDrop: (projectId: string, event: React.DragEvent<HTMLElement>) => void;
  onProjectMenuToggle: (projectId: string) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onSelectVm: (vmId: string) => void;
  onSetActiveCpuThreshold: (vm: VmInstance) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onToggleCollapsed: (projectId: string) => void;
  onVmMenuToggle: (vmId: string) => void;
  onPowerAction: (vmId: string, action: VmPowerAction) => Promise<void>;
  onVmTileDragEnd: () => void;
  onVmTileDragOver: (targetVmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmTileDragStart: (vmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmTileDrop: (targetVmId: string, event: React.DragEvent<HTMLElement>) => void;
  resolveActiveCpuThreshold: (vmId: string) => number;
  resolveMirroredStageFrameRef: (vmId: string) => RefObject<HTMLIFrameElement | null> | null;
}

export function collectRunningWorkspaceUsage(
  vms: VmInstance[],
): { cpu: number; ramMb: number } {
  return vms.reduce(
    (usage, vm) => {
      if (vm.status !== "running") {
        return usage;
      }

      usage.cpu += vm.resources.cpu;
      usage.ramMb += vm.resources.ramMb;
      return usage;
    },
    { cpu: 0, ramMb: 0 },
  );
}

function ProjectChevronIcon({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={joinClassNames(
        "workspace-project__chevron",
        collapsed ? "workspace-project__chevron--collapsed" : "",
      )}
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="m5 3.75 5 4.25-5 4.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function ProjectSection({
  collapsed,
  compact,
  draggedVmId,
  effectiveSidePanelCollapsed,
  isBusy,
  menuOpen,
  openVmMenuId,
  project,
  selectedVmId,
  showLivePreviews,
  vms,
  onClone,
  onDelete,
  onHideInspector,
  onOpenCreateDialog,
  onEditProject,
  onOpenLogs,
  onPasteLocal,
  onInspectVm,
  onProjectAction,
  onProjectDragOver,
  onProjectDrop,
  onProjectVmListDragOver,
  onProjectVmListDrop,
  onProjectMenuToggle,
  onRename,
  onSelectVm,
  onSetActiveCpuThreshold,
  onSnapshot,
  onToggleCollapsed,
  onVmMenuToggle,
  onPowerAction,
  onVmTileDragEnd,
  onVmTileDragOver,
  onVmTileDragStart,
  onVmTileDrop,
  resolveActiveCpuThreshold,
  resolveMirroredStageFrameRef,
}: ProjectSectionProps): JSX.Element {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const runningVmCount = vms.filter((vm) => vm.status === "running").length;
  const projectBusy = isBusy || project.status === "deleting";
  const githubLabel = project.githubUrl.replace(/^https?:\/\//u, "");

  return (
    <section
      className={joinClassNames(
        "workspace-project",
        collapsed ? "workspace-project--collapsed" : "",
        compact ? "workspace-project--compact" : "",
        project.status === "deleting" ? "workspace-project--deleting" : "",
      )}
      onDragOver={(event) => onProjectDragOver(project.id, event)}
      onDrop={(event) => onProjectDrop(project.id, event)}
    >
      <div className="workspace-project__header">
        <button
          className="workspace-project__toggle"
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(project.id)}
        >
          <ProjectChevronIcon collapsed={collapsed} />
          <span className="workspace-project__copy">
            <span className="workspace-project__title-row">
              <span className="workspace-project__title">{project.name}</span>
              <span className="workspace-project__count">
                {project.status === "deleting" ? "Deleting" : `(${runningVmCount}/${vms.length})`}
              </span>
            </span>
            {!compact ? (
              project.githubUrl ? (
                <a
                  className="workspace-project__github"
                  href={project.githubUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(event) => event.stopPropagation()}
                >
                  {githubLabel}
                </a>
              ) : null
            ) : null}
          </span>
        </button>

        <div className="workspace-project__actions">
          <div
            className="workspace-project__menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              ref={menuButtonRef}
              className={joinClassNames("menu-button", menuOpen ? "menu-button--open" : "")}
              type="button"
              aria-expanded={menuOpen}
              aria-label={`Actions for ${project.name}`}
              onClick={() => onProjectMenuToggle(project.id)}
            >
              ...
            </button>

            {menuOpen ? (
              <PortalPopover
                anchorPlacement={compact ? "right-start" : "bottom-end"}
                anchorRef={menuButtonRef}
                className="workspace-rail__popover workspace-project__popover"
                open={menuOpen}
                onClose={() => onProjectMenuToggle(project.id)}
              >
                <button
                  className="menu-action"
                  type="button"
                  disabled={projectBusy}
                  onClick={() => {
                    onProjectMenuToggle(project.id);
                    onOpenCreateDialog(project.id);
                  }}
                >
                  New VM
                </button>
                <button
                  className="menu-action"
                  type="button"
                  disabled={projectBusy || vms.length === 0}
                  onClick={() => void onProjectAction(project, "start")}
                >
                  Start all
                </button>
                <button
                  className="menu-action"
                  type="button"
                  disabled={projectBusy || vms.length === 0}
                  onClick={() => void onProjectAction(project, "stop")}
                >
                  Stop all
                </button>
                <button
                  className="menu-action"
                  type="button"
                  disabled={projectBusy || vms.length === 0}
                  onClick={() => void onProjectAction(project, "restart")}
                >
                  Restart all
                </button>
                <button
                  className="menu-action"
                  type="button"
                  disabled={projectBusy}
                  onClick={() => onEditProject(project)}
                >
                  Edit project...
                </button>
                {project.id !== "project-default" ? (
                  <button
                    className="menu-action menu-action--danger"
                    type="button"
                    disabled={projectBusy}
                    onClick={() => void onProjectAction(project, "delete")}
                  >
                    Delete
                  </button>
                ) : null}
              </PortalPopover>
            ) : null}
          </div>
        </div>
      </div>

      {!collapsed ? (
        <div
          className="workspace-project__vms"
          onDragOver={(event) => onProjectVmListDragOver(project.id, event)}
          onDrop={(event) => onProjectVmListDrop(project.id, event)}
        >
          {vms.length > 0 ? (
            vms.map((vm) => (
              <VmTile
                key={vm.id}
                activeCpuThresholdPercent={resolveActiveCpuThreshold(vm.id)}
                busy={isBusy}
                compact={compact}
                dragging={draggedVmId === vm.id}
                inspectorVisible={vm.id === selectedVmId && !effectiveSidePanelCollapsed}
                menuOpen={openVmMenuId === vm.id}
                mirroredStageFrameRef={resolveMirroredStageFrameRef(vm.id)}
                selected={vm.id === selectedVmId}
                showLivePreview={showLivePreviews}
                vm={vm}
                onDragEnd={onVmTileDragEnd}
                onDragOver={onVmTileDragOver}
                onDragStart={onVmTileDragStart}
                onDrop={onVmTileDrop}
                onClone={onClone}
                onDelete={onDelete}
                onHideInspector={() => onHideInspector(vm.id)}
                onOpen={onSelectVm}
                onInspect={onInspectVm}
                onOpenLogs={onOpenLogs}
                onPasteLocal={onPasteLocal}
                onRename={onRename}
                onSetActiveCpuThreshold={onSetActiveCpuThreshold}
                onSnapshot={onSnapshot}
                onPowerAction={onPowerAction}
                onToggleMenu={onVmMenuToggle}
              />
            ))
          ) : compact ? (
            <button
              className="workspace-rail__icon-button workspace-project__empty-compact-action"
              type="button"
              aria-label={`New VM in ${project.name}`}
              title={`New VM in ${project.name}`}
              onClick={() => onOpenCreateDialog(project.id)}
              disabled={projectBusy}
            >
              <RailCreateIcon />
            </button>
          ) : (
            <div className="empty-state workspace-project__empty">
              <p className="empty-state__eyebrow">No VMs in {project.name}</p>
              <h3 className="empty-state__title">Launch a workspace to start this project.</h3>
              <p className="empty-state__copy">
                Each project keeps its own VM list and bulk controls scoped to that group.
              </p>
              <button
                className="button workspace-project__empty-action"
                type="button"
                onClick={() => onOpenCreateDialog(project.id)}
                disabled={projectBusy}
              >
                New VM
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function DashboardWorkspaceRail({
  summary,
  appVersionLabel,
  authEnabled,
  collapsedProjects,
  compactRail,
  draggedVmId,
  effectiveSidePanelCollapsed,
  fullscreenActive,
  isBusy,
  latestReleaseHref,
  newerReleaseAvailable,
  openProjectMenuId,
  openVmMenuId,
  railRef,
  railResizeActive,
  railWidth,
  releaseIndicatorSeverity,
  renderedVms,
  selectedVmId,
  shellMenuButtonRef,
  shellMenuOpen,
  showLivePreviews,
  supportsLiveDesktop,
  themeMode,
  wideShellLayout,
  onClone,
  onDelete,
  onHideInspector,
  onLogout,
  onOpenCreateDialog,
  onOpenCreateProjectDialog,
  onEditProject,
  onOpenHomepage,
  onOpenLogs,
  onPasteLocal,
  onInspectVm,
  onProjectAction,
  onProjectDragOver,
  onProjectDrop,
  onProjectVmListDragOver,
  onProjectVmListDrop,
  onProjectMenuToggle,
  onRename,
  onResizeKeyDown,
  onResizePointerDown,
  onToggleCompactRail,
  onToggleProjectCollapsed,
  onSelectVm,
  onSetActiveCpuThreshold,
  onSnapshot,
  onToggleFullscreen,
  onToggleLivePreviews,
  onToggleShellMenu,
  onCloseShellMenu,
  onToggleTheme,
  onVmMenuToggle,
  onPowerAction,
  onVmTileDragEnd,
  onVmTileDragOver,
  onVmTileDragStart,
  onVmTileDrop,
  onVmStripDragOver,
  onVmStripDrop,
  resolveActiveCpuThreshold,
  resolveMirroredStageFrameRef,
}: DashboardWorkspaceRailProps): JSX.Element {
  const runningUsage = collectRunningWorkspaceUsage(summary.vms);
  const projectGroups = buildWorkspaceProjectGroups(summary.projects, renderedVms);

  return (
    <aside
      ref={railRef}
      className={joinClassNames(
        "workspace-rail",
        compactRail ? "workspace-rail--compact" : "",
        railResizeActive ? "workspace-rail--resizing" : "",
      )}
    >
      <RailResizeHandle
        collapsed={compactRail}
        resizable={wideShellLayout}
        resizing={railResizeActive}
        width={railWidth}
        onResizeKeyDown={onResizeKeyDown}
        onResizePointerDown={onResizePointerDown}
        onToggleCollapsed={onToggleCompactRail}
      />

      <div className="workspace-rail__header">
        <div className="workspace-rail__brand">
          {compactRail ? (
            <div className="workspace-rail__compact-actions">
              <button
                className="workspace-rail__icon-button"
                type="button"
                aria-label="Home"
                title={`Home · ${providerStatusTitle(summary.provider)}`}
                onClick={onOpenHomepage}
              >
                <span className="workspace-rail__icon-shell">
                  <RailHomeIcon />
                  <span
                    className={joinClassNames(
                      "workspace-rail__status-dot",
                      "workspace-rail__status-dot--compact",
                      providerStatusDotClassName(summary.provider),
                    )}
                    aria-hidden="true"
                  />
                </span>
              </button>
              <button
                ref={shellMenuButtonRef}
                className={joinClassNames(
                  "workspace-rail__icon-button",
                  "workspace-rail__menu-button",
                  shellMenuOpen ? "workspace-rail__icon-button--open" : "",
                )}
                type="button"
                aria-expanded={shellMenuOpen}
                aria-label="Display and project options"
                title="Display and project options"
                onClick={onToggleShellMenu}
              >
                <RailSettingsIcon />
              </button>
            </div>
          ) : (
            <>
              <div className="workspace-rail__topbar">
                <div className="workspace-rail__home-link-group">
                  <button
                    className="workspace-shell__eyebrow workspace-rail__home-link"
                    type="button"
                    title={providerStatusTitle(summary.provider)}
                    onClick={onOpenHomepage}
                  >
                    <span
                      className={joinClassNames(
                        "workspace-rail__status-dot",
                        providerStatusDotClassName(summary.provider),
                      )}
                      aria-hidden="true"
                    />
                    <span className="brand-wordmark" aria-label="Parallaize">
                      <span>Parall</span>
                      <span className="brand-wordmark__accent">ai</span>
                      <span>ze</span>
                    </span>
                  </button>
                  <span
                    className="workspace-rail__brand-lockup"
                    aria-label={`Version ${appVersionLabel}`}
                  >
                    <span className="workspace-rail__brand-version">{appVersionLabel}</span>
                    {newerReleaseAvailable && latestReleaseHref ? (
                      <a
                        className={`workspace-rail__brand-release-indicator${releaseIndicatorSeverity ? ` workspace-rail__brand-release-indicator--${releaseIndicatorSeverity}` : ""}`}
                        href={latestReleaseHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="New version available!"
                        title="New version available!"
                      >
                        !
                      </a>
                    ) : null}
                  </span>
                </div>
                <button
                  ref={shellMenuButtonRef}
                  className={joinClassNames(
                    "menu-button",
                    "workspace-rail__menu-button",
                    shellMenuOpen ? "menu-button--open" : "",
                  )}
                  type="button"
                  aria-expanded={shellMenuOpen}
                  aria-label="Display and project options"
                  onClick={onToggleShellMenu}
                >
                  ...
                </button>
              </div>

              <div className="chip-row workspace-rail__chips">
                <span className="surface-pill">
                  {runningUsage.cpu}/{summary.metrics.hostCpuCount} CPU
                </span>
                <span className="surface-pill">
                  {formatRamUsage(runningUsage.ramMb, summary.metrics.hostRamMb)}
                </span>
              </div>

              <TelemetryPanel
                activeCpuThresholdPercent={activeCpuThresholdDefault}
                label="Host"
                telemetry={summary.hostTelemetry}
              />
            </>
          )}
        </div>
      </div>

      <PortalPopover
        anchorPlacement={compactRail ? "bottom-start" : "bottom-end"}
        anchorRef={shellMenuButtonRef}
        className="workspace-rail__popover"
        open={shellMenuOpen}
        onClose={onCloseShellMenu}
      >
        <button
          className="menu-action"
          type="button"
          onClick={onOpenCreateProjectDialog}
        >
          New project
        </button>

        {supportsLiveDesktop ? (
          <button
            className={joinClassNames(
              "menu-action",
              "menu-action--split",
              showLivePreviews ? "menu-action--selected" : "",
            )}
            type="button"
            onClick={onToggleLivePreviews}
          >
            <span>Live previews</span>
            <span className="menu-action__state">{showLivePreviews ? "On" : "Off"}</span>
          </button>
        ) : (
          <button className="menu-action menu-action--split" type="button" disabled>
            <span>Live previews</span>
            <span className="menu-action__state">Unavailable</span>
          </button>
        )}

        <button
          className="menu-action menu-action--split"
          type="button"
          onClick={onToggleTheme}
        >
          <span>Theme</span>
          <span className="menu-action__state">
            {themeMode === "dark" ? "Dark" : "Light"}
          </span>
        </button>

        <button
          className="menu-action menu-action--split"
          type="button"
          onClick={onToggleFullscreen}
        >
          <span>Fullscreen</span>
          <span className="menu-action__state">{fullscreenActive ? "On" : "Off"}</span>
        </button>

        {authEnabled ? (
          <button
            className="menu-action"
            type="button"
            onClick={onLogout}
          >
            Log out
          </button>
        ) : null}
      </PortalPopover>

      {!compactRail ? (
        <div className="workspace-rail__list-head">
          <p className="workspace-shell__eyebrow">
            Projects ({summary.projects.length})
          </p>
        </div>
      ) : null}

      <div
        className="vm-strip"
        onDragOver={onVmStripDragOver}
        onDrop={onVmStripDrop}
      >
        {projectGroups.map(({ project, vms }) => (
          <ProjectSection
            key={project.id}
            collapsed={collapsedProjects[project.id] === true}
            compact={compactRail}
            draggedVmId={draggedVmId}
            effectiveSidePanelCollapsed={effectiveSidePanelCollapsed}
            isBusy={isBusy}
            menuOpen={openProjectMenuId === project.id}
            openVmMenuId={openVmMenuId}
            project={project}
            selectedVmId={selectedVmId}
            showLivePreviews={showLivePreviews}
            vms={vms}
            onClone={onClone}
            onDelete={onDelete}
            onHideInspector={onHideInspector}
            onOpenCreateDialog={onOpenCreateDialog}
            onEditProject={onEditProject}
            onOpenLogs={onOpenLogs}
            onPasteLocal={onPasteLocal}
            onInspectVm={onInspectVm}
            onProjectAction={onProjectAction}
            onProjectDragOver={onProjectDragOver}
            onProjectDrop={onProjectDrop}
            onProjectVmListDragOver={onProjectVmListDragOver}
            onProjectVmListDrop={onProjectVmListDrop}
            onProjectMenuToggle={onProjectMenuToggle}
            onRename={onRename}
            onSelectVm={onSelectVm}
            onSetActiveCpuThreshold={onSetActiveCpuThreshold}
            onSnapshot={onSnapshot}
            onToggleCollapsed={onToggleProjectCollapsed}
            onVmMenuToggle={onVmMenuToggle}
            onPowerAction={onPowerAction}
            onVmTileDragEnd={onVmTileDragEnd}
            onVmTileDragOver={onVmTileDragOver}
            onVmTileDragStart={onVmTileDragStart}
            onVmTileDrop={onVmTileDrop}
            resolveActiveCpuThreshold={resolveActiveCpuThreshold}
            resolveMirroredStageFrameRef={resolveMirroredStageFrameRef}
          />
        ))}
      </div>
    </aside>
  );
}
