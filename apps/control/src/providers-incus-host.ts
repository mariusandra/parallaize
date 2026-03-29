import { spawnSync } from "node:child_process";

import type { ProviderState } from "../../../packages/shared/src/types.js";
import {
  HOST_NETWORK_PROBE_TIMEOUT_MS,
  type CommandResult,
  type HostDaemonDiagnostic,
  type HostDaemonProbe,
  type HostNetworkDiagnostic,
  type HostNetworkProbe,
  type IncusDaemonOwnershipSnapshot,
} from "./providers-contracts.js";
import { isCommandTimeout } from "./providers-incus-command.js";

export class NoopHostNetworkProbe implements HostNetworkProbe {
  probe(): HostNetworkDiagnostic {
    return {
      status: "unknown",
      detail: null,
      nextSteps: [],
    };
  }
}

export class NoopHostDaemonProbe implements HostDaemonProbe {
  probe(): HostDaemonDiagnostic {
    return {
      status: "unknown",
      detail: null,
      nextSteps: [],
    };
  }
}

export class ShellHostNetworkProbe implements HostNetworkProbe {
  probe(): HostNetworkDiagnostic {
    const hostEgress = this.runCheck("exec 3<>/dev/tcp/1.1.1.1/443");
    const ubuntuMirror = this.runCheck(
      "getent ahostsv4 archive.ubuntu.com >/dev/null 2>&1 && exec 3<>/dev/tcp/archive.ubuntu.com/80",
    );

    if (hostEgress === "unknown" || ubuntuMirror === "unknown") {
      return {
        status: "unknown",
        detail: null,
        nextSteps: [],
      };
    }

    if (hostEgress === "ok" && ubuntuMirror === "ok") {
      return {
        status: "ready",
        detail: null,
        nextSteps: [],
      };
    }

    const failures: string[] = [];

    if (hostEgress !== "ok") {
      failures.push("host TCP egress to 1.1.1.1:443 failed");
    }

    if (ubuntuMirror !== "ok") {
      failures.push("Ubuntu mirror resolution/connectivity to archive.ubuntu.com:80 failed");
    }

    return {
      status: "unreachable",
      detail: `Incus is reachable, but outbound internet checks failed: ${failures.join("; ")}. New guests may fail to install x11vnc or other packages until connectivity is restored.`,
      nextSteps: [
        "Verify outbound IPv4 and DNS from the control-plane host, especially access to archive.ubuntu.com.",
        "If Docker is installed, ensure FORWARD rules still allow traffic from incusbr0; packaged installs ship parallaize-network-fix.service for this case.",
        "If a guest still boots without VNC, inspect `journalctl -u parallaize-desktop-bootstrap.service` inside the VM for the current bootstrap failure.",
      ],
    };
  }

  private runCheck(script: string): "ok" | "failed" | "unknown" {
    const result = spawnSync("bash", ["-lc", script], {
      encoding: "utf8",
      timeout: HOST_NETWORK_PROBE_TIMEOUT_MS,
    });

    if (result.error?.message.includes("ENOENT")) {
      return "unknown";
    }

    return result.status === 0 ? "ok" : "failed";
  }
}

export class ShellHostDaemonProbe implements HostDaemonProbe {
  probe(): HostDaemonDiagnostic {
    const processResult = spawnSync("bash", ["-lc", "pgrep -af '[i]ncusd' || true"], {
      encoding: "utf8",
      timeout: HOST_NETWORK_PROBE_TIMEOUT_MS,
    });

    return diagnoseIncusDaemonConflict({
      processLines: parseIncusdProcessLines(processResult.stdout),
      socketActive: readSystemdUnitState("incus.socket", "ActiveState"),
      socketEnabled: readSystemdUnitState("incus.socket", "UnitFileState"),
      serviceActive: readSystemdUnitState("incus.service", "ActiveState"),
      serviceEnabled: readSystemdUnitState("incus.service", "UnitFileState"),
    });
  }
}

export function buildIncusProviderState(
  incusBinary: string,
  project: string | null,
  result: CommandResult,
  hostNetworkDiagnostic: HostNetworkDiagnostic,
  hostDaemonDiagnostic: HostDaemonDiagnostic,
): ProviderState {
  if (hostDaemonDiagnostic.status === "conflict") {
    return {
      kind: "incus",
      available: result.status === 0,
      detail:
        hostDaemonDiagnostic.detail ??
        "Mixed Incus daemon ownership detected on the host.",
      hostStatus: "daemon-conflict",
      binaryPath: incusBinary,
      project,
      desktopTransport: "novnc",
      nextSteps: hostDaemonDiagnostic.nextSteps,
    };
  }

  if (result.status === 0) {
    if (hostNetworkDiagnostic.status === "unreachable") {
      return {
        kind: "incus",
        available: true,
        detail:
          hostNetworkDiagnostic.detail ??
          "Incus is reachable, but outbound internet checks failed for the host.",
        hostStatus: "network-unreachable",
        binaryPath: incusBinary,
        project,
        desktopTransport: "novnc",
        nextSteps: hostNetworkDiagnostic.nextSteps,
      };
    }

    return {
      kind: "incus",
      available: true,
      detail:
        "Incus is reachable. Browser sessions use the built-in noVNC bridge when the guest VNC server is reachable.",
      hostStatus: "ready",
      binaryPath: incusBinary,
      project,
      desktopTransport: "novnc",
      nextSteps: [
        "Ensure the guest image starts a VNC server on the configured guest port so the browser bridge can connect.",
      ],
    };
  }

  return {
    kind: "incus",
    available: false,
    detail: describeProbeFailure(result),
    hostStatus: classifyProbeFailure(result),
    binaryPath: incusBinary,
    project,
    desktopTransport: "novnc",
    nextSteps: buildProbeNextSteps(classifyProbeFailure(result)),
  };
}

export function describeProbeFailure(result: CommandResult): string {
  if (result.error?.message.includes("ENOENT")) {
    return "Incus mode requested, but the incus CLI was not found on this host.";
  }

  if (isCommandTimeout(result)) {
    return "Incus CLI was found, but the daemon did not answer before the readiness probe timed out.";
  }

  const detail = result.stderr.trim() || result.error?.message || "Unknown Incus error.";
  return `Incus CLI was found, but the daemon is unavailable: ${detail}`;
}

export function classifyProbeFailure(result: CommandResult): ProviderState["hostStatus"] {
  if (result.error?.message.includes("ENOENT")) {
    return "missing-cli";
  }

  if (isCommandTimeout(result)) {
    return "daemon-unreachable";
  }

  const detail = `${result.stderr} ${result.stdout}`.trim().toLowerCase();

  if (
    detail.includes("daemon doesn't appear to be started") ||
    detail.includes("server version: unreachable") ||
    detail.includes("unix.socket")
  ) {
    return "daemon-unreachable";
  }

  return "error";
}

export function buildProbeNextSteps(status: ProviderState["hostStatus"]): string[] {
  switch (status) {
    case "network-unreachable":
      return [
        "Verify outbound IPv4 and DNS from the control-plane host, especially access to archive.ubuntu.com.",
        "If Docker is installed, ensure FORWARD rules still allow traffic from incusbr0; packaged installs ship parallaize-network-fix.service for this case.",
        "Inspect `journalctl -u parallaize-desktop-bootstrap.service` inside the guest if VNC still never appears after host connectivity is restored.",
      ];
    case "missing-cli":
      return [
        "Run the control plane inside Flox or set PARALLAIZE_INCUS_BIN to a valid Incus binary.",
        "Install the package with `flox install -d . incus` if this environment still lacks Incus.",
        "Initialize the daemon after install with `flox activate -d . -- incus admin init --minimal`.",
      ];
    case "daemon-unreachable":
      return [
        "Start the daemon with your service manager or `flox activate -d . -- incusd` on the target Linux host.",
        "Initialize storage and networking with `flox activate -d . -- incus admin init --minimal` if this is the first run.",
        "Restart the dashboard with PARALLAIZE_PROVIDER=incus once `incus list --format json` succeeds.",
      ];
    case "daemon-conflict":
      return [
        "Pick one owner for `/var/lib/incus/unix.socket`: either the distro `incus` units or a manual Flox `incusd`, not both.",
        "If this host should stay distro-managed, stop the Flox daemon and remove any manual startup wrapper.",
        "If this host should stay Flox-managed, disable `incus.socket` and `incus.service` before starting `incusd` manually.",
      ];
    case "error":
      return [
        "Run `flox activate -d . -- incus list --format json` on the host and resolve the reported error.",
        "Check any configured Incus project value and host permissions before retrying.",
      ];
    case "ready":
    default:
      return [];
  }
}

export function diagnoseIncusDaemonConflict(
  snapshot: IncusDaemonOwnershipSnapshot,
): HostDaemonDiagnostic {
  const ownerKinds = new Set(
    snapshot.processLines.map(classifyIncusdOwner).filter((owner) => owner !== "unknown"),
  );
  const systemdIncusManaged =
    snapshot.socketActive === true ||
    snapshot.socketEnabled === true ||
    snapshot.serviceActive === true ||
    snapshot.serviceEnabled === true;
  const hasFloxProcess = snapshot.processLines.some(
    (line) => classifyIncusdOwner(line) === "flox",
  );

  if (ownerKinds.size > 1 || (systemdIncusManaged && hasFloxProcess)) {
    const systemdState = [
      snapshot.socketActive === true ? "incus.socket active" : null,
      snapshot.socketEnabled === true ? "incus.socket enabled" : null,
      snapshot.serviceActive === true ? "incus.service active" : null,
      snapshot.serviceEnabled === true ? "incus.service enabled" : null,
    ].filter((entry): entry is string => entry !== null);
    const systemdSummary =
      systemdState.length > 0
        ? systemdState.join(", ")
        : "no active or enabled incus systemd units";
    const ownerSummary =
      snapshot.processLines.length > 0
        ? snapshot.processLines
            .map((line) => `${describeIncusdOwner(line)}: ${summarizeProcessCommand(line)}`)
            .join("; ")
        : "no running incusd process was detected";

    return {
      status: "conflict",
      detail:
        `Mixed Incus daemon ownership detected. ${systemdSummary}; ${ownerSummary}. ` +
        "Pick one owner for `/var/lib/incus/unix.socket` before treating this host as supported.",
      nextSteps: [
        "If this host should stay distro-managed, stop any manual Flox `incusd` process and remove its startup wrapper.",
        "If this host should stay Flox-managed, disable `incus.socket` and `incus.service` before starting `incusd` manually.",
        "Re-run `systemctl status incus.socket incus.service --no-pager`, `pgrep -af incusd`, and `ss -lx | grep /var/lib/incus/unix.socket` to confirm a single owner.",
      ],
    };
  }

  return {
    status: "ready",
    detail: null,
    nextSteps: [],
  };
}

export function parseIncusdProcessLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function readSystemdUnitState(
  unit: string,
  property: "ActiveState" | "UnitFileState",
): boolean | null {
  const result = spawnSync("systemctl", ["show", "--property", property, "--value", unit], {
    encoding: "utf8",
    timeout: HOST_NETWORK_PROBE_TIMEOUT_MS,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();

  if (property === "ActiveState") {
    return value === "active";
  }

  return value === "enabled" || value === "enabled-runtime";
}

export function classifyIncusdOwner(
  commandLine: string,
): "flox" | "distro" | "other" | "unknown" {
  const normalized = commandLine.toLowerCase();

  if (!normalized.includes("incusd")) {
    return "unknown";
  }

  if (normalized.includes("/.flox/") || normalized.includes("/flox/")) {
    return "flox";
  }

  if (
    normalized.includes("/usr/") ||
    normalized.includes("/snap/") ||
    normalized.includes("/var/lib/snapd/")
  ) {
    return "distro";
  }

  return "other";
}

export function describeIncusdOwner(commandLine: string): string {
  switch (classifyIncusdOwner(commandLine)) {
    case "flox":
      return "Flox incusd";
    case "distro":
      return "distro incusd";
    case "other":
      return "manual incusd";
    default:
      return "unknown owner";
  }
}

export function summarizeProcessCommand(commandLine: string): string {
  const firstSpaceIndex = commandLine.indexOf(" ");
  const command =
    firstSpaceIndex === -1 ? commandLine : commandLine.slice(firstSpaceIndex + 1).trim();

  if (command.length <= 120) {
    return command;
  }

  return `${command.slice(0, 117)}...`;
}
