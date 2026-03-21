import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from "react";

import {
  formatRam,
  formatResources,
  formatTimestamp,
} from "../../../packages/shared/src/helpers.js";
import type {
  AuthStatus,
  ApiResponse,
  CaptureTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  InjectCommandInput,
  ResizeVmInput,
  SnapshotInput,
  TemplatePortForward,
  VmDetail,
  VmInstance,
  VmPortForward,
  VmStatus,
} from "../../../packages/shared/src/types.js";
import { NoVncViewport } from "./NoVncViewport.js";

interface CreateDraft {
  templateId: string;
  name: string;
  cpu: string;
  ramMb: string;
  diskGb: string;
}

interface ResourceDraft {
  cpu: string;
  ramMb: string;
  diskGb: string;
}

interface ForwardDraft {
  name: string;
  guestPort: string;
  description: string;
}

interface CaptureDraft {
  mode: "existing" | "new";
  templateId: string;
  name: string;
  description: string;
}

interface Notice {
  tone: "error" | "info" | "success";
  message: string;
}

interface LoginDraft {
  username: string;
  password: string;
}

type ThemeMode = "light" | "dark";

const emptyCreateDraft: CreateDraft = {
  templateId: "",
  name: "",
  cpu: "",
  ramMb: "",
  diskGb: "",
};

const emptyResourceDraft: ResourceDraft = {
  cpu: "",
  ramMb: "",
  diskGb: "",
};

const emptyForwardDraft: ForwardDraft = {
  name: "",
  guestPort: "",
  description: "",
};

const emptyCaptureDraft: CaptureDraft = {
  mode: "existing",
  templateId: "",
  name: "",
  description: "",
};

const defaultLoginDraft: LoginDraft = {
  username: "admin",
  password: "",
};

const quickCommands = ["pwd", "ls -la", "pnpm build", "pnpm test", "incus list"];

export function DashboardApp(): JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VmDetail | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createDirty, setCreateDirty] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(emptyResourceDraft);
  const [commandDraft, setCommandDraft] = useState("");
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft>(emptyForwardDraft);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft>(emptyCaptureDraft);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [openVmMenuId, setOpenVmMenuId] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [showLivePreviews, setShowLivePreviews] = useState(() =>
    readStoredBoolean("parallaize.live-previews", true),
  );
  const [authState, setAuthState] = useState<"checking" | "ready" | "required">("checking");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loginDraft, setLoginDraft] = useState<LoginDraft>(defaultLoginDraft);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const selectedVmIdRef = useRef<string | null>(null);

  const deferredVms = useDeferredValue(summary?.vms ?? []);
  const deferredTemplates = useDeferredValue(summary?.templates ?? []);
  const selectedVm =
    summary?.vms.find((entry) => entry.id === selectedVmId) ?? detail?.vm ?? null;
  const isBusy = busyLabel !== null;
  const currentDetail = selectedVm && detail?.vm.id === selectedVm.id ? detail : null;
  const providerReady = summary?.provider.available ?? false;
  const supportsLiveDesktop = summary?.provider.desktopTransport === "novnc";

  useEffect(() => {
    selectedVmIdRef.current = selectedVmId;
  }, [selectedVmId]);

  useEffect(() => {
    const vmId = new URL(window.location.href).searchParams.get("vm");
    if (vmId) {
      setSelectedVmId(vmId);
    }

    void (async () => {
      try {
        const status = await fetchJson<AuthStatus>("/api/auth/status");
        setAuthEnabled(status.authEnabled);
        if (status.authEnabled) {
          setLoginDraft((current) => ({
            ...current,
            username: status.username ?? current.username,
          }));
        }

        if (status.authEnabled && !status.authenticated) {
          setAuthState("required");
          return;
        }

        await refreshSummary();
      } catch (error: unknown) {
        setNotice({
          tone: "error",
          message: errorMessage(error),
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (authState !== "ready") {
      return;
    }

    const eventSource = new EventSource("/events");

    eventSource.addEventListener("summary", (event) => {
      const nextSummary = JSON.parse((event as MessageEvent<string>).data) as DashboardSummary;

      startTransition(() => {
        setSummary(nextSummary);
      });

      const currentVmId = selectedVmIdRef.current;

      if (currentVmId && !nextSummary.vms.some((vm) => vm.id === currentVmId)) {
        setSelectedVmId(null);
        setDetail(null);
        setSidePanelCollapsed(false);
      }
    });

    eventSource.addEventListener("error", () => {
      setNotice({
        tone: "info",
        message: "Live updates disconnected. The dashboard is retrying automatically.",
      });
    });

    return () => {
      eventSource.close();
    };
  }, [authState]);

  useEffect(() => {
    if (!summary?.templates.length) {
      return;
    }

    setCreateDraft((current) => syncCreateDraft(current, summary.templates, createDirty));
  }, [summary?.templates, createDirty]);

  useEffect(() => {
    if (!selectedVmId) {
      setDetail(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextDetail = await fetchJson<VmDetail>(`/api/vms/${selectedVmId}`);

        if (!cancelled) {
          setDetail(nextDetail);
        }
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        if (!cancelled) {
          setNotice({
            tone: "error",
            message: errorMessage(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedVmId, summary?.generatedAt]);

  useEffect(() => {
    if (!detail) {
      setResourceDraft(emptyResourceDraft);
      setCaptureDraft(emptyCaptureDraft);
      setForwardDraft(emptyForwardDraft);
      return;
    }

    setResourceDraft({
      cpu: String(detail.vm.resources.cpu),
      ramMb: String(detail.vm.resources.ramMb),
      diskGb: String(detail.vm.resources.diskGb),
    });
    setCaptureDraft(buildCaptureDraft(detail.template, detail.vm));
    setForwardDraft(emptyForwardDraft);
  }, [detail?.vm.id, detail?.generatedAt]);

  useEffect(() => {
    if (!selectedVmId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("vm");
      window.history.replaceState({}, "", url);
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("vm", selectedVmId);
    window.history.replaceState({}, "", url);
  }, [selectedVmId]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, notice.tone === "error" ? 6_500 : 3_600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    writeStoredString("parallaize.theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    writeStoredString(
      "parallaize.live-previews",
      showLivePreviews ? "true" : "false",
    );
  }, [showLivePreviews]);

  async function refreshSummary(): Promise<DashboardSummary> {
    const nextSummary = await fetchJson<DashboardSummary>("/api/summary");
    startTransition(() => {
      setSummary(nextSummary);
    });
    setAuthState("ready");
    return nextSummary;
  }

  async function refreshDetail(vmId: string): Promise<void> {
    setDetail(await fetchJson<VmDetail>(`/api/vms/${vmId}`));
  }

  function requireLogin(): void {
    setAuthState("required");
    setSummary(null);
    setDetail(null);
    setNotice(null);
    setBusyLabel(null);
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

    const payload: CreateVmInput = {
      templateId: createDraft.templateId,
      name: createDraft.name.trim(),
      resources: {
        cpu: Number(createDraft.cpu),
        ramMb: Number(createDraft.ramMb),
        diskGb: Number(createDraft.diskGb),
      },
    };

    await runMutation(
      `Creating ${payload.name || "workspace"}`,
      async () => {
        const createdVm = await postJson<VmInstance>("/api/vms", payload);
        setCreateDirty(false);
        const template = summary?.templates.find((entry) => entry.id === payload.templateId) ?? null;
        if (template) {
          setCreateDraft(buildCreateDraft(template));
        }
        setSelectedVmId(createdVm.id);
        setShowCreateDialog(false);
        setSidePanelCollapsed(false);
        await refreshSummary();
        await refreshDetail(createdVm.id);
      },
      `Queued create for ${payload.name}.`,
    );
  }

  function handleCreateField(field: keyof CreateDraft, value: string): void {
    setCreateDirty(true);
    setCreateDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleTemplateChange(event: ChangeEvent<HTMLSelectElement>): void {
    if (!summary) {
      return;
    }

    const template = summary.templates.find((entry) => entry.id === event.target.value);

    if (!template) {
      return;
    }

    setCreateDirty(false);
    setCreateDraft(buildCreateDraft(template, createDraft.name));
  }

  function selectVm(vmId: string): void {
    setSelectedVmId(vmId);
    setSidePanelCollapsed(false);
    setOpenVmMenuId(null);
  }

  async function handleVmAction(
    vmId: string,
    action: "start" | "stop",
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
    const name = window.prompt("Clone name", `${vm.name}-clone`)?.trim();

    if (!name) {
      return;
    }

    await runMutation(
      `Cloning ${vm.name}`,
      async () => {
        const clone = await postJson<VmInstance>(`/api/vms/${vm.id}/clone`, {
          sourceVmId: vm.id,
          name,
        });
        setSelectedVmId(clone.id);
        setSidePanelCollapsed(false);
        await refreshSummary();
        await refreshDetail(clone.id);
      },
      `Queued clone for ${vm.name}.`,
    );
  }

  async function handleSnapshot(vm: VmInstance): Promise<void> {
    const label = window.prompt(
      "Snapshot label",
      `snapshot-${new Date().toISOString().slice(0, 16)}`,
    );

    if (label === null) {
      return;
    }

    const payload: SnapshotInput = {
      label: label.trim() || undefined,
    };

    await runMutation(
      `Snapshotting ${vm.name}`,
      async () => {
        await postJson(`/api/vms/${vm.id}/snapshot`, payload);
        await refreshSummary();
        await refreshDetail(vm.id);
      },
      `Queued snapshot for ${vm.name}.`,
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
          setSidePanelCollapsed(false);
        }
        await refreshSummary();
      },
      `Queued delete for ${vm.name}.`,
    );
  }

  async function handleResize(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const payload: ResizeVmInput = {
      resources: {
        cpu: Number(resourceDraft.cpu),
        ramMb: Number(resourceDraft.ramMb),
        diskGb: Number(resourceDraft.diskGb),
      },
    };

    await runMutation(
      `Resizing ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/resize`, payload);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      `Queued resize for ${detail.vm.name}.`,
    );
  }

  async function handleCommand(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail || !commandDraft.trim()) {
      return;
    }

    const payload: InjectCommandInput = {
      command: commandDraft.trim(),
    };

    await runMutation(
      `Running command on ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/input`, payload);
        setCommandDraft("");
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      `Queued command for ${detail.vm.name}.`,
    );
  }

  async function handleCaptureTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const payload: CaptureTemplateInput = {
      templateId:
        captureDraft.mode === "existing" && captureDraft.templateId
          ? captureDraft.templateId
          : undefined,
      name: captureDraft.name.trim(),
      description: captureDraft.description.trim(),
    };

    await runMutation(
      `Capturing template from ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/template`, payload);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      captureDraft.mode === "existing"
        ? `Queued template refresh for ${captureDraft.name.trim()}.`
        : `Queued new template capture for ${captureDraft.name.trim()}.`,
    );
  }

  async function handleSaveForwards(nextForwards: TemplatePortForward[]): Promise<void> {
    if (!detail) {
      return;
    }

    await runMutation(
      `Updating forwards on ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/forwards`, {
          forwardedPorts: nextForwards,
        });
        setForwardDraft(emptyForwardDraft);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      nextForwards.length > 0
        ? `Saved ${nextForwards.length} forwarded service ports.`
        : "Removed forwarded service ports.",
    );
  }

  async function handleAddForward(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const nextForward: TemplatePortForward = {
      name: forwardDraft.name.trim(),
      guestPort: Number(forwardDraft.guestPort),
      protocol: "http",
      description: forwardDraft.description.trim(),
    };

    const nextForwards = [
      ...detail.vm.forwardedPorts.map(toTemplatePortForward),
      nextForward,
    ];

    await handleSaveForwards(nextForwards);
  }

  async function handleRemoveForward(forwardId: string): Promise<void> {
    if (!detail) {
      return;
    }

    const nextForwards = detail.vm.forwardedPorts
      .filter((entry) => entry.id !== forwardId)
      .map(toTemplatePortForward);

    await handleSaveForwards(nextForwards);
  }

  if (!summary) {
    if (authState === "required") {
      return (
        <LoginShell
          busy={loginBusy}
          error={loginError}
          loginDraft={loginDraft}
          onFieldChange={(field, value) =>
            setLoginDraft((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onSubmit={async (event) => {
            event.preventDefault();
            setLoginBusy(true);
            setLoginError(null);

            try {
              const status = await postJson<AuthStatus>("/api/auth/login", loginDraft);
              setAuthEnabled(status.authEnabled);
              setAuthState("ready");
              setLoginDraft((current) => ({
                ...current,
                password: "",
              }));
              await refreshSummary();
            } catch (error) {
              setLoginError(errorMessage(error));
            } finally {
              setLoginBusy(false);
            }
          }}
        />
      );
    }

    return <LoadingShell />;
  }

  const workspaceFocused = selectedVm !== null;

  return (
    <>
      <main className="app-shell" onClick={() => setOpenVmMenuId(null)}>
        <header className="app-topbar" onClick={(event) => event.stopPropagation()}>
          <div className="app-brand">
            <p className="app-brand__eyebrow">Parallaize Control Plane</p>
            <div className="app-brand__row">
              <h1 className="app-brand__title">VM rail</h1>
              <span
                className={joinClassNames(
                  "surface-pill",
                  providerReady ? "surface-pill--success" : "surface-pill--warning",
                )}
              >
                {providerReady ? "Provider ready" : "Provider blocked"}
              </span>
            </div>
            <p className="app-brand__copy">{summary.provider.detail}</p>
          </div>

          <div className="app-topbar__stats">
            <MiniStat
              label="Running"
              value={`${summary.metrics.runningVmCount}/${summary.metrics.totalVmCount}`}
            />
            <MiniStat label="CPU" value={String(summary.metrics.totalCpu)} />
            <MiniStat label="RAM" value={formatRam(summary.metrics.totalRamMb)} />
          </div>

          <div className="app-topbar__actions">
            {supportsLiveDesktop ? (
              <button
                className={joinClassNames(
                  "button button--ghost",
                  showLivePreviews ? "button--selected" : "",
                )}
                type="button"
                onClick={() => setShowLivePreviews((current) => !current)}
                aria-pressed={showLivePreviews}
              >
                {showLivePreviews ? "Live previews on" : "Live previews off"}
              </button>
            ) : (
              <span className="surface-pill">Synthetic previews</span>
            )}
            <button
              className="button button--ghost"
              type="button"
              onClick={() =>
                setThemeMode((current) => (current === "dark" ? "light" : "dark"))
              }
            >
              {themeMode === "dark" ? "Light mode" : "Dark mode"}
            </button>
            {authEnabled ? (
              <button
                className="button button--ghost"
                type="button"
                onClick={() =>
                  void (async () => {
                    try {
                      await postJson<AuthStatus>("/api/auth/logout", {});
                    } finally {
                      requireLogin();
                    }
                  })()
                }
              >
                Log out
              </button>
            ) : null}
            {selectedVm ? (
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  setSelectedVmId(null);
                  setSidePanelCollapsed(false);
                }}
              >
                Close workspace
              </button>
            ) : null}
            <button
              className="button button--primary"
              type="button"
              onClick={() => setShowCreateDialog(true)}
            >
              New VM
            </button>
          </div>
        </header>

        {notice || busyLabel ? (
          <div
            className={joinClassNames(
              "notice-bar",
              notice ? noticeToneClassName(notice.tone) : "notice-bar--info",
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <span>{notice?.message ?? "Working..."}</span>
            {busyLabel ? (
              <span className="surface-pill surface-pill--busy mono-font">{busyLabel}</span>
            ) : null}
          </div>
        ) : null}

        <section
          className="workspace-shell"
          data-focused={workspaceFocused ? "true" : "false"}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="workspace-shell__top">
            <div className="workspace-shell__meta">
              <div className="workspace-shell__meta-main">
                <p className="workspace-shell__eyebrow">Workspaces</p>
                <h2 className="workspace-shell__title">
                  {workspaceFocused ? "VM rail" : "Choose a workspace"}
                </h2>
                <p className="workspace-shell__copy">
                  {workspaceFocused
                    ? `${summary.metrics.runningVmCount}/${summary.metrics.totalVmCount} running`
                    : "All VMs stay visible here. Open one to drop into the desktop below."}
                </p>
              </div>

              <div className="workspace-shell__meta-tray">
                <span className="surface-pill">{summary.provider.kind}</span>
                <span className="surface-pill">
                  {summary.templates.length} template{summary.templates.length === 1 ? "" : "s"}
                </span>
                <span className="surface-pill">
                  {summary.jobs.filter((job) => job.status === "running").length} active job
                  {summary.jobs.filter((job) => job.status === "running").length === 1
                    ? ""
                    : "s"}
                </span>
              </div>
            </div>

            <div className="vm-strip">
              <button
                className="create-tile"
                type="button"
                onClick={() => setShowCreateDialog(true)}
              >
                <span className="create-tile__mark">+</span>
                <span className="create-tile__label">New workspace</span>
                <span className="create-tile__copy">
                  Launch from an existing environment template.
                </span>
              </button>

              {deferredVms.map((vm) => (
                <VmTile
                  key={vm.id}
                  busy={isBusy}
                  menuOpen={openVmMenuId === vm.id}
                  selected={vm.id === selectedVmId}
                  showLivePreview={showLivePreviews}
                  vm={vm}
                  onClone={handleClone}
                  onDelete={handleDelete}
                  onOpen={selectVm}
                  onSnapshot={handleSnapshot}
                  onStartStop={handleVmAction}
                  onToggleMenu={(vmId) =>
                    setOpenVmMenuId((current) => (current === vmId ? null : vmId))
                  }
                />
              ))}

              {deferredVms.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state__eyebrow">No VMs yet</p>
                  <h3 className="empty-state__title">Start with a template-backed workspace.</h3>
                  <p className="empty-state__copy">
                    The rail expands to fill the screen until you open a desktop. Create the
                    first VM to switch into the split-screen flow.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {selectedVm ? (
            <div className="workspace-shell__bottom">
              <section className="workspace-stage">
                <div className="workspace-stage__header">
                  <div className="workspace-stage__identity">
                    <p className="workspace-stage__eyebrow">
                      {currentDetail?.template?.name ?? "Loading template"}
                    </p>
                    <div className="workspace-stage__title-row">
                      <h3 className="workspace-stage__title">{selectedVm.name}</h3>
                      <StatusBadge status={selectedVm.status}>{selectedVm.status}</StatusBadge>
                    </div>
                    <p className="workspace-stage__copy">
                      {formatResources(selectedVm.resources)}
                      {currentDetail?.vm.session?.display
                        ? ` · ${currentDetail.vm.session.display}`
                        : ""}
                    </p>
                  </div>

                  <div className="workspace-stage__header-actions">
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => {
                        setSelectedVmId(null);
                        setSidePanelCollapsed(false);
                      }}
                    >
                      Back to rail
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => setSidePanelCollapsed((current) => !current)}
                    >
                      {sidePanelCollapsed ? "Show details" : "Hide details"}
                    </button>
                  </div>
                </div>

                <div className="workspace-stage__surface">
                  {!currentDetail ? (
                    <div className="workspace-stage__placeholder">
                      <div className="workspace-stage__placeholder-block skeleton-shell" />
                    </div>
                  ) : currentDetail.vm.session?.kind === "vnc" &&
                    currentDetail.vm.session.webSocketPath ? (
                    <NoVncViewport
                      className="workspace-stage__viewport"
                      surfaceClassName="workspace-stage__canvas"
                      webSocketPath={currentDetail.vm.session.webSocketPath}
                      showHeader={false}
                      statusMode="overlay"
                    />
                  ) : (
                    <div className="workspace-fallback">
                      <StaticPatternPreview vm={currentDetail.vm} variant="stage" />
                      <div className="workspace-fallback__copy">
                        <span className="surface-pill surface-pill--busy">
                          {desktopFallbackBadge(currentDetail)}
                        </span>
                        <p>
                          {desktopFallbackMessage(currentDetail)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <WorkspaceSidepanel
                busy={isBusy}
                captureDraft={captureDraft}
                collapsed={sidePanelCollapsed}
                commandDraft={commandDraft}
                detail={currentDetail}
                forwardDraft={forwardDraft}
                resourceDraft={resourceDraft}
                summary={summary}
                vm={selectedVm}
                onCaptureDraftChange={setCaptureDraft}
                onClone={handleClone}
                onCommandDraftChange={setCommandDraft}
                onDelete={handleDelete}
                onForwardDraftChange={setForwardDraft}
                onRemoveForward={handleRemoveForward}
                onResourceDraftChange={setResourceDraft}
                onResize={handleResize}
                onSaveForward={handleAddForward}
                onSnapshot={handleSnapshot}
                onStartStop={handleVmAction}
                onSubmitCapture={handleCaptureTemplate}
                onSubmitCommand={handleCommand}
                onToggleCollapsed={() => setSidePanelCollapsed((current) => !current)}
              />
            </div>
          ) : null}
        </section>
      </main>

      {showCreateDialog ? (
        <CreateVmDialog
          busy={isBusy}
          createDraft={createDraft}
          templates={deferredTemplates}
          onClose={() => setShowCreateDialog(false)}
          onFieldChange={handleCreateField}
          onSubmit={handleCreate}
          onTemplateChange={handleTemplateChange}
        />
      ) : null}
    </>
  );
}

interface CreateVmDialogProps {
  busy: boolean;
  createDraft: CreateDraft;
  templates: EnvironmentTemplate[];
  onClose: () => void;
  onFieldChange: (field: keyof CreateDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

function CreateVmDialog({
  busy,
  createDraft,
  templates,
  onClose,
  onFieldChange,
  onSubmit,
  onTemplateChange,
}: CreateVmDialogProps): JSX.Element {
  const selectedTemplate =
    templates.find((entry) => entry.id === createDraft.templateId) ?? templates[0] ?? null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Create workspace</p>
            <h2 className="dialog-panel__title">Launch a VM</h2>
            <p className="dialog-panel__copy">
              Keep the rail lean. Launch from a template here, then manage the rest in the
              sidepanel.
            </p>
          </div>
          <button className="button button--ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Template</span>
            <select
              className="field-input"
              value={createDraft.templateId}
              onChange={onTemplateChange}
              disabled={busy}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

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
              label="RAM MB"
              value={createDraft.ramMb}
              onChange={(value) => onFieldChange("ramMb", value)}
            />
            <NumberField
              disabled={busy}
              label="Disk GB"
              value={createDraft.diskGb}
              onChange={(value) => onFieldChange("diskGb", value)}
            />
          </div>

          {selectedTemplate ? (
            <div className="dialog-panel__template">
              <div className="dialog-panel__template-head">
                <strong>{selectedTemplate.name}</strong>
                <span className="surface-pill">{formatResources(selectedTemplate.defaultResources)}</span>
              </div>
              <p>{selectedTemplate.description}</p>
              {selectedTemplate.defaultForwardedPorts.length > 0 ? (
                <div className="chip-row">
                  {selectedTemplate.defaultForwardedPorts.map((port) => (
                    <span key={`${port.name}-${port.guestPort}`} className="surface-pill">
                      {port.name}:{port.guestPort}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button className="button button--primary button--full" type="submit" disabled={busy}>
            Queue workspace
          </button>
        </form>
      </section>
    </div>
  );
}

interface VmTileProps {
  busy: boolean;
  menuOpen: boolean;
  selected: boolean;
  showLivePreview: boolean;
  vm: VmInstance;
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onOpen: (vmId: string) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onStartStop: (vmId: string, action: "start" | "stop") => Promise<void>;
  onToggleMenu: (vmId: string) => void;
}

function VmTile({
  busy,
  menuOpen,
  selected,
  showLivePreview,
  vm,
  onClone,
  onDelete,
  onOpen,
  onSnapshot,
  onStartStop,
  onToggleMenu,
}: VmTileProps): JSX.Element {
  const canShowLivePreview =
    showLivePreview &&
    vm.status === "running" &&
    vm.session?.kind === "vnc" &&
    Boolean(vm.session.webSocketPath);
  const previewLabel = vmTilePreviewLabel(vm, showLivePreview);

  return (
    <article className={joinClassNames("vm-tile", selected ? "vm-tile--active" : "")}>
      <button className="vm-tile__open" type="button" onClick={() => onOpen(vm.id)}>
        <div className="vm-tile__preview">
          {canShowLivePreview && vm.session?.webSocketPath ? (
            <NoVncViewport
              className="vm-tile__viewport"
              surfaceClassName="vm-tile__canvas"
              webSocketPath={vm.session.webSocketPath}
              viewOnly
              resizeSession={false}
              showHeader={false}
              statusMode="overlay"
            />
          ) : (
            <>
              <StaticPatternPreview vm={vm} variant="tile" />
              <span className="vm-tile__preview-note">{previewLabel}</span>
            </>
          )}
        </div>

        <div className="vm-tile__body">
          <div className="vm-tile__body-head">
            <div className="vm-tile__identity">
              <h3 className="vm-tile__title">{vm.name}</h3>
              <p className="vm-tile__resources">{formatResources(vm.resources)}</p>
            </div>
            <StatusBadge status={vm.status}>{vm.status}</StatusBadge>
          </div>

          <div className="vm-tile__meta">
            <span className="mono-font">{vm.session?.display ?? "Waiting for guest VNC"}</span>
            <span>{formatForwardCount(vm.forwardedPorts.length)}</span>
          </div>
        </div>
      </button>

      <div className="vm-tile__menu" onClick={(event) => event.stopPropagation()}>
        <button
          className={joinClassNames("menu-button", menuOpen ? "menu-button--open" : "")}
          type="button"
          aria-expanded={menuOpen}
          aria-label={`Actions for ${vm.name}`}
          onClick={() => onToggleMenu(vm.id)}
        >
          ...
        </button>

        {menuOpen ? (
          <div className="vm-tile__popover">
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                onToggleMenu(vm.id);
                onOpen(vm.id);
              }}
            >
              Open
            </button>
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                onToggleMenu(vm.id);
                void onStartStop(vm.id, vm.status === "running" ? "stop" : "start");
              }}
              disabled={busy}
            >
              {vm.status === "running" ? "Stop" : "Start"}
            </button>
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                onToggleMenu(vm.id);
                void onClone(vm);
              }}
              disabled={busy}
            >
              Clone
            </button>
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                onToggleMenu(vm.id);
                void onSnapshot(vm);
              }}
              disabled={busy}
            >
              Snapshot
            </button>
            <button
              className="menu-action menu-action--danger"
              type="button"
              onClick={() => {
                onToggleMenu(vm.id);
                void onDelete(vm);
              }}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

interface WorkspaceSidepanelProps {
  busy: boolean;
  captureDraft: CaptureDraft;
  collapsed: boolean;
  commandDraft: string;
  detail: VmDetail | null;
  forwardDraft: ForwardDraft;
  resourceDraft: ResourceDraft;
  summary: DashboardSummary;
  vm: VmInstance;
  onCaptureDraftChange: (draft: CaptureDraft) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onCommandDraftChange: (value: string) => void;
  onDelete: (vm: VmInstance) => Promise<void>;
  onForwardDraftChange: (draft: ForwardDraft) => void;
  onRemoveForward: (forwardId: string) => Promise<void>;
  onResourceDraftChange: (draft: ResourceDraft) => void;
  onResize: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveForward: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onStartStop: (vmId: string, action: "start" | "stop") => Promise<void>;
  onSubmitCapture: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSubmitCommand: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onToggleCollapsed: () => void;
}

function WorkspaceSidepanel({
  busy,
  captureDraft,
  collapsed,
  commandDraft,
  detail,
  forwardDraft,
  resourceDraft,
  summary,
  vm,
  onCaptureDraftChange,
  onClone,
  onCommandDraftChange,
  onDelete,
  onForwardDraftChange,
  onRemoveForward,
  onResourceDraftChange,
  onResize,
  onSaveForward,
  onSnapshot,
  onStartStop,
  onSubmitCapture,
  onSubmitCommand,
  onToggleCollapsed,
}: WorkspaceSidepanelProps): JSX.Element {
  return (
    <aside
      className={joinClassNames("workspace-sidepanel", collapsed ? "workspace-sidepanel--collapsed" : "")}
    >
      <button className="workspace-sidepanel__handle" type="button" onClick={onToggleCollapsed}>
        {collapsed ? "Details" : "Collapse"}
      </button>

      {!collapsed ? (
        <div className="workspace-sidepanel__scroll">
          {!detail ? (
            <div className="workspace-sidepanel__loading">
              <div className="skeleton-shell workspace-sidepanel__loading-block" />
              <div className="skeleton-shell workspace-sidepanel__loading-block" />
              <div className="skeleton-shell workspace-sidepanel__loading-block" />
            </div>
          ) : (
            <>
              <section className="sidepanel-summary">
                <div className="sidepanel-summary__head">
                  <div>
                    <p className="workspace-shell__eyebrow">Sidepanel</p>
                    <h4 className="sidepanel-summary__title">{vm.name}</h4>
                  </div>
                  <StatusBadge status={vm.status}>{vm.status}</StatusBadge>
                </div>

                <div className="chip-row">
                  <span className="surface-pill">{detail.template?.name ?? "Unlinked template"}</span>
                  <span className="surface-pill">{providerTransportLabel(detail.provider.desktopTransport)}</span>
                  <span className="surface-pill">{summary.provider.kind}</span>
                </div>
              </section>

              <SidepanelSection title="Actions" defaultOpen>
                <div className="action-grid">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() =>
                      onStartStop(vm.id, vm.status === "running" ? "stop" : "start")
                    }
                    disabled={busy}
                  >
                    {vm.status === "running" ? "Stop" : "Start"}
                  </button>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => void onClone(vm)}
                    disabled={busy}
                  >
                    Clone
                  </button>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => void onSnapshot(vm)}
                    disabled={busy}
                  >
                    Snapshot
                  </button>
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={() => void onDelete(vm)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </SidepanelSection>

              <SidepanelSection title="Session" defaultOpen>
                <div className="compact-grid">
                  <FieldPair label="Resources" value={formatResources(vm.resources)} />
                  <FieldPair
                    label="Updated"
                    value={formatTimestamp(vm.updatedAt)}
                  />
                  <FieldPair
                    label="Workspace path"
                    mono
                    value={vm.workspacePath}
                  />
                  <FieldPair
                    label="Last action"
                    value={vm.lastAction}
                  />
                  <FieldPair
                    label="Browser socket"
                    mono
                    value={detail.vm.session?.webSocketPath ?? "Waiting for VNC bridge"}
                  />
                  <FieldPair
                    label="Guest endpoint"
                    mono
                    value={
                      detail.vm.session?.host && detail.vm.session?.port
                        ? `${detail.vm.session.host}:${detail.vm.session.port}`
                        : "Guest endpoint pending"
                    }
                  />
                </div>
              </SidepanelSection>

              <SidepanelSection title="Resize">
                <form className="sidepanel-form" onSubmit={onResize}>
                  <div className="compact-grid compact-grid--triple">
                    <NumberField
                      disabled={busy}
                      label="CPU"
                      value={resourceDraft.cpu}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          cpu: value,
                        })
                      }
                    />
                    <NumberField
                      disabled={busy}
                      label="RAM MB"
                      value={resourceDraft.ramMb}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          ramMb: value,
                        })
                      }
                    />
                    <NumberField
                      disabled={busy}
                      label="Disk GB"
                      value={resourceDraft.diskGb}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          diskGb: value,
                        })
                      }
                    />
                  </div>
                  <button className="button button--secondary button--full" type="submit" disabled={busy}>
                    Save resources
                  </button>
                </form>
              </SidepanelSection>

              <SidepanelSection title="Forwarded services">
                <div className="stack">
                  {detail.vm.forwardedPorts.length > 0 ? (
                    detail.vm.forwardedPorts.map((forward) => (
                      <div key={forward.id} className="list-card">
                        <div className="list-card__head">
                          <div>
                            <strong>{forward.name}</strong>
                            <p>{forward.description || "HTTP/WebSocket forward"}</p>
                          </div>
                          <button
                            className="button button--danger"
                            type="button"
                            onClick={() => void onRemoveForward(forward.id)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="compact-grid">
                          <FieldPair label="Guest port" mono value={String(forward.guestPort)} />
                          <FieldPair label="Public path" mono value={forward.publicPath} />
                        </div>
                        <a
                          className="button button--secondary button--full"
                          href={forward.publicPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open service
                        </a>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No forwarded guest services yet.</p>
                  )}

                  <form className="sidepanel-form sidepanel-form--framed" onSubmit={onSaveForward}>
                    <div className="compact-grid compact-grid--double">
                      <label className="field-shell">
                        <span>Name</span>
                        <input
                          className="field-input"
                          value={forwardDraft.name}
                          onChange={(event) =>
                            onForwardDraftChange({
                              ...forwardDraft,
                              name: event.target.value,
                            })
                          }
                          placeholder="app-ui"
                          disabled={busy}
                        />
                      </label>

                      <NumberField
                        disabled={busy}
                        label="Guest port"
                        value={forwardDraft.guestPort}
                        onChange={(value) =>
                          onForwardDraftChange({
                            ...forwardDraft,
                            guestPort: value,
                          })
                        }
                      />
                    </div>

                    <label className="field-shell">
                      <span>Description</span>
                      <input
                        className="field-input"
                        value={forwardDraft.description}
                        onChange={(event) =>
                          onForwardDraftChange({
                            ...forwardDraft,
                            description: event.target.value,
                          })
                        }
                        placeholder="Guest web app on port 3000"
                        disabled={busy}
                      />
                    </label>

                    <button className="button button--secondary button--full" type="submit" disabled={busy}>
                      Save forwarded service
                    </button>
                  </form>
                </div>
              </SidepanelSection>

              <SidepanelSection title="Command console">
                <form className="sidepanel-form" onSubmit={onSubmitCommand}>
                  <label className="field-shell">
                    <span>Shell command</span>
                    <input
                      className="field-input mono-font"
                      value={commandDraft}
                      onChange={(event) => onCommandDraftChange(event.target.value)}
                      placeholder="pnpm test"
                      disabled={busy}
                    />
                  </label>
                  <div className="chip-row">
                    {quickCommands.map((command) => (
                      <button
                        key={command}
                        className="button button--ghost"
                        type="button"
                        onClick={() => onCommandDraftChange(command)}
                      >
                        {command}
                      </button>
                    ))}
                  </div>
                  <button className="button button--secondary button--full" type="submit" disabled={busy}>
                    Queue command
                  </button>
                </form>
              </SidepanelSection>

              <SidepanelSection title="Capture template">
                <form className="sidepanel-form" onSubmit={onSubmitCapture}>
                  <label className="field-shell">
                    <span>Mode</span>
                    <select
                      className="field-input"
                      value={captureDraft.mode}
                      onChange={(event) => {
                        const mode = event.target.value === "new" ? "new" : "existing";
                        const fallbackTemplate =
                          summary.templates.find((entry) => entry.id === captureDraft.templateId) ??
                          detail.template ??
                          summary.templates[0] ??
                          null;

                        onCaptureDraftChange(
                          mode === "existing"
                            ? buildCaptureDraft(fallbackTemplate, detail.vm)
                            : {
                                mode: "new",
                                templateId: "",
                                name: captureDraft.name || `Captured ${detail.vm.name}`,
                                description:
                                  captureDraft.description ||
                                  `Captured from workspace ${detail.vm.name}.`,
                              },
                        );
                      }}
                      disabled={busy}
                    >
                      <option value="existing">Update existing template</option>
                      <option value="new">Create new template</option>
                    </select>
                  </label>

                  {captureDraft.mode === "existing" ? (
                    <label className="field-shell">
                      <span>Template</span>
                      <select
                        className="field-input"
                        value={captureDraft.templateId}
                        onChange={(event) => {
                          const template =
                            summary.templates.find((entry) => entry.id === event.target.value) ?? null;

                          onCaptureDraftChange({
                            mode: "existing",
                            templateId: event.target.value,
                            name: template?.name ?? captureDraft.name,
                            description: template?.description ?? captureDraft.description,
                          });
                        }}
                        disabled={busy}
                      >
                        {summary.templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="field-shell">
                    <span>Name</span>
                    <input
                      className="field-input"
                      value={captureDraft.name}
                      onChange={(event) =>
                        onCaptureDraftChange({
                          ...captureDraft,
                          name: event.target.value,
                        })
                      }
                      disabled={busy}
                    />
                  </label>

                  <label className="field-shell">
                    <span>Description</span>
                    <textarea
                      className="field-input field-input--tall"
                      value={captureDraft.description}
                      onChange={(event) =>
                        onCaptureDraftChange({
                          ...captureDraft,
                          description: event.target.value,
                        })
                      }
                      disabled={busy}
                    />
                  </label>

                  <p className="empty-copy">
                    {detail.vm.forwardedPorts.length > 0
                      ? `This capture will keep ${detail.vm.forwardedPorts.length} forwarded service default${detail.vm.forwardedPorts.length === 1 ? "" : "s"} with the template.`
                      : "This capture will not add any forwarded service defaults to the template."}
                  </p>

                  <button className="button button--secondary button--full" type="submit" disabled={busy}>
                    Queue capture
                  </button>
                </form>
              </SidepanelSection>

              <SidepanelSection title="Activity">
                <div className="stack">
                  {detail.recentJobs.length > 0 ? (
                    detail.recentJobs.map((job) => (
                      <div key={job.id} className="list-card">
                        <div className="list-card__head">
                          <strong className="mono-font">{job.kind}</strong>
                          <span className="surface-pill">{job.status}</span>
                        </div>
                        <p>{job.message}</p>
                        <span className="list-card__timestamp">
                          {formatTimestamp(job.updatedAt)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No recent jobs for this VM.</p>
                  )}

                  {detail.vm.activityLog.length > 0 ? (
                    detail.vm.activityLog.slice().reverse().map((entry, index) => (
                      <div
                        key={`${entry}-${index}`}
                        className="log-line mono-font"
                      >
                        {entry}
                      </div>
                    ))
                  ) : null}
                </div>
              </SidepanelSection>

              <SidepanelSection title="Snapshots">
                <div className="stack">
                  {detail.snapshots.length > 0 ? (
                    detail.snapshots.map((snapshot) => (
                      <div key={snapshot.id} className="list-card">
                        <div className="list-card__head">
                          <strong>{snapshot.label}</strong>
                          <span className="list-card__timestamp">
                            {formatTimestamp(snapshot.createdAt)}
                          </span>
                        </div>
                        <p>{snapshot.summary}</p>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No snapshots recorded yet.</p>
                  )}
                </div>
              </SidepanelSection>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}

function LoadingShell(): JSX.Element {
  return (
    <main className="loading-shell">
      <div className="loading-shell__panel">
        <p className="workspace-shell__eyebrow">Parallaize Control Plane</p>
        <h1 className="loading-shell__title">Loading dashboard</h1>
        <p className="loading-shell__copy">
          Fetching provider state, templates, workspaces, and recent jobs.
        </p>
      </div>
    </main>
  );
}

function LoginShell({
  busy,
  error,
  loginDraft,
  onFieldChange,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  loginDraft: LoginDraft;
  onFieldChange: (field: keyof LoginDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): JSX.Element {
  return (
    <main className="loading-shell">
      <section className="login-shell">
        <div className="login-shell__header">
          <p className="workspace-shell__eyebrow">Parallaize Admin</p>
          <h1 className="loading-shell__title">Sign in</h1>
          <p className="loading-shell__copy">
            The dashboard now uses an in-app single-admin session instead of the browser’s
            native Basic Auth prompt.
          </p>
        </div>

        <form className="login-shell__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Username</span>
            <input
              className="field-input"
              value={loginDraft.username}
              onChange={(event) => onFieldChange("username", event.target.value)}
              disabled={busy}
              autoComplete="username"
            />
          </label>
          <label className="field-shell">
            <span>Password</span>
            <input
              className="field-input"
              type="password"
              value={loginDraft.password}
              onChange={(event) => onFieldChange("password", event.target.value)}
              disabled={busy}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="login-shell__error">{error}</p> : null}
          <button className="button button--primary button--full" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="mini-stat">
      <span className="mini-stat__label">{label}</span>
      <strong className="mini-stat__value">{value}</strong>
    </div>
  );
}

function SidepanelSection({
  children,
  defaultOpen = false,
  title,
}: {
  children: JSX.Element | JSX.Element[];
  defaultOpen?: boolean;
  title: string;
}): JSX.Element {
  return (
    <details className="sidepanel-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="sidepanel-section__body">{children}</div>
    </details>
  );
}

function StaticPatternPreview({
  variant,
  vm,
}: {
  variant: "stage" | "tile";
  vm: VmInstance;
}): JSX.Element {
  return (
    <div
      className={joinClassNames(
        "pattern-preview",
        variant === "stage" ? "pattern-preview--stage" : "pattern-preview--tile",
      )}
      style={buildPatternStyle(vm.screenSeed)}
      aria-hidden="true"
    >
      <div className="pattern-preview__mesh" />
      <div className="pattern-preview__band pattern-preview__band--a" />
      <div className="pattern-preview__band pattern-preview__band--b" />
      <div className="pattern-preview__glow" />
    </div>
  );
}

function NumberField({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): JSX.Element {
  return (
    <label className="field-shell">
      <span>{label}</span>
      <input
        className="field-input"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function StatusBadge({
  children,
  status,
}: {
  children: string;
  status: VmStatus;
}): JSX.Element {
  return <span className={`status-badge ${statusClassName(status)}`}>{children}</span>;
}

function FieldPair({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}): JSX.Element {
  return (
    <div className="field-pair">
      <p className="field-pair__label">{label}</p>
      <p className={joinClassNames("field-pair__value", mono ? "mono-font" : "")}>{value}</p>
    </div>
  );
}

function syncCreateDraft(
  current: CreateDraft,
  templates: EnvironmentTemplate[],
  preserveInput: boolean,
): CreateDraft {
  const template =
    templates.find((entry) => entry.id === current.templateId) ?? templates[0] ?? null;

  if (!template) {
    return current;
  }

  if (preserveInput && current.templateId) {
    return current;
  }

  return buildCreateDraft(template, current.name);
}

function buildCreateDraft(
  template: EnvironmentTemplate,
  name = "",
): CreateDraft {
  return {
    templateId: template.id,
    name,
    cpu: String(template.defaultResources.cpu),
    ramMb: String(template.defaultResources.ramMb),
    diskGb: String(template.defaultResources.diskGb),
  };
}

function buildCaptureDraft(
  template: EnvironmentTemplate | null,
  vm: VmInstance,
): CaptureDraft {
  if (template) {
    return {
      mode: "existing",
      templateId: template.id,
      name: template.name,
      description: template.description,
    };
  }

  return {
    mode: "new",
    templateId: "",
    name: `Captured ${vm.name}`,
    description: `Captured from workspace ${vm.name}.`,
  };
}

function toTemplatePortForward(forward: VmPortForward): TemplatePortForward {
  return {
    name: forward.name,
    guestPort: forward.guestPort,
    protocol: forward.protocol,
    description: forward.description,
  };
}

function providerTransportLabel(transport: DashboardSummary["provider"]["desktopTransport"]): string {
  return transport === "novnc" ? "Embedded noVNC bridge" : "Synthetic preview";
}

function desktopFallbackBadge(detail: VmDetail): string {
  if (detail.provider.desktopTransport === "synthetic" || detail.vm.session?.kind === "synthetic") {
    return "Synthetic preview";
  }

  if (detail.vm.status !== "running") {
    return `${capitalizeWord(detail.vm.status)} desktop`;
  }

  return "Waiting for guest VNC";
}

function desktopFallbackMessage(detail: VmDetail): string {
  if (detail.provider.desktopTransport === "synthetic" || detail.vm.session?.kind === "synthetic") {
    return "This server is running the mock provider, so the dashboard renders generated desktop frames instead of a live browser VNC session.";
  }

  if (detail.vm.status !== "running") {
    return "Start the VM to attach a browser desktop. Until then the dashboard keeps showing the latest generated frame.";
  }

  return "This VM does not have a browser VNC session yet. The synthetic frame stays here until the guest publishes a reachable desktop endpoint.";
}

function vmTilePreviewLabel(vm: VmInstance, showLivePreview: boolean): string {
  if (vm.session?.kind === "synthetic") {
    return "Synthetic preview";
  }

  if (vm.status !== "running") {
    return capitalizeWord(vm.status);
  }

  if (showLivePreview) {
    return "Waiting for VNC";
  }

  return "Static preview";
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildPatternStyle(seed: number): CSSProperties {
  return {
    "--pattern-x": `${12 + (seed % 58)}%`,
    "--pattern-y": `${10 + ((seed * 3) % 62)}%`,
    "--pattern-tilt-a": `${-18 + (seed % 24)}deg`,
    "--pattern-tilt-b": `${8 + ((seed * 5) % 18)}deg`,
    "--pattern-shift": `${(seed * 7) % 160}px`,
  } as CSSProperties;
}

function statusClassName(status: VmStatus): string {
  switch (status) {
    case "running":
      return "status-badge--running";
    case "stopped":
      return "status-badge--stopped";
    case "creating":
      return "status-badge--creating";
    case "deleting":
      return "status-badge--deleting";
    case "error":
      return "status-badge--error";
    default:
      return "status-badge--default";
  }
}

function noticeToneClassName(tone: Notice["tone"]): string {
  switch (tone) {
    case "error":
      return "notice-bar--error";
    case "success":
      return "notice-bar--success";
    default:
      return "notice-bar--info";
  }
}

function formatForwardCount(count: number): string {
  if (count === 0) {
    return "No services";
  }

  return `${count} service${count === 1 ? "" : "s"}`;
}

function readThemeMode(): ThemeMode {
  const stored = readStoredString("parallaize.theme");

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = readStoredString(key);

  if (stored === "true") {
    return true;
  }

  if (stored === "false") {
    return false;
  }

  return fallback;
}

function readStoredString(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredString(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore persistence failures and keep the session usable.
  }
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (response.status === 401) {
    throw new AuthRequiredError(
      payload.ok ? "Authentication required." : payload.error,
    );
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}
