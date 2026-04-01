import { connect as connectTcp } from "node:net";
import { networkInterfaces } from "node:os";

import {
  describeVmNetworkMode,
  normalizeVmNetworkMode,
} from "../../../packages/shared/src/helpers.js";
import type { VmDesktopTransport, VmNetworkMode, VmSession } from "../../../packages/shared/src/types.js";
import { buildDesktopSession } from "./desktop-session.js";
import {
  PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH,
  PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS,
  type GuestPortProbe,
  type IncusListInstance,
  type IncusNetworkAclPayload,
  type IncusNetworkAclRule,
} from "./providers-contracts.js";

const PRIMARY_GUEST_INTERFACE_PATTERN = /^(en|eth|wl|ww|ib)/;
const GUEST_BRIDGE_INTERFACE_PATTERN =
  /^(lo|docker\d*|br[-\w]*|veth[\w-]*|virbr\d*|cni\d+|flannel\.\d+|incusbr\d*|lxcbr\d*|tun\d+|tap\d+)$/;

export { describeVmNetworkMode, normalizeVmNetworkMode };

export class TcpGuestPortProbe implements GuestPortProbe {
  async probe(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let stage: "banner" | "security" = "banner";
      let buffer = Buffer.alloc(0);
      const socket = connectTcp({
        host,
        port,
      });
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish(false);
      }, 2000);

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (stage === "banner") {
          if (buffer.length < 12) {
            return;
          }

          const banner = buffer.subarray(0, 12).toString("latin1");

          if (!banner.startsWith("RFB ")) {
            finish(false);
            return;
          }

          stage = "security";
          buffer = Buffer.alloc(0);
          socket.write(Buffer.from("RFB 003.008\n", "ascii"));
          return;
        }

        if (buffer.length > 0) {
          finish(true);
        }
      });

      socket.once("error", () => {
        finish(false);
      });

      socket.once("close", () => {
        if (stage === "security" && buffer.length > 0) {
          finish(true);
          return;
        }

        finish(false);
      });
    });
  }
}

export function findGuestAddressCandidates(instance: IncusListInstance): string[] {
  const networks = instance.state?.network ?? {};
  const candidates: Array<{
    address: string;
    family: "inet" | "inet6";
    score: number;
  }> = [];

  for (const [name, network] of Object.entries(networks)) {
    for (const address of network.addresses ?? []) {
      if (
        address.scope !== "global" ||
        !address.address ||
        (address.family !== "inet" && address.family !== "inet6")
      ) {
        continue;
      }

      candidates.push({
        address: address.address,
        family: address.family,
        score: scoreGuestAddressCandidate(name, network, address.family),
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.family !== right.family) {
      return left.family === "inet" ? -1 : 1;
    }

    return left.address.localeCompare(right.address);
  });

  return [...new Set(candidates.map((candidate) => candidate.address))];
}

export function buildIncusDesktopSession(
  host: string | null,
  port: number,
  transport: VmDesktopTransport,
  reachable = true,
): VmSession {
  return buildDesktopSession(host, port, transport, reachable);
}

export function describeGuestDnsProfileActivity(mode: VmNetworkMode): string {
  return normalizeVmNetworkMode(mode) === "dmz"
    ? `dns: public resolvers ${PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS.join(", ")}`
    : "dns: guest defaults restored";
}

export function describePendingGuestDnsProfileActivity(mode: VmNetworkMode): string {
  return normalizeVmNetworkMode(mode) === "dmz"
    ? `dns: public resolvers ${PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS.join(", ")} will apply on next boot`
    : "dns: guest defaults will restore on next boot";
}

export function collectHostAclAddresses(): string[] {
  const addresses = new Set<string>();

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) {
        continue;
      }

      if (entry.family !== "IPv4" && entry.family !== "IPv6") {
        continue;
      }

      const normalized = normalizeAclHostAddress(entry.cidr ?? entry.address);

      if (!normalized) {
        continue;
      }

      addresses.add(normalized);
    }
  }

  return [...addresses].sort((left, right) => left.localeCompare(right));
}

export function buildDmzAclPayload(input: {
  bridgeIpv4: string | null;
  bridgeIpv6: string | null;
  hostAddresses: string[];
}): IncusNetworkAclPayload {
  const egress: IncusNetworkAclRule[] = [];
  const ingress: IncusNetworkAclRule[] = [];
  const seenEgress = new Set<string>();
  const seenIngress = new Set<string>();
  const hostDestinations = new Set(input.hostAddresses);

  if (input.bridgeIpv4) {
    hostDestinations.add(input.bridgeIpv4);
    pushAclRule(
      ingress,
      seenIngress,
      {
        action: "allow",
        source: input.bridgeIpv4,
        protocol: "tcp",
        state: "enabled",
      },
    );
  }

  if (input.bridgeIpv6) {
    hostDestinations.add(input.bridgeIpv6);
    pushAclRule(
      ingress,
      seenIngress,
      {
        action: "allow",
        source: input.bridgeIpv6,
        protocol: "tcp",
        state: "enabled",
      },
    );
  }

  for (const destination of [...hostDestinations].sort((left, right) => left.localeCompare(right))) {
    pushAclRule(
      egress,
      seenEgress,
      {
        action: "drop",
        destination,
        state: "enabled",
      },
    );
  }

  for (const destination of [
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "224.0.0.0/4",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
  ]) {
    pushAclRule(
      egress,
      seenEgress,
      {
        action: "drop",
        destination,
        state: "enabled",
      },
    );
  }

  pushAclRule(
    egress,
    seenEgress,
    {
      action: "allow",
      destination: "0.0.0.0/0",
      state: "enabled",
    },
  );
  pushAclRule(
    egress,
    seenEgress,
    {
      action: "allow",
      destination: "::/0",
      state: "enabled",
    },
  );

  return {
    config: {
      "user.parallaize.managed": "true",
      "user.parallaize.profile": "dmz",
    },
    description:
      "Managed by Parallaize for DMZ VM egress and host-initiated control-plane access.",
    egress,
    ingress,
  };
}

export function buildGuestDnsProfileScript(networkMode: VmNetworkMode): string {
  const normalizedMode = normalizeVmNetworkMode(networkMode);
  const publicDnsServers = PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS.join(" ");

  if (normalizedMode === "dmz") {
    return [
      "set -eu",
      "install -d -m 0755 /etc/systemd/resolved.conf.d",
      `cat <<'EOF' > ${PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH}`,
      "[Resolve]",
      `DNS=${publicDnsServers}`,
      "Domains=~.",
      "EOF",
      "ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf",
      "systemctl restart systemd-resolved.service",
      "resolvectl flush-caches >/dev/null 2>&1 || true",
    ].join("\n");
  }

  return [
    "set -eu",
    `rm -f ${PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH}`,
    "ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf",
    "systemctl restart systemd-resolved.service",
    "resolvectl flush-caches >/dev/null 2>&1 || true",
  ].join("\n");
}

function scoreGuestAddressCandidate(
  interfaceName: string,
  network: { host_name?: string; type?: string },
  family: "inet" | "inet6",
): number {
  let score = family === "inet" ? 200 : 100;

  if (network.host_name) {
    score += 400;
  }

  if (network.type === "broadcast") {
    score += 40;
  }

  if (PRIMARY_GUEST_INTERFACE_PATTERN.test(interfaceName)) {
    score += 30;
  }

  if (GUEST_BRIDGE_INTERFACE_PATTERN.test(interfaceName)) {
    score -= 300;
  }

  return score;
}


export function normalizeAclHostAddress(addressWithPrefix: string | undefined): string | null {
  const value = addressWithPrefix?.trim();

  if (!value || value === "none") {
    return null;
  }

  const [address] = value.split("/", 2);

  if (!address) {
    return null;
  }

  return address.includes(":") ? `${address}/128` : `${address}/32`;
}

function pushAclRule(
  rules: IncusNetworkAclRule[],
  seen: Set<string>,
  rule: IncusNetworkAclRule,
): void {
  const key = JSON.stringify(rule);

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  rules.push(rule);
}
