import {
  formatRam,
  formatResources,
  formatTimestamp,
} from "../../../packages/shared/src/helpers.js";
import type {
  ActionJob,
  ApiEnvelope,
  CaptureTemplateInput,
  CloneVmInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  InjectCommandInput,
  ResizeVmInput,
  SnapshotInput,
  VmDetail,
  VmInstance,
} from "../../../packages/shared/src/types.js";

const createForm = mustElement<HTMLFormElement>("#create-form");
const templateSelect = mustElement<HTMLSelectElement>("#template-select");
const vmNameInput = mustElement<HTMLInputElement>("#vm-name");
const cpuInput = mustElement<HTMLInputElement>("#cpu-input");
const ramInput = mustElement<HTMLInputElement>("#ram-input");
const diskInput = mustElement<HTMLInputElement>("#disk-input");
const vmGrid = mustElement<HTMLDivElement>("#vm-grid");
const templateList = mustElement<HTMLDivElement>("#template-list");
const jobList = mustElement<HTMLDivElement>("#job-list");
const providerPill = mustElement<HTMLElement>("#provider-pill");
const providerDetail = mustElement<HTMLParagraphElement>("#provider-detail");
const fleetMetric = mustElement<HTMLElement>("#fleet-metric");
const fleetDetail = mustElement<HTMLParagraphElement>("#fleet-detail");
const gridSummary = mustElement<HTMLParagraphElement>("#grid-summary");
const overlay = mustElement<HTMLDivElement>("#detail-overlay");
const closeDetailButton = mustElement<HTMLButtonElement>("#close-detail");
const detailContent = mustElement<HTMLDivElement>("#detail-content");
const emptyStateTemplate = mustElement<HTMLTemplateElement>("#empty-state-template");

let currentSummary: DashboardSummary | null = null;
let selectedVmId: string | null = null;
let selectedVmDetailRequest = 0;
let createFormDirty = false;
let detailFrameTimer: number | null = null;

bootstrap().catch((error) => {
  window.console.error(error);
});

async function bootstrap(): Promise<void> {
  createForm.addEventListener("submit", (event) => {
    void runSafely(onCreateVm(event));
  });
  templateSelect.addEventListener("change", () => {
    createFormDirty = false;
    syncResourceDefaults(true);
  });
  vmNameInput.addEventListener("input", markCreateFormDirty);
  cpuInput.addEventListener("input", markCreateFormDirty);
  ramInput.addEventListener("input", markCreateFormDirty);
  diskInput.addEventListener("input", markCreateFormDirty);
  vmGrid.addEventListener("click", (event) => {
    void runSafely(onVmGridClick(event));
  });
  detailContent.addEventListener("click", (event) => {
    void runSafely(onDetailActionClick(event));
  });
  detailContent.addEventListener("submit", (event) => {
    void runSafely(onDetailSubmit(event));
  });
  closeDetailButton.addEventListener("click", closeDetail);
  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.closeOverlay === "true") {
      closeDetail();
    }
  });

  await refreshSummary();
  connectEvents();
}

async function refreshSummary(): Promise<void> {
  const summary = await fetchJson<DashboardSummary>("/api/summary");
  currentSummary = summary;
  renderSummary(summary);
}

function connectEvents(): void {
  const eventSource = new EventSource("/events");

  eventSource.addEventListener("summary", (event) => {
    const summary = JSON.parse((event as MessageEvent<string>).data) as DashboardSummary;
    currentSummary = summary;
    renderSummary(summary);

    if (selectedVmId) {
      const stillExists = summary.vms.some((vm) => vm.id === selectedVmId);
      if (!stillExists) {
        closeDetail();
      }
    }
  });

  eventSource.addEventListener("error", () => {
    providerDetail.textContent = "Live stream interrupted. The dashboard will retry automatically.";
  });
}

function renderSummary(summary: DashboardSummary): void {
  providerPill.textContent = summary.provider.kind.toUpperCase();
  providerDetail.textContent = summary.provider.detail;
  fleetMetric.textContent = `${summary.metrics.runningVmCount} running / ${summary.metrics.totalVmCount} total`;
  fleetDetail.textContent = `${summary.metrics.totalCpu} CPU · ${formatRam(summary.metrics.totalRamMb)} RAM · ${summary.metrics.totalDiskGb} GB disk`;
  gridSummary.textContent = `${summary.vms.length} workspaces visible · ${summary.templates.length} templates loaded`;

  renderTemplateOptions(summary.templates);
  renderTemplateList(summary.templates);
  renderJobList(summary.jobs);
  renderVmGrid(summary.vms, summary.templates);
}

function renderTemplateOptions(templates: EnvironmentTemplate[]): void {
  const currentValue = templateSelect.value;
  templateSelect.innerHTML = templates
    .map(
      (template) =>
        `<option value="${template.id}">${escapeHtml(template.name)} · ${template.defaultResources.cpu} CPU / ${formatRam(template.defaultResources.ramMb)}</option>`,
    )
    .join("");

  const currentTemplateExists = currentValue
    ? templates.some((template) => template.id === currentValue)
    : false;

  if (currentTemplateExists) {
    templateSelect.value = currentValue;
  }

  syncResourceDefaults(!createFormDirty || !currentTemplateExists);
}

function syncResourceDefaults(force = false): void {
  if (!currentSummary) {
    return;
  }

  const template =
    currentSummary.templates.find((entry) => entry.id === templateSelect.value) ??
    currentSummary.templates[0];

  if (!template) {
    return;
  }

  if (!force) {
    return;
  }

  cpuInput.value = String(template.defaultResources.cpu);
  ramInput.value = String(template.defaultResources.ramMb);
  diskInput.value = String(template.defaultResources.diskGb);

  if (!vmNameInput.value.trim()) {
    vmNameInput.value = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-01`;
  }
}

function renderTemplateList(templates: EnvironmentTemplate[]): void {
  templateList.innerHTML = templates
    .map(
      (template) => `
        <article class="template-item">
          <h3>${escapeHtml(template.name)}</h3>
          <p>${escapeHtml(template.description)}</p>
          <p>${formatResources(template.defaultResources)}</p>
          <div class="template-tags">
            ${template.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderJobList(jobs: ActionJob[]): void {
  if (jobs.length === 0) {
    jobList.innerHTML = `<article class="job-item"><h3>No jobs yet</h3><p>Provision, clone, snapshot, or resize a workspace to populate the timeline.</p></article>`;
    return;
  }

  jobList.innerHTML = jobs
    .map(
      (job) => `
        <article class="job-item">
          <h3>${escapeHtml(job.kind)}</h3>
          <div class="job-status ${job.status}">${escapeHtml(job.status)}</div>
          <p>${escapeHtml(job.message)}</p>
          <p>${formatTimestamp(job.updatedAt)}</p>
        </article>
      `,
    )
    .join("");
}

function renderVmGrid(vms: VmInstance[], templates: EnvironmentTemplate[]): void {
  if (vms.length === 0) {
    vmGrid.replaceChildren(emptyStateTemplate.content.cloneNode(true));
    return;
  }

  vmGrid.innerHTML = vms
    .map((vm) => {
      const template = templates.find((entry) => entry.id === vm.templateId);
      const primaryAction = vm.status === "running" ? "stop" : "start";
      const primaryLabel = vm.status === "running" ? "Stop" : "Start";

      return `
        <article class="vm-card" data-open-vm="${vm.id}">
          <img class="vm-preview" src="/api/vms/${vm.id}/frame.svg?mode=tile&rev=${vm.frameRevision}" alt="${escapeHtml(vm.name)} preview" />
          <div class="vm-copy">
            <div class="vm-title-row">
              <div>
                <h3>${escapeHtml(vm.name)}</h3>
                <p>${escapeHtml(template?.name ?? "Unknown template")}</p>
              </div>
              <span class="status-pill status-${vm.status}">${escapeHtml(vm.status)}</span>
            </div>
            <div class="vm-meta">
              <span class="tag">${escapeHtml(formatResources(vm.resources))}</span>
              <span class="tag">${escapeHtml(vm.workspacePath)}</span>
            </div>
            <p>${escapeHtml(vm.lastAction)}</p>
            <div class="vm-actions">
              <button class="secondary-button" type="button" data-open-vm="${vm.id}">Open</button>
              <button class="ghost-button" type="button" data-action="clone" data-vm-id="${vm.id}">Clone</button>
              <button class="ghost-button" type="button" data-action="${primaryAction}" data-vm-id="${vm.id}">${primaryLabel}</button>
              <button class="ghost-button" type="button" data-action="snapshot" data-vm-id="${vm.id}">Snapshot</button>
              <button class="danger-button" type="button" data-action="delete" data-vm-id="${vm.id}">Delete</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function openDetail(vmId: string): Promise<void> {
  selectedVmId = vmId;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  detailContent.innerHTML = `<div class="detail-card"><h3>Loading workspace</h3><p>Fetching live state for ${escapeHtml(vmId)}.</p></div>`;

  const requestId = ++selectedVmDetailRequest;
  const detail = await fetchJson<VmDetail>(`/api/vms/${vmId}`);
  if (requestId !== selectedVmDetailRequest || selectedVmId !== vmId) {
    return;
  }

  renderDetail(detail);
}

function renderDetail(detail: VmDetail): void {
  const vm = detail.vm;
  const frameSource = `/api/vms/${vm.id}/frame.svg?mode=detail&rev=${vm.frameRevision}`;
  const recentLogs = vm.activityLog
    .slice()
    .reverse()
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const recentSnapshots = detail.snapshots
    .slice(0, 6)
    .map(
      (snapshot) => `
        <li>
          <strong>${escapeHtml(snapshot.label)}</strong>
          <p>${escapeHtml(snapshot.summary)}</p>
          <p>${formatTimestamp(snapshot.createdAt)}</p>
        </li>
      `,
    )
    .join("");
  const recentJobs = detail.recentJobs
    .map(
      (job) => `
        <li>
          <strong>${escapeHtml(job.kind)}</strong>
          <p>${escapeHtml(job.message)}</p>
          <p>${formatTimestamp(job.updatedAt)}</p>
        </li>
      `,
    )
    .join("");

  detailContent.innerHTML = `
    <div class="detail-title">
      <div>
        <p class="detail-note">Workspace detail</p>
        <h2>${escapeHtml(vm.name)}</h2>
        <p class="detail-meta">${escapeHtml(detail.template?.name ?? "Unknown template")} · ${escapeHtml(formatResources(vm.resources))}</p>
      </div>
      <span class="status-pill status-${vm.status}">${escapeHtml(vm.status)}</span>
    </div>
    <div class="detail-layout">
      <div class="detail-screen">
        <img src="${frameSource}" alt="${escapeHtml(vm.name)} live frame" />
      </div>
      <div class="detail-sidebar">
        <section class="detail-card">
          <h3>Operator controls</h3>
          <div class="detail-actions">
            <button class="secondary-button" type="button" data-open-command="pnpm build" data-vm-id="${vm.id}">Run build</button>
            <button class="ghost-button" type="button" data-open-command="git status --short" data-vm-id="${vm.id}">Git status</button>
            <button class="ghost-button" type="button" data-action="snapshot" data-vm-id="${vm.id}">Snapshot</button>
            <button class="ghost-button" type="button" data-action="clone" data-vm-id="${vm.id}">Clone</button>
            <button class="danger-button" type="button" data-action="delete" data-vm-id="${vm.id}">Delete</button>
          </div>
        </section>

        <section class="detail-card">
          <h3>Resize resources</h3>
          <form class="detail-form" data-form="resize" data-vm-id="${vm.id}">
            <div class="resource-grid">
              <label><span>CPU</span><input name="cpu" type="number" min="1" max="96" value="${vm.resources.cpu}" required /></label>
              <label><span>RAM (MB)</span><input name="ramMb" type="number" min="1024" max="262144" value="${vm.resources.ramMb}" required /></label>
              <label><span>Disk (GB)</span><input name="diskGb" type="number" min="10" max="4096" value="${vm.resources.diskGb}" required /></label>
            </div>
            <button class="primary-button" type="submit">Apply resources</button>
          </form>
        </section>

        <section class="detail-card">
          <h3>Inject command</h3>
          <div class="quick-actions">
            <button class="ghost-button" type="button" data-open-command="pwd" data-vm-id="${vm.id}">pwd</button>
            <button class="ghost-button" type="button" data-open-command="ls -la" data-vm-id="${vm.id}">ls -la</button>
            <button class="ghost-button" type="button" data-open-command="pnpm test" data-vm-id="${vm.id}">pnpm test</button>
            <button class="ghost-button" type="button" data-open-command="incus list" data-vm-id="${vm.id}">incus list</button>
          </div>
          <form class="detail-form" data-form="command" data-vm-id="${vm.id}">
            <label>
              <span>Command</span>
              <input name="command" type="text" placeholder="pnpm build" required />
            </label>
            <button class="primary-button" type="submit">Send to workspace</button>
          </form>
        </section>
      </div>
    </div>
    <div class="detail-layout">
      <section class="detail-card detail-section">
        <h3>Activity feed</h3>
        <ul class="detail-list">${recentLogs || "<li>No activity yet</li>"}</ul>
      </section>
      <section class="detail-card detail-section">
        <h3>Snapshots</h3>
        <ul class="detail-list">${recentSnapshots || "<li>No snapshots yet</li>"}</ul>
      </section>
    </div>
    <div class="detail-layout">
      <section class="detail-card detail-section">
        <h3>Recent jobs</h3>
        <ul class="detail-list">${recentJobs || "<li>No job history yet</li>"}</ul>
      </section>
      <section class="detail-card detail-section">
        <h3>Template capture</h3>
        <p>Capture the current workspace as a reusable environment template.</p>
        <div class="detail-actions">
          <button class="secondary-button" type="button" data-action="capture-template" data-vm-id="${vm.id}">Create template from VM</button>
          <button class="ghost-button" type="button" data-action="${vm.status === "running" ? "stop" : "start"}" data-vm-id="${vm.id}">
            ${vm.status === "running" ? "Pause workspace" : "Resume workspace"}
          </button>
        </div>
      </section>
    </div>
  `;

  startDetailFrameTicker(vm.id);
}

async function onCreateVm(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const payload: CreateVmInput = {
    templateId: templateSelect.value,
    name: vmNameInput.value.trim(),
    resources: {
      cpu: Number(cpuInput.value),
      ramMb: Number(ramInput.value),
      diskGb: Number(diskInput.value),
    },
  };

  await postJson("/api/vms", payload);
  vmNameInput.value = "";
  createFormDirty = false;
  syncResourceDefaults(true);
}

async function onVmGridClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const actionTrigger = target.closest<HTMLButtonElement>("[data-action]");
  if (actionTrigger) {
    event.stopPropagation();
    const vmId = actionTrigger.dataset.vmId;
    const action = actionTrigger.dataset.action;
    if (!vmId || !action) {
      return;
    }

    await runAction(vmId, action);
    return;
  }

  const openTrigger = target.closest<HTMLElement>("[data-open-vm]");
  if (openTrigger) {
    event.preventDefault();
    const vmId = openTrigger.dataset.openVm;
    if (vmId) {
      await openDetail(vmId);
    }
  }
}

async function onDetailActionClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const commandButton = target.closest<HTMLButtonElement>("[data-open-command]");
  if (commandButton?.dataset.openCommand && commandButton.dataset.vmId) {
    const payload: InjectCommandInput = {
      command: commandButton.dataset.openCommand,
    };
    await postJson(`/api/vms/${commandButton.dataset.vmId}/input`, payload);
    await openDetail(commandButton.dataset.vmId);
    return;
  }

  const actionButton = target.closest<HTMLButtonElement>("[data-action]");
  if (!actionButton?.dataset.action || !actionButton.dataset.vmId) {
    return;
  }

  await runAction(actionButton.dataset.vmId, actionButton.dataset.action);
}

async function onDetailSubmit(event: SubmitEvent): Promise<void> {
  const form = event.target as HTMLFormElement;
  const formType = form.dataset.form;
  const vmId = form.dataset.vmId;
  if (!formType || !vmId) {
    return;
  }

  event.preventDefault();

  if (formType === "resize") {
    const payload: ResizeVmInput = {
      resources: {
        cpu: Number(readNamedField(form, "cpu")),
        ramMb: Number(readNamedField(form, "ramMb")),
        diskGb: Number(readNamedField(form, "diskGb")),
      },
    };
    await postJson(`/api/vms/${vmId}/resize`, payload);
    await openDetail(vmId);
    return;
  }

  if (formType === "command") {
    const payload: InjectCommandInput = {
      command: readNamedField(form, "command"),
    };
    await postJson(`/api/vms/${vmId}/input`, payload);
    form.reset();
    await openDetail(vmId);
  }
}

async function runAction(vmId: string, action: string): Promise<void> {
  switch (action) {
    case "start":
    case "stop":
    case "delete": {
      if (action === "delete" && !window.confirm("Delete this workspace?")) {
        return;
      }
      await postJson(`/api/vms/${vmId}/${action}`, {});
      if (action !== "delete") {
        await openDetail(vmId);
      }
      return;
    }
    case "clone": {
      const requestedName = window.prompt("Name for the clone", "");
      const payload: CloneVmInput = {
        sourceVmId: vmId,
        name: requestedName?.trim() || undefined,
      };
      await postJson(`/api/vms/${vmId}/clone`, payload);
      await openDetail(vmId);
      return;
    }
    case "snapshot": {
      const label = window.prompt("Snapshot label", "checkpoint") ?? "";
      const payload: SnapshotInput = {
        label,
      };
      await postJson(`/api/vms/${vmId}/snapshot`, payload);
      await openDetail(vmId);
      return;
    }
    case "capture-template": {
      const name = window.prompt("Template name", "Captured Workspace");
      if (!name) {
        return;
      }
      const description =
        window.prompt("Template description", "Captured from a running workspace") ?? "";
      const payload: CaptureTemplateInput = {
        name,
        description,
      };
      await postJson(`/api/vms/${vmId}/template`, payload);
      await openDetail(vmId);
      return;
    }
    default:
      return;
  }
}

function closeDetail(): void {
  selectedVmId = null;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  stopDetailFrameTicker();
}

function readNamedField(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing field ${name}`);
  }

  return field.value.trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as ApiEnvelope<T> | { ok: false; error: string };

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

  const json = (await response.json()) as { ok: boolean; error?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? `Request failed: ${response.status}`);
  }
}

function mustElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element for selector ${selector}`);
  }

  return element;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markCreateFormDirty(): void {
  createFormDirty = true;
}

function startDetailFrameTicker(vmId: string): void {
  stopDetailFrameTicker();

  const updateFrame = () => {
    const image = detailContent.querySelector<HTMLImageElement>(".detail-screen img");
    if (!image) {
      return;
    }

    image.src = `/api/vms/${vmId}/frame.svg?mode=detail&t=${Date.now()}`;
  };

  updateFrame();
  detailFrameTimer = window.setInterval(updateFrame, 1600);
}

function stopDetailFrameTicker(): void {
  if (detailFrameTimer !== null) {
    window.clearInterval(detailFrameTimer);
    detailFrameTimer = null;
  }
}

async function runSafely(task: Promise<void>): Promise<void> {
  try {
    await task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(message);
  }
}
