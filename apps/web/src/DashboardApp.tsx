import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
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

const quickCommands = ["pwd", "ls -la", "pnpm build", "pnpm test", "incus list"];

export function DashboardApp(): JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VmDetail | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [frameSeed, setFrameSeed] = useState(() => Date.now());
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createDirty, setCreateDirty] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(emptyResourceDraft);
  const [commandDraft, setCommandDraft] = useState("");
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft>(emptyForwardDraft);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft>(emptyCaptureDraft);
  const selectedVmIdRef = useRef<string | null>(null);

  const deferredVms = useDeferredValue(summary?.vms ?? []);
  const deferredTemplates = useDeferredValue(summary?.templates ?? []);
  const deferredJobs = useDeferredValue(summary?.jobs ?? []);
  const selectedVm =
    summary?.vms.find((entry) => entry.id === selectedVmId) ?? detail?.vm ?? null;
  const isBusy = busyLabel !== null;

  useEffect(() => {
    selectedVmIdRef.current = selectedVmId;
  }, [selectedVmId]);

  useEffect(() => {
    const vmId = new URL(window.location.href).searchParams.get("vm");
    if (vmId) {
      setSelectedVmId(vmId);
    }

    void refreshSummary().catch((error: unknown) => {
      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
    });
  }, []);

  useEffect(() => {
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
  }, []);

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
      return;
    }

    setResourceDraft({
      cpu: String(detail.vm.resources.cpu),
      ramMb: String(detail.vm.resources.ramMb),
      diskGb: String(detail.vm.resources.diskGb),
    });
    setCaptureDraft(buildCaptureDraft(detail.template, detail.vm));
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
    if (!selectedVmId) {
      return;
    }

    setFrameSeed(Date.now());
    const timer = window.setInterval(() => {
      setFrameSeed(Date.now());
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [selectedVmId]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, notice.tone === "error" ? 6500 : 3600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice]);

  async function refreshSummary(): Promise<DashboardSummary> {
    const nextSummary = await fetchJson<DashboardSummary>("/api/summary");
    startTransition(() => {
      setSummary(nextSummary);
    });
    return nextSummary;
  }

  async function refreshDetail(vmId: string): Promise<void> {
    setDetail(await fetchJson<VmDetail>(`/api/vms/${vmId}`));
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
        await refreshSummary();
        await refreshDetail(clone.id);
      },
      `Queued clone for ${vm.name}.`,
    );
  }

  async function handleSnapshot(vm: VmInstance): Promise<void> {
    const label = window.prompt("Snapshot label", `snapshot-${new Date().toISOString().slice(0, 16)}`);

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
    return <LoadingShell />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <header className="card-shell card-raise flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
            Parallaize Control Plane
          </p>
          <div>
            <h1 className="display-font text-4xl text-slate-950 sm:text-5xl">
              Browser VNC for Incus workspaces
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
              Real VM lifecycle, embedded noVNC sessions, and forwarded guest services
              through one Caddy front door.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Provider"
            value={summary.provider.kind}
            tone={summary.provider.available ? "success" : "warning"}
          />
          <MetricCard
            label="Running"
            value={`${summary.metrics.runningVmCount}/${summary.metrics.totalVmCount}`}
          />
          <MetricCard label="CPU reserved" value={String(summary.metrics.totalCpu)} />
          <MetricCard label="RAM reserved" value={formatRam(summary.metrics.totalRamMb)} />
        </div>
      </header>

      {notice ? (
        <div className={`notice-shell ${noticeToneClassName(notice.tone)}`}>
          <span>{notice.message}</span>
          {busyLabel ? <span className="mono-font text-xs uppercase tracking-[0.22em]">{busyLabel}</span> : null}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <CreatePanel
          busy={isBusy}
          createDraft={createDraft}
          templates={deferredTemplates}
          onFieldChange={handleCreateField}
          onSubmit={handleCreate}
          onTemplateChange={handleTemplateChange}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <VmListPanel
            busy={isBusy}
            selectedVmId={selectedVmId}
            vms={deferredVms}
            onClone={handleClone}
            onDelete={handleDelete}
            onOpen={setSelectedVmId}
            onSnapshot={handleSnapshot}
            onStartStop={handleVmAction}
          />

          <aside className="space-y-6">
            <InfoPanel title="Provider status">
              <div className="space-y-3 text-sm text-slate-600">
                <StatusBadge status={summary.provider.available ? "running" : "stopped"}>
                  {summary.provider.available ? "Ready" : "Unavailable"}
                </StatusBadge>
                <p>{summary.provider.detail}</p>
                {summary.provider.binaryPath ? (
                  <FieldPair label="Binary" value={summary.provider.binaryPath} mono />
                ) : null}
                <FieldPair
                  label="Desktop transport"
                  value={providerTransportLabel(summary.provider.desktopTransport)}
                />
                <FieldPair
                  label="Incus project"
                  value={summary.provider.project ?? "default"}
                />
                {summary.provider.nextSteps.length > 0 ? (
                  <ul className="space-y-2">
                    {summary.provider.nextSteps.map((step) => (
                      <li
                        key={step}
                        className="rounded-2xl border border-slate-900/8 bg-slate-50 px-3 py-2"
                      >
                        {step}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </InfoPanel>

            <InfoPanel title="Templates">
              <div className="space-y-3">
                {deferredTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-2xl border border-slate-900/8 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm text-slate-950">{template.name}</strong>
                      <span className="mono-font text-xs text-slate-500">
                        {template.snapshotIds.length} snaps
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {template.description}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-400">
                      {formatResources(template.defaultResources)}
                    </p>
                  </div>
                ))}
              </div>
            </InfoPanel>

            <InfoPanel title="Recent jobs">
              <div className="space-y-3">
                {deferredJobs.slice(0, 8).map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-slate-900/8 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="mono-font text-xs uppercase tracking-[0.22em] text-slate-500">
                        {job.kind}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                        {job.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{job.message}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {formatTimestamp(job.updatedAt)}
                    </p>
                  </div>
                ))}
              </div>
            </InfoPanel>
          </aside>
        </div>
      </section>

      <VmDetailPanel
        busy={isBusy}
        captureDraft={captureDraft}
        commandDraft={commandDraft}
        detail={detail}
        forwardDraft={forwardDraft}
        frameSeed={frameSeed}
        resourceDraft={resourceDraft}
        selectedVm={selectedVm}
        summary={summary}
        onCaptureDraftChange={setCaptureDraft}
        onClone={handleClone}
        onCommandDraftChange={setCommandDraft}
        onDelete={handleDelete}
        onForwardDraftChange={setForwardDraft}
        onOpen={setSelectedVmId}
        onRemoveForward={handleRemoveForward}
        onResourceDraftChange={setResourceDraft}
        onResize={handleResize}
        onSaveForward={handleAddForward}
        onSnapshot={handleSnapshot}
        onStartStop={handleVmAction}
        onSubmitCapture={handleCaptureTemplate}
        onSubmitCommand={handleCommand}
      />
    </main>
  );
}

interface CreatePanelProps {
  busy: boolean;
  createDraft: CreateDraft;
  templates: EnvironmentTemplate[];
  onFieldChange: (field: keyof CreateDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

function CreatePanel({
  busy,
  createDraft,
  templates,
  onFieldChange,
  onSubmit,
  onTemplateChange,
}: CreatePanelProps): JSX.Element {
  const selectedTemplate =
    templates.find((entry) => entry.id === createDraft.templateId) ?? templates[0] ?? null;

  return (
    <section className="card-shell card-raise">
      <div className="mb-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
          Create workspace
        </p>
        <h2 className="display-font text-3xl text-slate-950">Launch a desktop VM</h2>
        <p className="text-sm leading-6 text-slate-600">
          Pick a template, set the initial resources, then add forwarded guest ports after the VM is up.
        </p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
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

        <div className="grid gap-4 sm:grid-cols-3">
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
          <div className="rounded-3xl border border-slate-900/8 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
            <p className="font-semibold text-slate-900">{selectedTemplate.name}</p>
            <p className="mt-2">{selectedTemplate.description}</p>
            <p className="mt-3 mono-font text-xs uppercase tracking-[0.22em] text-slate-500">
              {formatResources(selectedTemplate.defaultResources)}
            </p>
          </div>
        ) : null}

        <button className="primary-button w-full" type="submit" disabled={busy}>
          Queue workspace
        </button>
      </form>
    </section>
  );
}

interface VmListPanelProps {
  busy: boolean;
  selectedVmId: string | null;
  vms: VmInstance[];
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onOpen: (vmId: string) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onStartStop: (vmId: string, action: "start" | "stop") => Promise<void>;
}

function VmListPanel({
  busy,
  selectedVmId,
  vms,
  onClone,
  onDelete,
  onOpen,
  onSnapshot,
  onStartStop,
}: VmListPanelProps): JSX.Element {
  return (
    <section className="card-shell">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Workspaces
          </p>
          <h2 className="display-font text-3xl text-slate-950">Operator grid</h2>
        </div>
        <p className="text-sm text-slate-500">{vms.length} total</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {vms.map((vm) => {
          const selected = vm.id === selectedVmId;

          return (
            <article
              key={vm.id}
              className={`rounded-[28px] border px-5 py-5 transition ${
                selected
                  ? "border-amber-600/35 bg-amber-50/85 shadow-[0_20px_45px_rgba(148,88,35,0.12)]"
                  : "border-slate-900/8 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <button
                    className="text-left"
                    type="button"
                    onClick={() => onOpen(vm.id)}
                  >
                    <h3 className="display-font text-2xl text-slate-950">{vm.name}</h3>
                  </button>
                  <p className="text-sm leading-6 text-slate-600">{formatResources(vm.resources)}</p>
                </div>
                <StatusBadge status={vm.status}>{vm.status}</StatusBadge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FieldPair
                  label="Session"
                  value={vm.session?.display ?? "Pending guest VNC"}
                  mono
                />
                <FieldPair
                  label="Forwards"
                  value={vm.forwardedPorts.length > 0 ? String(vm.forwardedPorts.length) : "None"}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onOpen(vm.id)}
                >
                  Open
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onStartStop(vm.id, vm.status === "running" ? "stop" : "start")}
                  disabled={busy}
                >
                  {vm.status === "running" ? "Stop" : "Start"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void onClone(vm)}
                  disabled={busy}
                >
                  Clone
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void onSnapshot(vm)}
                  disabled={busy}
                >
                  Snapshot
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void onDelete(vm)}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface VmDetailPanelProps {
  busy: boolean;
  captureDraft: CaptureDraft;
  commandDraft: string;
  detail: VmDetail | null;
  forwardDraft: ForwardDraft;
  frameSeed: number;
  resourceDraft: ResourceDraft;
  selectedVm: VmInstance | null;
  summary: DashboardSummary;
  onCaptureDraftChange: (draft: CaptureDraft) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onCommandDraftChange: (value: string) => void;
  onDelete: (vm: VmInstance) => Promise<void>;
  onForwardDraftChange: (draft: ForwardDraft) => void;
  onOpen: (vmId: string) => void;
  onRemoveForward: (forwardId: string) => Promise<void>;
  onResourceDraftChange: (draft: ResourceDraft) => void;
  onResize: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveForward: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onStartStop: (vmId: string, action: "start" | "stop") => Promise<void>;
  onSubmitCapture: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSubmitCommand: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

function VmDetailPanel({
  busy,
  captureDraft,
  commandDraft,
  detail,
  forwardDraft,
  frameSeed,
  resourceDraft,
  selectedVm,
  summary,
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
}: VmDetailPanelProps): JSX.Element {
  if (!selectedVm) {
    return (
      <section className="card-shell flex min-h-[420px] items-center justify-center">
        <div className="max-w-xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Workspace detail
          </p>
          <h2 className="display-font mt-4 text-4xl text-slate-950">Pick a workspace</h2>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Open any VM from the operator grid to attach the browser VNC session, manage
            forwarded guest ports, run commands, and capture templates.
          </p>
        </div>
      </section>
    );
  }

  const currentDetail = detail?.vm.id === selectedVm.id ? detail : null;

  return (
    <section className="card-shell space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Workspace detail
          </p>
          <h2 className="display-font text-4xl text-slate-950">{selectedVm.name}</h2>
          <p className="text-sm leading-6 text-slate-600">
            {currentDetail?.template?.name ?? "Loading template"} · {formatResources(selectedVm.resources)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusBadge status={selectedVm.status}>{selectedVm.status}</StatusBadge>
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              onStartStop(
                selectedVm.id,
                selectedVm.status === "running" ? "stop" : "start",
              )
            }
            disabled={busy}
          >
            {selectedVm.status === "running" ? "Stop" : "Start"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void onClone(selectedVm)}
            disabled={busy}
          >
            Clone
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void onSnapshot(selectedVm)}
            disabled={busy}
          >
            Snapshot
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => void onDelete(selectedVm)}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      </div>

      {!currentDetail ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="skeleton-shell h-[380px]" />
          <div className="skeleton-shell h-[380px]" />
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <div className="space-y-4">
              {currentDetail.vm.session?.kind === "vnc" && currentDetail.vm.session.webSocketPath ? (
                <NoVncViewport
                  title={currentDetail.vm.session.display}
                  webSocketPath={currentDetail.vm.session.webSocketPath}
                />
              ) : (
                <div className="overflow-hidden rounded-3xl border border-slate-900/10 bg-slate-950">
                  <img
                    className="aspect-[16/10] w-full object-cover"
                    src={`/api/vms/${currentDetail.vm.id}/frame.svg?mode=detail&t=${frameSeed}`}
                    alt={`${currentDetail.vm.name} synthetic session`}
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <InlineTag label={currentDetail.vm.workspacePath} />
                <InlineTag label={currentDetail.vm.session?.display ?? "Guest VNC pending"} />
                <InlineTag label={`Updated ${formatTimestamp(currentDetail.vm.updatedAt)}`} />
                {currentDetail.vm.liveSince ? (
                  <InlineTag label={`Live since ${formatTimestamp(currentDetail.vm.liveSince)}`} />
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FieldPair
                  label="Desktop transport"
                  value={providerTransportLabel(currentDetail.provider.desktopTransport)}
                />
                <FieldPair
                  label="Browser socket"
                  value={currentDetail.vm.session?.webSocketPath ?? "Waiting for VNC bridge"}
                  mono
                />
                <FieldPair
                  label="Guest host"
                  value={currentDetail.vm.session?.host ?? "Pending guest address"}
                  mono
                />
                <FieldPair
                  label="Guest VNC port"
                  value={currentDetail.vm.session?.port ? String(currentDetail.vm.session.port) : "Pending"}
                  mono
                />
              </div>
            </div>

            <div className="space-y-4">
              <InfoPanel title="Resize">
                <form className="space-y-4" onSubmit={onResize}>
                  <div className="grid gap-4 sm:grid-cols-3">
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
                  <button className="secondary-button w-full" type="submit" disabled={busy}>
                    Save resources
                  </button>
                </form>
              </InfoPanel>

              <InfoPanel title="Capture template">
                <form className="space-y-4" onSubmit={onSubmitCapture}>
                  <label className="field-shell">
                    <span>Mode</span>
                    <select
                      className="field-input"
                      value={captureDraft.mode}
                      onChange={(event) => {
                        const mode = event.target.value === "new" ? "new" : "existing";
                        const fallbackTemplate =
                          summary.templates.find((entry) => entry.id === captureDraft.templateId) ??
                          currentDetail.template ??
                          summary.templates[0] ??
                          null;

                        onCaptureDraftChange(
                          mode === "existing"
                            ? buildCaptureDraft(fallbackTemplate, currentDetail.vm)
                            : {
                                mode: "new",
                                templateId: "",
                                name: captureDraft.name || `Captured ${currentDetail.vm.name}`,
                                description:
                                  captureDraft.description ||
                                  `Captured from workspace ${currentDetail.vm.name}.`,
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
                      className="field-input min-h-28 resize-y"
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

                  <button className="secondary-button w-full" type="submit" disabled={busy}>
                    Queue capture
                  </button>
                </form>
              </InfoPanel>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <InfoPanel title="Forwarded guest services">
              <div className="space-y-4">
                {currentDetail.vm.forwardedPorts.length > 0 ? (
                  <div className="space-y-3">
                    {currentDetail.vm.forwardedPorts.map((forward) => (
                      <div
                        key={forward.id}
                        className="rounded-2xl border border-slate-900/8 bg-slate-50 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-950">{forward.name}</p>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                              {forward.description || "HTTP/WebSocket forward"}
                            </p>
                          </div>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => void onRemoveForward(forward.id)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <FieldPair label="Guest port" value={String(forward.guestPort)} mono />
                          <FieldPair label="Public path" value={forward.publicPath} mono />
                        </div>
                        <div className="mt-3">
                          <a
                            className="secondary-button w-full justify-center"
                            href={forward.publicPath}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open forwarded service
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-slate-600">
                    No guest services are being forwarded yet.
                  </p>
                )}

                <form className="space-y-4 rounded-3xl border border-slate-900/8 bg-slate-50 px-4 py-4" onSubmit={onSaveForward}>
                  <div className="grid gap-4 sm:grid-cols-2">
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
                  <button className="secondary-button w-full" type="submit" disabled={busy}>
                    Save forwarded service
                  </button>
                </form>
              </div>
            </InfoPanel>

            <div className="space-y-6">
              <InfoPanel title="Command console">
                <form className="space-y-4" onSubmit={onSubmitCommand}>
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
                  <div className="flex flex-wrap gap-2">
                    {quickCommands.map((command) => (
                      <button
                        key={command}
                        className="ghost-button"
                        type="button"
                        onClick={() => onCommandDraftChange(command)}
                      >
                        {command}
                      </button>
                    ))}
                  </div>
                  <button className="secondary-button w-full" type="submit" disabled={busy}>
                    Queue command
                  </button>
                </form>
              </InfoPanel>

              <InfoPanel title="Activity">
                <div className="space-y-3">
                  {currentDetail.vm.activityLog.slice().reverse().map((entry, index) => (
                    <div
                      key={`${entry}-${index}`}
                      className="rounded-2xl border border-slate-900/8 bg-slate-50 px-4 py-3 mono-font text-sm text-slate-700"
                    >
                      {entry}
                    </div>
                  ))}
                </div>
              </InfoPanel>

              <InfoPanel title="Snapshots">
                <div className="space-y-3">
                  {currentDetail.snapshots.length > 0 ? (
                    currentDetail.snapshots.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        className="rounded-2xl border border-slate-900/8 bg-slate-50 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-sm text-slate-950">{snapshot.label}</strong>
                          <span className="mono-font text-xs text-slate-500">
                            {formatTimestamp(snapshot.createdAt)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{snapshot.summary}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-slate-600">
                      No snapshots recorded yet.
                    </p>
                  )}
                </div>
              </InfoPanel>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function LoadingShell(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1280px] items-center justify-center px-4 py-8">
      <div className="card-shell w-full max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
          Parallaize Control Plane
        </p>
        <h1 className="display-font mt-4 text-4xl text-slate-950">Loading dashboard</h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          Fetching provider state, templates, workspaces, and recent jobs.
        </p>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "success" | "warning";
  value: string;
}): JSX.Element {
  return (
    <div className={`metric-shell ${metricToneClassName(tone)}`}>
      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
        {label}
      </span>
      <strong className="mt-3 text-2xl text-slate-950">{value}</strong>
    </div>
  );
}

function InfoPanel({
  children,
  title,
}: {
  children: JSX.Element | JSX.Element[];
  title: string;
}): JSX.Element {
  return (
    <section className="rounded-[30px] border border-slate-900/8 bg-white px-5 py-5 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <h3 className="display-font text-2xl text-slate-950">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
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
    <div className="rounded-2xl border border-slate-900/8 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className={`mt-2 text-sm text-slate-800 ${mono ? "mono-font break-all" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function InlineTag({ label }: { label: string }): JSX.Element {
  return (
    <span className="rounded-full border border-slate-900/8 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
      {label}
    </span>
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

function statusClassName(status: VmStatus): string {
  switch (status) {
    case "running":
      return "border-emerald-500/20 bg-emerald-500/12 text-emerald-700";
    case "stopped":
      return "border-amber-500/25 bg-amber-500/14 text-amber-700";
    case "creating":
      return "border-sky-500/20 bg-sky-500/12 text-sky-700";
    case "deleting":
      return "border-rose-500/20 bg-rose-500/12 text-rose-700";
    case "error":
      return "border-rose-600/25 bg-rose-600/16 text-rose-800";
    default:
      return "border-slate-500/20 bg-slate-500/10 text-slate-700";
  }
}

function noticeToneClassName(tone: Notice["tone"]): string {
  switch (tone) {
    case "error":
      return "border-rose-500/25 bg-rose-50 text-rose-800";
    case "success":
      return "border-emerald-500/20 bg-emerald-50 text-emerald-800";
    default:
      return "border-sky-500/20 bg-sky-50 text-sky-800";
  }
}

function metricToneClassName(tone: "default" | "success" | "warning"): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/20 bg-emerald-50";
    case "warning":
      return "border-amber-500/20 bg-amber-50";
    default:
      return "border-slate-900/8 bg-white";
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
  });

  const payload = (await response.json()) as ApiResponse<T>;

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

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
