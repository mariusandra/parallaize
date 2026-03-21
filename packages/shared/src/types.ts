export type ProviderKind = "mock" | "incus";
export type ProviderHostStatus =
  | "ready"
  | "missing-cli"
  | "daemon-unreachable"
  | "error";
export type ProviderDesktopTransport = "synthetic" | "novnc";

export type VmStatus =
  | "creating"
  | "running"
  | "stopped"
  | "deleting"
  | "error";

export type VmWindow = "editor" | "terminal" | "browser" | "logs";

export type VmSessionKind = "synthetic" | "vnc";
export type VmForwardProtocol = "http";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobKind =
  | "create"
  | "clone"
  | "start"
  | "stop"
  | "delete"
  | "snapshot"
  | "resize"
  | "capture-template"
  | "inject-command";

export interface ResourceSpec {
  cpu: number;
  ramMb: number;
  diskGb: number;
}

export interface ProviderState {
  kind: ProviderKind;
  available: boolean;
  detail: string;
  hostStatus: ProviderHostStatus;
  binaryPath: string | null;
  project: string | null;
  desktopTransport: ProviderDesktopTransport;
  nextSteps: string[];
}

export interface VmSession {
  kind: VmSessionKind;
  host: string | null;
  port: number | null;
  webSocketPath: string | null;
  browserPath: string | null;
  display: string;
}

export interface TemplatePortForward {
  name: string;
  guestPort: number;
  protocol: VmForwardProtocol;
  description: string;
}

export interface VmPortForward extends TemplatePortForward {
  id: string;
  publicPath: string;
}

export interface EnvironmentTemplate {
  id: string;
  name: string;
  description: string;
  launchSource: string;
  defaultResources: ResourceSpec;
  defaultForwardedPorts: TemplatePortForward[];
  tags: string[];
  notes: string[];
  snapshotIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VmInstance {
  id: string;
  name: string;
  templateId: string;
  provider: ProviderKind;
  providerRef: string;
  status: VmStatus;
  resources: ResourceSpec;
  createdAt: string;
  updatedAt: string;
  liveSince: string | null;
  lastAction: string;
  snapshotIds: string[];
  frameRevision: number;
  screenSeed: number;
  activeWindow: VmWindow;
  workspacePath: string;
  session: VmSession | null;
  forwardedPorts: VmPortForward[];
  activityLog: string[];
}

export interface Snapshot {
  id: string;
  vmId: string;
  templateId: string;
  label: string;
  summary: string;
  providerRef: string;
  resources: ResourceSpec;
  createdAt: string;
}

export interface ActionJob {
  id: string;
  kind: JobKind;
  targetVmId: string | null;
  targetTemplateId: string | null;
  status: JobStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  sequence: number;
  provider: ProviderState;
  templates: EnvironmentTemplate[];
  vms: VmInstance[];
  snapshots: Snapshot[];
  jobs: ActionJob[];
  lastUpdated: string;
}

export interface DashboardMetrics {
  totalVmCount: number;
  runningVmCount: number;
  totalCpu: number;
  totalRamMb: number;
  totalDiskGb: number;
}

export interface DashboardSummary {
  provider: ProviderState;
  templates: EnvironmentTemplate[];
  vms: VmInstance[];
  snapshots: Snapshot[];
  jobs: ActionJob[];
  metrics: DashboardMetrics;
  generatedAt: string;
}

export interface VmDetail {
  provider: ProviderState;
  vm: VmInstance;
  template: EnvironmentTemplate | null;
  snapshots: Snapshot[];
  recentJobs: ActionJob[];
  generatedAt: string;
}

export interface CreateVmInput {
  templateId: string;
  name: string;
  resources: ResourceSpec;
  forwardedPorts?: TemplatePortForward[];
}

export interface CloneVmInput {
  sourceVmId: string;
  name?: string;
}

export interface ResizeVmInput {
  resources: ResourceSpec;
}

export interface SnapshotInput {
  label?: string;
}

export interface CaptureTemplateInput {
  templateId?: string;
  name: string;
  description: string;
}

export interface InjectCommandInput {
  command: string;
}

export interface UpdateVmForwardedPortsInput {
  forwardedPorts: TemplatePortForward[];
}

export interface ApiEnvelope<T> {
  ok: true;
  data: T;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiEnvelope<T> | ApiErrorEnvelope;
