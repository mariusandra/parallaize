export type ProviderKind = "mock" | "incus";
export type PersistenceKind = "json" | "postgres";
export type ProviderHostStatus =
  | "ready"
  | "network-unreachable"
  | "missing-cli"
  | "daemon-unreachable"
  | "error";
export type ProviderDesktopTransport = "synthetic" | "novnc";
export type PersistenceStatus = "ready" | "degraded";
export type IncusStorageStatus = "ready" | "warning" | "unavailable";

export type VmStatus =
  | "creating"
  | "running"
  | "stopped"
  | "deleting"
  | "error";

export type VmWindow = "editor" | "terminal" | "browser" | "logs";

export type VmSessionKind = "synthetic" | "vnc";
export type VmForwardProtocol = "http";
export type VmPowerAction = "start" | "stop" | "restart";
export type VmNetworkMode = "default" | "dmz";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobKind =
  | "create"
  | "clone"
  | "launch-snapshot"
  | VmPowerAction
  | "delete"
  | "snapshot"
  | "restore-snapshot"
  | "resize"
  | "capture-template"
  | "inject-command";

export interface ResourceSpec {
  cpu: number;
  ramMb: number;
  diskGb: number;
}

export interface ResourceTelemetry {
  cpuHistory: number[];
  cpuPercent: number | null;
  ramHistory: number[];
  ramPercent: number | null;
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
  reachable?: boolean;
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

export interface VmCommandResult {
  command: string;
  output: string[];
  workspacePath: string;
  createdAt: string;
}

export interface AdminSessionRecord {
  id: string;
  username: string;
  credentialFingerprint: string;
  secretHash: string;
  createdAt: string;
  lastAuthenticatedAt: string;
  lastRotatedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
}

export interface EnvironmentTemplate {
  id: string;
  name: string;
  description: string;
  launchSource: string;
  defaultResources: ResourceSpec;
  defaultForwardedPorts: TemplatePortForward[];
  defaultNetworkMode?: VmNetworkMode;
  initCommands: string[];
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
  networkMode?: VmNetworkMode;
  session: VmSession | null;
  forwardedPorts: VmPortForward[];
  activityLog: string[];
  commandHistory?: VmCommandResult[];
  telemetry?: ResourceTelemetry;
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
  progressPercent?: number | null;
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
  adminSessions: AdminSessionRecord[];
  lastUpdated: string;
}

export interface PersistenceDiagnostics {
  kind: PersistenceKind;
  status: PersistenceStatus;
  databaseConfigured: boolean;
  dataFile: string | null;
  lastPersistAttemptAt: string | null;
  lastPersistedAt: string | null;
  lastPersistError: string | null;
}

export interface IncusStoragePoolSummary {
  name: string;
  driver: string | null;
}

export interface IncusStorageDiagnostics {
  status: IncusStorageStatus;
  detail: string;
  configuredPool: string | null;
  defaultProfilePool: string | null;
  selectedPool: string | null;
  selectedPoolDriver: string | null;
  selectedPoolSource: string | null;
  selectedPoolLoopBacked: boolean | null;
  availablePools: IncusStoragePoolSummary[];
  nextSteps: string[];
}

export type IncusStorageAction = "probe" | "bootstrap";

export interface RunIncusStorageActionInput {
  action: IncusStorageAction;
}

export interface IncusStorageActionResult {
  action: IncusStorageAction;
  changed: boolean;
  message: string;
  output: string[];
}

export interface DashboardMetrics {
  totalVmCount: number;
  runningVmCount: number;
  totalCpu: number;
  hostCpuCount: number;
  totalRamMb: number;
  hostRamMb: number;
  totalDiskGb: number;
  hostDiskGb: number;
}

export interface DashboardSummary {
  hostTelemetry: ResourceTelemetry;
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

export interface VmLogsSnapshot {
  provider: ProviderKind;
  providerRef: string;
  source: string;
  content: string;
  fetchedAt: string;
}

export interface CreateVmInput {
  templateId: string;
  name: string;
  resources: ResourceSpec;
  forwardedPorts?: TemplatePortForward[];
  networkMode?: VmNetworkMode;
  initCommands?: string[];
}

export interface CloneVmInput {
  sourceVmId: string;
  name?: string;
}

export interface ResizeVmInput {
  resources: ResourceSpec;
}

export interface SetVmResolutionInput {
  width: number;
  height: number;
}

export interface SyncVmResolutionControlInput {
  clientId: string;
  force?: boolean;
}

export interface VmResolutionController {
  clientId: string;
  claimedAt: string;
  heartbeatAt: string;
}

export interface VmResolutionControlSnapshot {
  vmId: string;
  controller: VmResolutionController | null;
}

export interface SnapshotInput {
  label?: string;
}

export interface SnapshotLaunchInput {
  name?: string;
}

export interface CaptureTemplateInput {
  templateId?: string;
  name: string;
  description: string;
}

export interface CreateTemplateInput {
  sourceTemplateId: string;
  name: string;
  description: string;
  initCommands?: string[];
}

export interface UpdateTemplateInput {
  name: string;
  description?: string;
  initCommands?: string[];
}

export interface UpdateVmInput {
  name: string;
}

export interface ReorderVmsInput {
  vmIds: string[];
}

export interface InjectCommandInput {
  command: string;
}

export interface UpdateVmForwardedPortsInput {
  forwardedPorts: TemplatePortForward[];
}

export interface UpdateVmNetworkInput {
  networkMode: VmNetworkMode;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
  username: string | null;
  mode: "none" | "session" | "unauthenticated";
}

export interface ApiEnvelope<T> {
  ok: true;
  data: T;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: string;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  provider: ProviderState;
  persistence: PersistenceDiagnostics;
  incusStorage: IncusStorageDiagnostics | null;
  generatedAt: string;
}

export type ApiResponse<T> = ApiEnvelope<T> | ApiErrorEnvelope;
