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
  slugify,
} from "../../../packages/shared/src/helpers.js";
import type {
  ApiResponse,
  CaptureTemplateInput,
  CloneVmInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  InjectCommandInput,
  ResizeVmInput,
  ResourceSpec,
  SnapshotInput,
  VmDetail,
  VmInstance,
  VmStatus,
} from "../../../packages/shared/src/types.js";

const panelClassName =
  "rounded-[32px] border border-white/45 bg-white/72 p-5 shadow-[0_28px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-6";
const metaCardClassName =
  "rounded-[28px] border border-white/40 bg-white/76 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl";
const fieldClassName =
  "w-full rounded-2xl border border-slate-900/10 bg-white/92 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-700/45 focus:ring-4 focus:ring-amber-500/15";
const primaryButtonClassName =
  "inline-flex items-center justify-center rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-amber-50 transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-950/15 disabled:pointer-events-none disabled:opacity-50";
const secondaryButtonClassName =
  "inline-flex items-center justify-center rounded-full bg-white/84 px-4 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-900/10 transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-4 focus:ring-slate-950/10 disabled:pointer-events-none disabled:opacity-50";
const ghostButtonClassName =
  "inline-flex items-center justify-center rounded-full bg-slate-900/6 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-900/10 focus:outline-none focus:ring-4 focus:ring-slate-950/10 disabled:pointer-events-none disabled:opacity-50";
const dangerButtonClassName =
  "inline-flex items-center justify-center rounded-full bg-rose-600/12 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:-translate-y-0.5 hover:bg-rose-600/18 focus:outline-none focus:ring-4 focus:ring-rose-600/15 disabled:pointer-events-none disabled:opacity-50";

const statusClassNames: Record<VmStatus, string> = {
  creating: "border-sky-500/35 bg-sky-500/12 text-sky-700",
  deleting: "border-rose-500/35 bg-rose-500/12 text-rose-700",
  error: "border-rose-600/35 bg-rose-600/12 text-rose-800",
  running: "border-emerald-500/35 bg-emerald-500/12 text-emerald-700",
  stopped: "border-amber-500/35 bg-amber-500/12 text-amber-700",
};

const noticeToneClassNames: Record<Notice["tone"], string> = {
  error: "border-rose-500/25 bg-rose-600/10 text-rose-800",
  info: "border-sky-500/25 bg-sky-600/10 text-sky-800",
  success: "border-emerald-500/25 bg-emerald-600/10 text-emerald-800",
};

const quickCommands = ["pwd", "ls -la", "pnpm build", "pnpm test", "incus list"];
const emptyCreateDraft: CreateDraft = {
  templateId: "",
  name: "",
  cpu: "",
  ramMb: "",
  diskGb: "",
};

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

interface Notice {
  tone: "error" | "info" | "success";
  message: string;
}

type DialogState =
  | {
      kind: "clone";
      vmId: string;
      name: string;
    }
  | {
      kind: "snapshot";
      vmId: string;
      label: string;
    }
  | {
      kind: "capture-template";
      vmId: string;
      mode: "existing" | "new";
      templateId: string;
      name: string;
      description: string;
    }
  | {
      kind: "delete";
      vmId: string;
    };

export function App(): JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VmDetail | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createDirty, setCreateDirty] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [frameSeed, setFrameSeed] = useState(() => Date.now());
  const selectedVmIdRef = useRef<string | null>(null);

  const deferredVms = useDeferredValue(summary?.vms ?? []);
  const deferredTemplates = useDeferredValue(summary?.templates ?? []);
  const deferredJobs = useDeferredValue(summary?.jobs ?? []);

  useEffect(() => {
    selectedVmIdRef.current = selectedVmId;
  }, [selectedVmId]);

  useEffect(() => {
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

        const currentVmId = selectedVmIdRef.current;
        if (currentVmId && !nextSummary.vms.some((vm) => vm.id === currentVmId)) {
          setSelectedVmId(null);
          setDetail(null);
        }
      });
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

    setCreateDraft((current) =>
      syncCreateDraft(current, summary.templates, createDirty),
    );
  }, [summary, createDirty]);

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
    if (!selectedVmId) {
      return;
    }

    setFrameSeed(Date.now());
    const timer = window.setInterval(() => {
      setFrameSeed(Date.now());
    }, 1600);

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

  const selectedCreateTemplate =
    summary?.templates.find((template) => template.id === createDraft.templateId) ??
    summary?.templates[0] ??
    null;
  const detailIsLoading = Boolean(selectedVmId && (!detail || detail.vm.id !== selectedVmId));
  const isBusy = busyLabel !== null;

  async function refreshSummary(): Promise<DashboardSummary> {
    const nextSummary = await fetchJson<DashboardSummary>("/api/summary");
    startTransition(() => {
      setSummary(nextSummary);
    });
    return nextSummary;
  }

  async function refreshDetail(vmId: string): Promise<void> {
    const nextDetail = await fetchJson<VmDetail>(`/api/vms/${vmId}`);
    setDetail(nextDetail);
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

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
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
      "Queueing workspace creation",
      async () => {
        await postJson("/api/vms", payload);

        if (selectedCreateTemplate) {
          setCreateDirty(false);
          setCreateDraft(buildCreateDraft(selectedCreateTemplate));
        }

        await refreshSummary();
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

    const template = summary.templates.find(
      (entry) => entry.id === event.target.value,
    );

    if (!template) {
      return;
    }

    setCreateDirty(false);
    setCreateDraft(buildCreateDraft(template, createDraft.name));
  }

  async function handleDirectVmAction(
    vmId: string,
    action: "start" | "stop",
  ): Promise<void> {
    const vmName = summary?.vms.find((vm) => vm.id === vmId)?.name ?? vmId;

    await runMutation(
      `${titleCase(action)} ${vmName}`,
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

  async function handleResizeVm(vmId: string, resources: ResourceSpec): Promise<void> {
    const payload: ResizeVmInput = {
      resources,
    };
    const vmName = summary?.vms.find((vm) => vm.id === vmId)?.name ?? vmId;

    await runMutation(
      `Resizing ${vmName}`,
      async () => {
        await postJson(`/api/vms/${vmId}/resize`, payload);
        await refreshSummary();
        if (selectedVmIdRef.current === vmId) {
          await refreshDetail(vmId);
        }
      },
      `Queued resize for ${vmName}.`,
    );
  }

  async function handleCommand(vmId: string, command: string): Promise<void> {
    const payload: InjectCommandInput = {
      command,
    };
    const vmName = summary?.vms.find((vm) => vm.id === vmId)?.name ?? vmId;

    await runMutation(
      `Sending command to ${vmName}`,
      async () => {
        await postJson(`/api/vms/${vmId}/input`, payload);
        await refreshSummary();
        if (selectedVmIdRef.current === vmId) {
          await refreshDetail(vmId);
        }
      },
      `Queued command for ${vmName}.`,
    );
  }

  function openCloneDialog(vm: VmInstance): void {
    setDialog({
      kind: "clone",
      vmId: vm.id,
      name: `${vm.name}-clone`,
    });
  }

  function openSnapshotDialog(vm: VmInstance): void {
    setDialog({
      kind: "snapshot",
      vmId: vm.id,
      label: "",
    });
  }

  function openDeleteDialog(vm: VmInstance): void {
    setDialog({
      kind: "delete",
      vmId: vm.id,
    });
  }

  function openCaptureDialog(vm: VmInstance): void {
    const sourceTemplate =
      summary?.templates.find((template) => template.id === vm.templateId) ?? null;

    setDialog({
      kind: "capture-template",
      vmId: vm.id,
      mode: sourceTemplate ? "existing" : "new",
      templateId: sourceTemplate?.id ?? summary?.templates[0]?.id ?? "",
      name: sourceTemplate?.name ?? `Captured ${vm.name}`,
      description:
        sourceTemplate?.description ?? `Captured from workspace ${vm.name}.`,
    });
  }

  async function submitDialog(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!dialog) {
      return;
    }

    const vmName = summary?.vms.find((vm) => vm.id === dialog.vmId)?.name ?? dialog.vmId;

    switch (dialog.kind) {
      case "clone": {
        const payload: CloneVmInput = {
          sourceVmId: dialog.vmId,
          name: dialog.name.trim() || undefined,
        };

        await runMutation(
          `Cloning ${vmName}`,
          async () => {
            await postJson(`/api/vms/${dialog.vmId}/clone`, payload);
            setDialog(null);
            await refreshSummary();
            if (selectedVmIdRef.current === dialog.vmId) {
              await refreshDetail(dialog.vmId);
            }
          },
          `Queued clone for ${vmName}.`,
        );
        return;
      }
      case "snapshot": {
        const payload: SnapshotInput = {
          label: dialog.label.trim() || undefined,
        };

        await runMutation(
          `Snapshotting ${vmName}`,
          async () => {
            await postJson(`/api/vms/${dialog.vmId}/snapshot`, payload);
            setDialog(null);
            await refreshSummary();
            if (selectedVmIdRef.current === dialog.vmId) {
              await refreshDetail(dialog.vmId);
            }
          },
          `Queued snapshot for ${vmName}.`,
        );
        return;
      }
      case "capture-template": {
        const payload: CaptureTemplateInput = {
          templateId: dialog.mode === "existing" ? dialog.templateId : undefined,
          name: dialog.name.trim(),
          description: dialog.description.trim(),
        };
        const successCopy =
          dialog.mode === "existing"
            ? `Queued template refresh for ${dialog.name.trim()}.`
            : `Queued new template capture for ${dialog.name.trim()}.`;

        await runMutation(
          `Capturing template from ${vmName}`,
          async () => {
            await postJson(`/api/vms/${dialog.vmId}/template`, payload);
            setDialog(null);
            await refreshSummary();
            if (selectedVmIdRef.current === dialog.vmId) {
              await refreshDetail(dialog.vmId);
            }
          },
          successCopy,
        );
        return;
      }
      case "delete": {
        await runMutation(
          `Deleting ${vmName}`,
          async () => {
            await postJson(`/api/vms/${dialog.vmId}/delete`, {});
            setDialog(null);
            if (selectedVmIdRef.current === dialog.vmId) {
              setSelectedVmId(null);
              setDetail(null);
            }
            await refreshSummary();
          },
          `Queued delete for ${vmName}.`,
        );
        return;
      }
      default:
        return;
    }
  }

  function updateDialogField(field: string, value: string): void {
    setDialog((current) => {
      if (!current) {
        return current;
      }

      switch (current.kind) {
        case "clone":
          if (field === "name") {
            return {
              ...current,
              name: value,
            };
          }
          return current;
        case "snapshot":
          if (field === "label") {
            return {
              ...current,
              label: value,
            };
          }
          return current;
        case "capture-template":
          if (field === "mode" && (value === "existing" || value === "new")) {
            if (value === "existing") {
              const template =
                summary?.templates.find((template) => template.id === current.templateId) ??
                summary?.templates[0] ??
                null;

              return {
                ...current,
                mode: "existing",
                templateId: template?.id ?? "",
                name: template?.name ?? current.name,
                description: template?.description ?? current.description,
              };
            }

            const vm = summary?.vms.find((entry) => entry.id === current.vmId) ?? null;

            return {
              ...current,
              mode: "new",
              name: current.name || `Captured ${vm?.name ?? "workspace"}`,
              description:
                current.description ||
                `Captured from workspace ${vm?.name ?? "workspace"}.`,
            };
          }

          if (field === "templateId") {
            const template =
              summary?.templates.find((template) => template.id === value) ?? null;

            return {
              ...current,
              templateId: value,
              name: template?.name ?? current.name,
              description: template?.description ?? current.description,
            };
          }

          if (field === "name") {
            return {
              ...current,
              name: value,
            };
          }

          if (field === "description") {
            return {
              ...current,
              description: value,
            };
          }

          return current;
        case "delete":
          return current;
        default:
          return current;
      }
    });
  }

  if (!summary) {
    return <LoadingShell />;
  }

  return (
    <div className="relative min-h-screen px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      <div className="mx-auto max-w-[1680px] space-y-6">
        <header className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-3 rounded-full border border-slate-900/10 bg-white/68 px-4 py-2 backdrop-blur-xl">
              <span className="mono-font text-[0.72rem] uppercase tracking-[0.35em] text-slate-500">
                Server-First Desktop Orchestration POC
              </span>
              {busyLabel ? (
                <span className="rounded-full bg-amber-500/14 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-700">
                  {busyLabel}
                </span>
              ) : null}
            </div>
            <div className="max-w-4xl">
              <h1 className="display-font text-[clamp(2.7rem,6vw,5.4rem)] leading-[0.92] text-slate-950">
                Parallaize Control Deck
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
                One operator, one browser surface, many isolated desktops. The
                current slice is honest about its boundary: a real control
                plane, a React/Tailwind dashboard, and a mock desktop transport
                until host-backed noVNC is wired in.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <article className={metaCardClassName}>
              <p className="mono-font text-[0.72rem] uppercase tracking-[0.3em] text-slate-500">
                Provider
              </p>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <p className="display-font text-3xl text-slate-950">
                    {summary.provider.kind.toUpperCase()}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {summary.provider.detail}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.22em] ${
                    summary.provider.available
                      ? "bg-emerald-500/12 text-emerald-700"
                      : "bg-amber-500/12 text-amber-700"
                  }`}
                >
                  {summary.provider.available ? "Ready" : "Blocked"}
                </span>
              </div>
            </article>

            <article className={metaCardClassName}>
              <p className="mono-font text-[0.72rem] uppercase tracking-[0.3em] text-slate-500">
                Fleet
              </p>
              <p className="display-font mt-4 text-3xl text-slate-950">
                {summary.metrics.runningVmCount} running / {summary.metrics.totalVmCount} total
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {summary.metrics.totalCpu} CPU · {formatRam(summary.metrics.totalRamMb)} RAM ·{" "}
                {summary.metrics.totalDiskGb} GB disk across the visible workspace pool.
              </p>
            </article>
          </div>
        </header>

        {notice ? (
          <aside
            className={`rounded-[24px] border px-4 py-3 text-sm font-medium shadow-[0_18px_50px_rgba(15,23,42,0.12)] backdrop-blur-xl ${noticeToneClassNames[notice.tone]}`}
          >
            {notice.message}
          </aside>
        ) : null}

        <main className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <aside className={`${panelClassName} space-y-6`}>
            <section className="space-y-4">
              <div className="space-y-2">
                <p className="mono-font text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">
                  Provision
                </p>
                <h2 className="display-font text-[2rem] leading-none text-slate-950">
                  New Workspace
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  Launch from a saved environment template and override CPU, RAM,
                  or disk before the job enters the queue.
                </p>
              </div>

              <form className="space-y-4" onSubmit={(event) => void handleCreateWorkspace(event)}>
                <label className="block space-y-2">
                  <span className="mono-font text-[0.72rem] uppercase tracking-[0.24em] text-slate-500">
                    Template
                  </span>
                  <select
                    className={fieldClassName}
                    name="templateId"
                    value={createDraft.templateId}
                    onChange={handleTemplateChange}
                    disabled={isBusy}
                  >
                    {summary.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · {template.defaultResources.cpu} CPU /{" "}
                        {formatRam(template.defaultResources.ramMb)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="mono-font text-[0.72rem] uppercase tracking-[0.24em] text-slate-500">
                    Name
                  </span>
                  <input
                    className={fieldClassName}
                    name="name"
                    type="text"
                    value={createDraft.name}
                    placeholder="delta-lab"
                    disabled={isBusy}
                    onChange={(event) => handleCreateField("name", event.target.value)}
                    required
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block space-y-2">
                    <span className="mono-font text-[0.72rem] uppercase tracking-[0.24em] text-slate-500">
                      CPU
                    </span>
                    <input
                      className={fieldClassName}
                      name="cpu"
                      type="number"
                      min="1"
                      max="96"
                      value={createDraft.cpu}
                      disabled={isBusy}
                      onChange={(event) => handleCreateField("cpu", event.target.value)}
                      required
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="mono-font text-[0.72rem] uppercase tracking-[0.24em] text-slate-500">
                      RAM MB
                    </span>
                    <input
                      className={fieldClassName}
                      name="ramMb"
                      type="number"
                      min="1024"
                      max="262144"
                      value={createDraft.ramMb}
                      disabled={isBusy}
                      onChange={(event) => handleCreateField("ramMb", event.target.value)}
                      required
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="mono-font text-[0.72rem] uppercase tracking-[0.24em] text-slate-500">
                      Disk GB
                    </span>
                    <input
                      className={fieldClassName}
                      name="diskGb"
                      type="number"
                      min="10"
                      max="4096"
                      value={createDraft.diskGb}
                      disabled={isBusy}
                      onChange={(event) => handleCreateField("diskGb", event.target.value)}
                      required
                    />
                  </label>
                </div>

                <div className="rounded-[24px] border border-slate-900/8 bg-slate-900/[0.03] p-4">
                  <p className="mono-font text-[0.7rem] uppercase tracking-[0.24em] text-slate-500">
                    Template defaults
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {selectedCreateTemplate
                      ? `${selectedCreateTemplate.baseImage} · ${formatResources(selectedCreateTemplate.defaultResources)}`
                      : "No template selected"}
                  </p>
                </div>

                <button className={`${primaryButtonClassName} w-full`} type="submit" disabled={isBusy}>
                  Create workspace
                </button>
              </form>
            </section>

            <section className="space-y-4">
              <div className="space-y-2">
                <p className="mono-font text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">
                  Templates
                </p>
                <h2 className="display-font text-[2rem] leading-none text-slate-950">
                  Environment Library
                </h2>
              </div>

              <div className="space-y-3">
                {deferredTemplates.map((template, index) => (
                  <article
                    key={template.id}
                    className="card-raise rounded-[26px] border border-slate-900/8 bg-white/74 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
                    style={{
                      animationDelay: `${index * 70}ms`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="display-font text-xl text-slate-950">
                          {template.name}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {template.description}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-900/6 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-600">
                        {template.snapshotIds.length} snaps
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      {formatResources(template.defaultResources)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {template.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-slate-900/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {template.notes[0] ? (
                      <p className="mt-3 text-sm leading-6 text-slate-500">
                        {template.notes[0]}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <p className="mono-font text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">
                  Live Grid
                </p>
                <h2 className="display-font text-[2.4rem] leading-none text-slate-950">
                  Running Desktops
                </h2>
              </div>
              <div className="rounded-full border border-slate-900/10 bg-white/72 px-4 py-2 text-sm text-slate-700 backdrop-blur-xl">
                {summary.vms.length} workspaces visible · {summary.templates.length} templates loaded
              </div>
            </div>

            {deferredVms.length === 0 ? (
              <article className={`${panelClassName} flex min-h-[340px] items-center justify-center`}>
                <div className="max-w-md text-center">
                  <p className="mono-font text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">
                    Empty Fleet
                  </p>
                  <h3 className="display-font mt-4 text-[2rem] text-slate-950">
                    No workspaces yet
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    Provision a workspace from any template in the left rail to
                    populate the live grid and the job timeline.
                  </p>
                </div>
              </article>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {deferredVms.map((vm, index) => {
                  const template =
                    summary.templates.find((entry) => entry.id === vm.templateId) ?? null;
                  const primaryAction = vm.status === "running" ? "stop" : "start";

                  return (
                    <article
                      key={vm.id}
                      className="card-raise rounded-[32px] border border-slate-950/8 bg-[rgba(7,13,20,0.94)] p-4 text-slate-100 shadow-[0_28px_80px_rgba(7,13,20,0.35)]"
                      style={{
                        animationDelay: `${index * 55}ms`,
                      }}
                    >
                      <button
                        type="button"
                        className="block w-full overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/80 text-left transition hover:scale-[1.01] focus:outline-none focus:ring-4 focus:ring-white/15"
                        onClick={() => setSelectedVmId(vm.id)}
                      >
                        <img
                          className="h-52 w-full object-cover"
                          src={`/api/vms/${vm.id}/frame.svg?mode=tile&rev=${vm.frameRevision}`}
                          alt={`${vm.name} preview`}
                        />
                      </button>

                      <div className="mt-4 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="display-font text-[1.6rem] text-white">
                            {vm.name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-300">
                            {template?.name ?? "Unknown template"}
                          </p>
                        </div>
                        <StatusPill status={vm.status} />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200">
                          {formatResources(vm.resources)}
                        </span>
                        <span className="rounded-full bg-white/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300">
                          {vm.activeWindow}
                        </span>
                      </div>

                      <p className="mt-4 text-sm leading-6 text-slate-300">
                        {vm.lastAction}
                      </p>

                      <p className="mono-font mt-3 text-[0.72rem] uppercase tracking-[0.22em] text-slate-400">
                        {vm.workspacePath}
                      </p>

                      <div className="mt-5 flex flex-wrap gap-2">
                        <button
                          className={secondaryButtonClassName}
                          type="button"
                          disabled={isBusy}
                          onClick={() => setSelectedVmId(vm.id)}
                        >
                          Open
                        </button>
                        <button
                          className={ghostButtonClassName}
                          type="button"
                          disabled={isBusy}
                          onClick={() => openCloneDialog(vm)}
                        >
                          Clone
                        </button>
                        <button
                          className={ghostButtonClassName}
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDirectVmAction(vm.id, primaryAction)}
                        >
                          {primaryAction === "start" ? "Start" : "Stop"}
                        </button>
                        <button
                          className={ghostButtonClassName}
                          type="button"
                          disabled={isBusy}
                          onClick={() => openSnapshotDialog(vm)}
                        >
                          Snapshot
                        </button>
                        <button
                          className={dangerButtonClassName}
                          type="button"
                          disabled={isBusy}
                          onClick={() => openDeleteDialog(vm)}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className={`${panelClassName} space-y-4`}>
            <div className="space-y-2">
              <p className="mono-font text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">
                Timeline
              </p>
              <h2 className="display-font text-[2rem] leading-none text-slate-950">
                Recent Jobs
              </h2>
              <p className="text-sm leading-6 text-slate-600">
                Queue visibility is server-driven. Mutations enter immediately,
                then resolve through the job runner behind the API.
              </p>
            </div>

            {deferredJobs.length === 0 ? (
              <article className="rounded-[24px] border border-slate-900/8 bg-white/70 p-4">
                <h3 className="display-font text-xl text-slate-950">No jobs yet</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Provision, clone, resize, or snapshot a workspace to populate
                  the timeline.
                </p>
              </article>
            ) : (
              <div className="space-y-3">
                {deferredJobs.map((job) => (
                  <article
                    key={job.id}
                    className="rounded-[24px] border border-slate-900/8 bg-white/74 p-4 shadow-[0_12px_34px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="display-font text-xl text-slate-950">
                          {titleCase(job.kind)}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {job.message}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] ${
                          job.status === "succeeded"
                            ? "bg-emerald-500/12 text-emerald-700"
                            : job.status === "failed"
                              ? "bg-rose-600/12 text-rose-700"
                              : job.status === "running"
                                ? "bg-sky-500/12 text-sky-700"
                                : "bg-amber-500/12 text-amber-700"
                        }`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <p className="mono-font mt-4 text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                      {formatTimestamp(job.updatedAt)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </main>
      </div>

      {selectedVmId ? (
        <DetailDrawer
          detail={detail}
          frameSeed={frameSeed}
          isBusy={isBusy}
          isLoading={detailIsLoading}
          onClose={() => {
            setSelectedVmId(null);
            setDetail(null);
          }}
          onClone={openCloneDialog}
          onDelete={openDeleteDialog}
          onDirectAction={(vmId, action) => void handleDirectVmAction(vmId, action)}
          onCaptureTemplate={openCaptureDialog}
          onResize={(vmId, resources) => void handleResizeVm(vmId, resources)}
          onRunCommand={(vmId, command) => void handleCommand(vmId, command)}
          onSnapshot={openSnapshotDialog}
        />
      ) : null}

      {dialog ? (
        <ActionDialog
          dialog={dialog}
          isBusy={isBusy}
          templates={summary.templates}
          vm={summary.vms.find((vm) => vm.id === dialog.vmId) ?? null}
          onClose={() => setDialog(null)}
          onFieldChange={updateDialogField}
          onSubmit={(event) => void submitDialog(event)}
        />
      ) : null}
    </div>
  );
}

function DetailDrawer({
  detail,
  frameSeed,
  isBusy,
  isLoading,
  onCaptureTemplate,
  onClone,
  onClose,
  onDelete,
  onDirectAction,
  onResize,
  onRunCommand,
  onSnapshot,
}: {
  detail: VmDetail | null;
  frameSeed: number;
  isBusy: boolean;
  isLoading: boolean;
  onCaptureTemplate: (vm: VmInstance) => void;
  onClone: (vm: VmInstance) => void;
  onClose: () => void;
  onDelete: (vm: VmInstance) => void;
  onDirectAction: (vmId: string, action: "start" | "stop") => void;
  onResize: (vmId: string, resources: ResourceSpec) => void;
  onRunCommand: (vmId: string, command: string) => void;
  onSnapshot: (vm: VmInstance) => void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/18 backdrop-blur-[2px]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close workspace detail"
        onClick={onClose}
      />

      <section className="dialog-enter relative z-10 h-full w-full max-w-[980px] overflow-y-auto border-l border-white/25 bg-[rgba(245,239,229,0.92)] p-5 shadow-[-24px_0_80px_rgba(15,23,42,0.25)] backdrop-blur-xl sm:p-8">
        <div className="space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="mono-font text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">
                Workspace Detail
              </p>
              <h2 className="display-font text-[2.3rem] leading-none text-slate-950">
                {detail?.vm.name ?? "Loading workspace"}
              </h2>
              <p className="text-sm leading-6 text-slate-600">
                {detail
                  ? `${detail.template?.name ?? "Unknown template"} · ${formatResources(detail.vm.resources)}`
                  : "Fetching live state and activity feed from the control plane."}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {detail ? <StatusPill status={detail.vm.status} /> : null}
              <button
                className={secondaryButtonClassName}
                type="button"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          {isLoading || !detail ? (
            <div className="space-y-4">
              <div className="h-[360px] animate-pulse rounded-[32px] bg-white/70" />
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="h-[180px] animate-pulse rounded-[28px] bg-white/68" />
                <div className="h-[180px] animate-pulse rounded-[28px] bg-white/68" />
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_340px]">
                <section className="rounded-[34px] border border-slate-950/8 bg-[#08111a] p-4 text-slate-100 shadow-[0_28px_80px_rgba(8,17,26,0.35)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="mono-font text-[0.72rem] uppercase tracking-[0.3em] text-slate-400">
                        Session Feed
                      </p>
                      <p className="mt-2 text-sm text-slate-300">
                        Active window: {detail.vm.activeWindow}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-200">
                      {detail.provider.kind === "mock" ? "Synthetic preview" : "Live preview"}
                    </span>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/80">
                    <img
                      className="h-auto w-full"
                      src={`/api/vms/${detail.vm.id}/frame.svg?mode=detail&t=${frameSeed}`}
                      alt={`${detail.vm.name} session`}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200">
                      {detail.vm.workspacePath}
                    </span>
                    <span className="rounded-full bg-white/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300">
                      {detail.vm.liveSince
                        ? `Live since ${formatTimestamp(detail.vm.liveSince)}`
                        : "Currently stopped"}
                    </span>
                    <span className="rounded-full bg-white/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300">
                      Updated {formatTimestamp(detail.vm.updatedAt)}
                    </span>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-300">
                    {detail.provider.detail}
                  </p>
                </section>

                <div className="space-y-4">
                  <section className="rounded-[28px] border border-slate-900/8 bg-white/78 p-5 shadow-[0_16px_48px_rgba(15,23,42,0.12)]">
                    <div className="space-y-2">
                      <p className="mono-font text-[0.72rem] uppercase tracking-[0.28em] text-slate-500">
                        Operator Controls
                      </p>
                      <h3 className="display-font text-[1.6rem] text-slate-950">
                        Queue Actions
                      </h3>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className={primaryButtonClassName}
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          onDirectAction(
                            detail.vm.id,
                            detail.vm.status === "running" ? "stop" : "start",
                          )
                        }
                      >
                        {detail.vm.status === "running" ? "Stop workspace" : "Start workspace"}
                      </button>
                      <button
                        className={ghostButtonClassName}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onSnapshot(detail.vm)}
                      >
                        Snapshot
                      </button>
                      <button
                        className={ghostButtonClassName}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onClone(detail.vm)}
                      >
                        Clone
                      </button>
                      <button
                        className={ghostButtonClassName}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onCaptureTemplate(detail.vm)}
                      >
                        Capture template
                      </button>
                      <button
                        className={dangerButtonClassName}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDelete(detail.vm)}
                      >
                        Delete
                      </button>
                    </div>
                  </section>

                  <ResizeForm
                    isBusy={isBusy}
                    onSubmit={(resources) => onResize(detail.vm.id, resources)}
                    vm={detail.vm}
                  />

                  <CommandConsole
                    isBusy={isBusy}
                    onSubmit={(command) => onRunCommand(detail.vm.id, command)}
                    vm={detail.vm}
                  />
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <ListPanel
                  items={detail.vm.activityLog.slice().reverse()}
                  title="Activity Feed"
                  subtitle="Synthetic host and guest activity gathered for the current VM."
                  renderItem={(entry, index) => (
                    <li
                      key={`${detail.vm.id}-activity-${index}`}
                      className="rounded-[20px] border border-slate-900/8 bg-white/72 p-4 text-sm leading-6 text-slate-700"
                    >
                      {entry}
                    </li>
                  )}
                  emptyCopy="No activity has been recorded for this workspace yet."
                />

                <ListPanel
                  items={detail.snapshots.slice(0, 8)}
                  title="Snapshots"
                  subtitle="Saved VM checkpoints and template capture points linked to this workspace."
                  renderItem={(snapshot) => (
                    <li
                      key={snapshot.id}
                      className="rounded-[20px] border border-slate-900/8 bg-white/72 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="display-font text-lg text-slate-950">
                            {snapshot.label}
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {snapshot.summary}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-900/6 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-600">
                          {snapshot.resources.cpu} CPU
                        </span>
                      </div>
                      <p className="mono-font mt-4 text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                        {formatTimestamp(snapshot.createdAt)}
                      </p>
                    </li>
                  )}
                  emptyCopy="No snapshots are attached to this workspace yet."
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <ListPanel
                  items={detail.recentJobs}
                  title="Recent Jobs"
                  subtitle="Latest server-side actions targeting this workspace."
                  renderItem={(job) => (
                    <li
                      key={job.id}
                      className="rounded-[20px] border border-slate-900/8 bg-white/72 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="display-font text-lg text-slate-950">
                            {titleCase(job.kind)}
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {job.message}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-900/6 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-600">
                          {job.status}
                        </span>
                      </div>
                      <p className="mono-font mt-4 text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                        {formatTimestamp(job.updatedAt)}
                      </p>
                    </li>
                  )}
                  emptyCopy="No job history is available for this workspace yet."
                />

                <section className="rounded-[30px] border border-slate-900/8 bg-white/78 p-5 shadow-[0_16px_48px_rgba(15,23,42,0.12)]">
                  <div className="space-y-2">
                    <p className="mono-font text-[0.72rem] uppercase tracking-[0.28em] text-slate-500">
                      Template Intelligence
                    </p>
                    <h3 className="display-font text-[1.7rem] text-slate-950">
                      {detail.template?.name ?? "No template linked"}
                    </h3>
                  </div>

                  {detail.template ? (
                    <>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {detail.template.description}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {detail.template.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-900/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-[22px] border border-slate-900/8 bg-slate-900/[0.03] p-4">
                          <p className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                            Base image
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-700">
                            {detail.template.baseImage}
                          </p>
                        </div>
                        <div className="rounded-[22px] border border-slate-900/8 bg-slate-900/[0.03] p-4">
                          <p className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                            Snapshot history
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-700">
                            {detail.template.snapshotIds.length} linked snapshots preserved on the template record.
                          </p>
                        </div>
                      </div>
                      {detail.template.notes.length > 0 ? (
                        <ul className="mt-4 space-y-3">
                          {detail.template.notes.map((note) => (
                            <li
                              key={note}
                              className="rounded-[20px] border border-slate-900/8 bg-white/70 p-4 text-sm leading-6 text-slate-700"
                            >
                              {note}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      This workspace is no longer linked to a visible template entry.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function ResizeForm({
  isBusy,
  onSubmit,
  vm,
}: {
  isBusy: boolean;
  onSubmit: (resources: ResourceSpec) => void;
  vm: VmInstance;
}): JSX.Element {
  const [draft, setDraft] = useState(() => resourceDraft(vm.resources));

  useEffect(() => {
    setDraft(resourceDraft(vm.resources));
  }, [vm.id, vm.resources.cpu, vm.resources.diskGb, vm.resources.ramMb]);

  return (
    <section className="rounded-[28px] border border-slate-900/8 bg-white/78 p-5 shadow-[0_16px_48px_rgba(15,23,42,0.12)]">
      <div className="space-y-2">
        <p className="mono-font text-[0.72rem] uppercase tracking-[0.28em] text-slate-500">
          Resize Resources
        </p>
        <h3 className="display-font text-[1.6rem] text-slate-950">Edit limits</h3>
      </div>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            cpu: Number(draft.cpu),
            ramMb: Number(draft.ramMb),
            diskGb: Number(draft.diskGb),
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-2">
            <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
              CPU
            </span>
            <input
              className={fieldClassName}
              type="number"
              min="1"
              max="96"
              value={draft.cpu}
              disabled={isBusy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  cpu: event.target.value,
                }))
              }
              required
            />
          </label>
          <label className="block space-y-2">
            <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
              RAM MB
            </span>
            <input
              className={fieldClassName}
              type="number"
              min="1024"
              max="262144"
              value={draft.ramMb}
              disabled={isBusy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ramMb: event.target.value,
                }))
              }
              required
            />
          </label>
          <label className="block space-y-2">
            <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
              Disk GB
            </span>
            <input
              className={fieldClassName}
              type="number"
              min="10"
              max="4096"
              value={draft.diskGb}
              disabled={isBusy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  diskGb: event.target.value,
                }))
              }
              required
            />
          </label>
        </div>
        <button className={`${primaryButtonClassName} w-full`} type="submit" disabled={isBusy}>
          Apply resources
        </button>
      </form>
    </section>
  );
}

function CommandConsole({
  isBusy,
  onSubmit,
  vm,
}: {
  isBusy: boolean;
  onSubmit: (command: string) => void;
  vm: VmInstance;
}): JSX.Element {
  const [command, setCommand] = useState("");

  useEffect(() => {
    setCommand("");
  }, [vm.id]);

  return (
    <section className="rounded-[28px] border border-slate-900/8 bg-white/78 p-5 shadow-[0_16px_48px_rgba(15,23,42,0.12)]">
      <div className="space-y-2">
        <p className="mono-font text-[0.72rem] uppercase tracking-[0.28em] text-slate-500">
          Inject Command
        </p>
        <h3 className="display-font text-[1.6rem] text-slate-950">Workspace shell</h3>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {quickCommands.map((entry) => (
          <button
            key={entry}
            className={ghostButtonClassName}
            type="button"
            disabled={isBusy || vm.status !== "running"}
            onClick={() => onSubmit(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(command);
          setCommand("");
        }}
      >
        <label className="block space-y-2">
          <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
            Command
          </span>
          <input
            className={fieldClassName}
            type="text"
            value={command}
            placeholder="pnpm build"
            disabled={isBusy || vm.status !== "running"}
            onChange={(event) => setCommand(event.target.value)}
            required
          />
        </label>
        <button className={`${primaryButtonClassName} w-full`} type="submit" disabled={isBusy || vm.status !== "running"}>
          Send to workspace
        </button>
      </form>
    </section>
  );
}

function ActionDialog({
  dialog,
  isBusy,
  onClose,
  onFieldChange,
  onSubmit,
  templates,
  vm,
}: {
  dialog: DialogState;
  isBusy: boolean;
  onClose: () => void;
  onFieldChange: (field: string, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  templates: EnvironmentTemplate[];
  vm: VmInstance | null;
}): JSX.Element | null {
  if (!vm) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/42 p-4 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close action dialog"
        onClick={onClose}
      />

      <section className="dialog-enter relative z-10 w-full max-w-xl rounded-[32px] border border-white/20 bg-[rgba(249,244,236,0.96)] p-6 shadow-[0_36px_100px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-7">
        <div className="space-y-2">
          <p className="mono-font text-[0.72rem] uppercase tracking-[0.3em] text-slate-500">
            Action Composer
          </p>
          <h3 className="display-font text-[2rem] leading-none text-slate-950">
            {dialog.kind === "clone"
              ? `Clone ${vm.name}`
              : dialog.kind === "snapshot"
                ? `Snapshot ${vm.name}`
                : dialog.kind === "capture-template"
                  ? `Capture template from ${vm.name}`
                  : `Delete ${vm.name}`}
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            {dialog.kind === "clone"
              ? "Create a new workspace from the selected VM state."
              : dialog.kind === "snapshot"
                ? "Queue a checkpoint without interrupting the dashboard flow."
                : dialog.kind === "capture-template"
                  ? "Create a new template or refresh an existing one while preserving its snapshot history."
                  : "Deletion removes the VM from the visible fleet after the job runner completes."}
          </p>
        </div>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          {dialog.kind === "clone" ? (
            <label className="block space-y-2">
              <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                Clone name
              </span>
              <input
                className={fieldClassName}
                type="text"
                value={dialog.name}
                onChange={(event) => onFieldChange("name", event.target.value)}
                disabled={isBusy}
                required
              />
            </label>
          ) : null}

          {dialog.kind === "snapshot" ? (
            <label className="block space-y-2">
              <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                Snapshot label
              </span>
              <input
                className={fieldClassName}
                type="text"
                value={dialog.label}
                placeholder="checkpoint"
                onChange={(event) => onFieldChange("label", event.target.value)}
                disabled={isBusy}
              />
            </label>
          ) : null}

          {dialog.kind === "capture-template" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                    Save mode
                  </span>
                  <select
                    className={fieldClassName}
                    value={dialog.mode}
                    onChange={(event) => onFieldChange("mode", event.target.value)}
                    disabled={isBusy}
                  >
                    <option value="existing">Update existing template</option>
                    <option value="new">Create new template</option>
                  </select>
                </label>

                {dialog.mode === "existing" ? (
                  <label className="block space-y-2">
                    <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                      Existing template
                    </span>
                    <select
                      className={fieldClassName}
                      value={dialog.templateId}
                      onChange={(event) => onFieldChange("templateId", event.target.value)}
                      disabled={isBusy}
                    >
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <label className="block space-y-2">
                <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                  Template name
                </span>
                <input
                  className={fieldClassName}
                  type="text"
                  value={dialog.name}
                  onChange={(event) => onFieldChange("name", event.target.value)}
                  disabled={isBusy}
                  required
                />
              </label>

              <label className="block space-y-2">
                <span className="mono-font text-[0.72rem] uppercase tracking-[0.22em] text-slate-500">
                  Description
                </span>
                <textarea
                  className={`${fieldClassName} min-h-28 resize-y`}
                  value={dialog.description}
                  onChange={(event) => onFieldChange("description", event.target.value)}
                  disabled={isBusy}
                />
              </label>
            </>
          ) : null}

          {dialog.kind === "delete" ? (
            <div className="rounded-[24px] border border-rose-500/18 bg-rose-600/8 p-4 text-sm leading-6 text-rose-900">
              This queues a delete job for <strong>{vm.name}</strong>. The VM is
              removed from the live grid once the server-side action completes.
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button className={secondaryButtonClassName} type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className={dialog.kind === "delete" ? dangerButtonClassName : primaryButtonClassName}
              type="submit"
              disabled={isBusy}
            >
              {dialog.kind === "clone"
                ? "Queue clone"
                : dialog.kind === "snapshot"
                  ? "Queue snapshot"
                  : dialog.kind === "capture-template"
                    ? dialog.mode === "existing"
                      ? "Update template"
                      : "Create template"
                    : "Queue delete"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ListPanel<T>({
  emptyCopy,
  items,
  renderItem,
  subtitle,
  title,
}: {
  emptyCopy: string;
  items: T[];
  renderItem: (item: T, index: number) => JSX.Element;
  subtitle: string;
  title: string;
}): JSX.Element {
  return (
    <section className="rounded-[30px] border border-slate-900/8 bg-white/78 p-5 shadow-[0_16px_48px_rgba(15,23,42,0.12)]">
      <div className="space-y-2">
        <p className="mono-font text-[0.72rem] uppercase tracking-[0.28em] text-slate-500">
          {title}
        </p>
        <p className="text-sm leading-6 text-slate-600">{subtitle}</p>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-[20px] border border-slate-900/8 bg-white/70 p-4 text-sm leading-6 text-slate-600">
          {emptyCopy}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">{items.map(renderItem)}</ul>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: VmStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${statusClassNames[status]}`}
    >
      {status}
    </span>
  );
}

function LoadingShell(): JSX.Element {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
      <div className="mx-auto max-w-[1680px] space-y-6">
        <div className="h-28 animate-pulse rounded-[36px] bg-white/70" />
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <div className="h-[720px] animate-pulse rounded-[32px] bg-white/68" />
          <div className="h-[720px] animate-pulse rounded-[32px] bg-white/68" />
          <div className="h-[720px] animate-pulse rounded-[32px] bg-white/68" />
        </div>
      </div>
    </div>
  );
}

function buildCreateDraft(template: EnvironmentTemplate, currentName = ""): CreateDraft {
  return {
    templateId: template.id,
    name: currentName.trim() || `${slugify(template.name)}-01`,
    cpu: String(template.defaultResources.cpu),
    ramMb: String(template.defaultResources.ramMb),
    diskGb: String(template.defaultResources.diskGb),
  };
}

function syncCreateDraft(
  current: CreateDraft,
  templates: EnvironmentTemplate[],
  createDirty: boolean,
): CreateDraft {
  const template =
    templates.find((entry) => entry.id === current.templateId) ?? templates[0];

  if (!template) {
    return current;
  }

  if (!current.templateId) {
    return buildCreateDraft(template);
  }

  if (createDirty) {
    return {
      ...current,
      templateId: template.id,
    };
  }

  return buildCreateDraft(template, current.name);
}

function resourceDraft(resources: ResourceSpec): ResourceDraft {
  return {
    cpu: String(resources.cpu),
    ramMb: String(resources.ramMb),
    diskGb: String(resources.diskGb),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.ok === false ? payload.error : `Request failed: ${response.status}`);
  }

  return payload.data;
}

async function postJson<T>(url: string, payload: T): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as ApiResponse<Record<string, unknown>>;

  if (!response.ok || json.ok === false) {
    throw new Error(json.ok === false ? json.error : `Request failed: ${response.status}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function titleCase(value: string): string {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
