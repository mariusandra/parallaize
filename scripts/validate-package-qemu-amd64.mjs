import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const args = parseArgs(process.argv.slice(2));
const workDir = resolve(
  root,
  args["work-dir"] ?? `.artifacts/package-validation/amd64-qemu-${Date.now()}`,
);
const cacheDir = resolve(
  root,
  args["cache-dir"] ?? ".artifacts/package-validation/cache",
);
const keepVm = readBooleanFlag(args.keep ?? args["keep-vm"] ?? "false");
const skipSmoke = readBooleanFlag(args["skip-smoke"] ?? "false");
const packagePath = await resolvePackagePath(args.package);
const packageName = basename(packagePath);
const sshPort = await allocateTcpPort();
const serialLogPath = join(workDir, "serial.log");
const pidFilePath = join(workDir, "qemu.pid");
const knownHostsPath = join(workDir, "known_hosts");
const sshKeyPath = join(workDir, "vm-ssh-key");
const imagePath = join(cacheDir, "noble-server-cloudimg-amd64.img");
const overlayPath = join(workDir, "disk.qcow2");
const seedIsoPath = join(workDir, "seed.iso");
const userDataPath = join(workDir, "user-data");
const metaDataPath = join(workDir, "meta-data");
const remotePackagePath = `/home/ubuntu/${packageName}`;
const adminUsername = "admin";
const adminPassword = "package-validation-pass";
const validationSummaryPath = join(workDir, "summary.json");
const qemuBinary = requireCommand("qemu-system-x86_64");
const qemuImgBinary = requireCommand("qemu-img");
const genisoimageBinary = requireCommand("genisoimage");
const sshBinary = requireCommand("ssh");
const scpBinary = requireCommand("scp");
const sshKeygenBinary = requireCommand("ssh-keygen");

const summary = {
  generatedAt: new Date().toISOString(),
  guest: {
    imageUrl: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img",
    qemuSshPort: sshPort,
    serialLogPath,
  },
  package: {
    path: packagePath,
  },
  validation: {
    smokeRan: false,
  },
};

await mkdir(workDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
await writeFile(knownHostsPath, "", "utf8");

try {
  logStep(`Using package ${packagePath}`);
  await ensureBaseImage(summary.guest.imageUrl, imagePath);
  await createSshKeyPair(sshKeygenBinary, sshKeyPath);
  await writeCloudInitFiles({
    metaDataPath,
    publicKey: await readFile(`${sshKeyPath}.pub`, "utf8"),
    sshPort,
    userDataPath,
  });
  runChecked(genisoimageBinary, [
    "-output",
    seedIsoPath,
    "-volid",
    "cidata",
    "-joliet",
    "-rock",
    userDataPath,
    metaDataPath,
  ]);
  runChecked(qemuImgBinary, [
    "create",
    "-f",
    "qcow2",
    "-F",
    "qcow2",
    "-b",
    imagePath,
    overlayPath,
    "40G",
  ]);

  bootQemuVm();
  logStep(`QEMU guest booting with SSH forwarded on 127.0.0.1:${sshPort}`);

  await waitForSshReady({
    knownHostsPath,
    sshBinary,
    sshKeyPath,
    sshPort,
  });

  logStep("Cloud-init completed; provisioning guest packages");
  await scpToGuest(scpBinary, {
    knownHostsPath,
    remotePath: remotePackagePath,
    sshKeyPath,
    sshPort,
    sourcePath: packagePath,
  });

  await runRemoteScript(
    sshBinary,
    {
      knownHostsPath,
      sshKeyPath,
      sshPort,
    },
    `
set -euo pipefail
sudo cloud-init status --wait
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${shellQuote(remotePackagePath)}
sudo grep -q '^PARALLAIZE_INCUS_STORAGE_POOL=default$' /etc/parallaize/parallaize.env
sudo test "$(systemctl is-enabled parallaize.service)" = enabled
for _ in $(seq 1 30); do
  if [ "$(systemctl is-active parallaize.service || true)" = active ]; then
    break
  fi
  sleep 1
done
sudo test "$(systemctl is-active parallaize.service)" = active
sudo sed -i 's/^PARALLAIZE_ADMIN_USERNAME=.*/PARALLAIZE_ADMIN_USERNAME=${adminUsername}/' /etc/parallaize/parallaize.env
sudo sed -i 's/^PARALLAIZE_ADMIN_PASSWORD=.*/PARALLAIZE_ADMIN_PASSWORD=${adminPassword}/' /etc/parallaize/parallaize.env
sudo systemctl restart parallaize.service
`,
  );

  logStep("Package installed; confirming clean distro-managed Incus ownership");
  const incusSocketActive = (
    await remoteCapture(
      sshBinary,
      {
        knownHostsPath,
        sshKeyPath,
        sshPort,
      },
      "systemctl is-active incus.socket || true",
    )
  ).trim();
  const incusSocketEnabled = (
    await remoteCapture(
      sshBinary,
      {
        knownHostsPath,
        sshKeyPath,
        sshPort,
      },
      "systemctl is-enabled incus.socket || true",
    )
  ).trim();
  const incusdProcesses = (
    await remoteCapture(
      sshBinary,
      {
        knownHostsPath,
        sshKeyPath,
        sshPort,
      },
      "pgrep -af incusd || true",
    )
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  summary.validation.incusSocketActive = incusSocketActive;
  summary.validation.incusSocketEnabled = incusSocketEnabled;
  summary.validation.incusdProcesses = incusdProcesses;

  if (incusdProcesses.some((line) => line.includes(".flox"))) {
    throw new Error(`Guest validation found a Flox incusd process: ${incusdProcesses.join("; ")}`);
  }

  if (incusSocketEnabled !== "enabled") {
    throw new Error(`Expected distro incus.socket to be enabled, received "${incusSocketEnabled}".`);
  }

  const healthPayload = await waitForApiHealthy({
    adminPassword,
    adminUsername,
    knownHostsPath,
    sshBinary,
    sshKeyPath,
    sshPort,
  });

  logStep("Parallaize API answered healthy; starting packaged Caddy front door");
  await runRemoteScript(
    sshBinary,
    {
      knownHostsPath,
      sshKeyPath,
      sshPort,
    },
    `
set -euo pipefail
sudo systemctl enable --now parallaize-caddy.service
for _ in $(seq 1 30); do
  if sudo systemctl is-active --quiet parallaize-caddy.service && curl -kfsS https://127.0.0.1:8080/ >/dev/null; then
    exit 0
  fi

  sleep 2
done

sudo systemctl status --no-pager parallaize-caddy.service
exit 1
`,
  );

  const packageVersion = (
    await remoteCapture(
      sshBinary,
      {
        knownHostsPath,
        sshKeyPath,
        sshPort,
      },
      "dpkg-query -W -f='${Version}' parallaize",
    )
  ).trim();

  summary.package.version = packageVersion;
  summary.validation.health = healthPayload;

  if (healthPayload?.data?.provider?.hostStatus !== "ready") {
    throw new Error(
      `Expected provider hostStatus ready, received "${String(healthPayload?.data?.provider?.hostStatus)}".`,
    );
  }

  if (!skipSmoke) {
    logStep("Running packaged smoke path inside the guest");
    const smokeOutput = await remoteCapture(
      sshBinary,
      {
        knownHostsPath,
        sshKeyPath,
        sshPort,
      },
      `sudo env PARALLAIZE_SMOKE_ADMIN_USERNAME=${shellQuote(adminUsername)} PARALLAIZE_SMOKE_ADMIN_PASSWORD=${shellQuote(adminPassword)} parallaize-smoke-incus`,
    );
    summary.validation.smokeRan = true;
    summary.validation.smokeOutput = smokeOutput.trim();
  }

  logStep("Writing validation summary");
  await writeFile(validationSummaryPath, JSON.stringify(summary, null, 2));
  process.stdout.write(
    `Validation passed. Summary: ${validationSummaryPath}\nSerial log: ${serialLogPath}\n`,
  );
} finally {
  await writeFile(validationSummaryPath, JSON.stringify(summary, null, 2));

  if (keepVm) {
    process.stdout.write(`Keeping QEMU VM running. PID file: ${pidFilePath}\n`);
  } else {
    shutdownQemuVm(pidFilePath);
    restoreWorkdirOwnership(workDir);
    await pruneWorkdirArtifacts(workDir);
  }
}

function bootQemuVm() {
  runChecked("sudo", [
    "-n",
    "--preserve-env=PATH",
    qemuBinary,
    "-daemonize",
    "-pidfile",
    pidFilePath,
    "-machine",
    "q35,accel=kvm",
    "-cpu",
    "host",
    "-smp",
    "4",
    "-m",
    "8192",
    "-display",
    "none",
    "-serial",
    `file:${serialLogPath}`,
    "-device",
    "virtio-rng-pci",
    "-drive",
    `if=virtio,format=qcow2,file=${overlayPath}`,
    "-drive",
    `if=virtio,media=cdrom,format=raw,file=${seedIsoPath}`,
    "-netdev",
    `user,id=net0,hostfwd=tcp:127.0.0.1:${sshPort}-:22`,
    "-device",
    "virtio-net-pci,netdev=net0",
  ]);
}

async function ensureBaseImage(url, targetPath) {
  if (existsSync(targetPath)) {
    return;
  }

  logStep(`Downloading Ubuntu cloud image to ${targetPath}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, buffer);
}

async function createSshKeyPair(sshKeygenPath, targetPath) {
  await rm(targetPath, { force: true });
  await rm(`${targetPath}.pub`, { force: true });
  runChecked(sshKeygenPath, ["-q", "-t", "ed25519", "-N", "", "-f", targetPath]);
}

async function writeCloudInitFiles({ metaDataPath, publicKey, sshPort, userDataPath }) {
  await writeFile(
    userDataPath,
    [
      "#cloud-config",
      "users:",
      "  - default",
      "  - name: ubuntu",
      "    groups: [adm, sudo]",
      "    sudo: ALL=(ALL) NOPASSWD:ALL",
      "    shell: /bin/bash",
      "    ssh_authorized_keys:",
      `      - ${publicKey.trim()}`,
      "ssh_pwauth: false",
      "package_update: false",
      "final_message: parallaize package validation guest is ready",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    metaDataPath,
    [`instance-id: parallaize-package-validation-${sshPort}`, "local-hostname: parallaize-qemu"].join(
      "\n",
    ),
    "utf8",
  );
}

async function waitForSshReady({ knownHostsPath, sshBinary, sshKeyPath, sshPort }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10 * 60 * 1000) {
    const result = spawnSync(
      sshBinary,
      buildSshArgs({
        knownHostsPath,
        remoteCommand: "true",
        sshKeyPath,
        sshPort,
      }),
      {
        encoding: "utf8",
      },
    );

    if (result.status === 0) {
      return;
    }

    await sleep(5_000);
  }

  throw new Error(`Timed out waiting for SSH on 127.0.0.1:${sshPort}.`);
}

async function waitForApiHealthy({
  adminPassword,
  adminUsername,
  knownHostsPath,
  sshBinary,
  sshKeyPath,
  sshPort,
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5 * 60 * 1000) {
    const result = await remoteAttempt(
      sshBinary,
      {
        knownHostsPath,
        sshKeyPath,
        sshPort,
      },
      buildHealthFetchScript({
        adminPassword,
        adminUsername,
      }),
    );

    if (result.status === 0) {
      const payload = JSON.parse(result.stdout);
      if (isAcceptablePackagedHealth(payload)) {
        return payload;
      }
    }

    await sleep(5_000);
  }

  throw new Error(
    "Timed out waiting for packaged /api/health to report an acceptable packaged-host state.",
  );
}

function buildHealthFetchScript({ adminPassword, adminUsername }) {
  return `
set -euo pipefail
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
curl -fsS -c "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '${JSON.stringify({ username: adminUsername, password: adminPassword })}' \
  http://127.0.0.1:3000/api/auth/login >/dev/null
curl -fsS -b "$COOKIE_JAR" http://127.0.0.1:3000/api/health
`;
}

function isAcceptablePackagedHealth(payload) {
  if (payload?.ok !== true) {
    return false;
  }

  if (payload?.data?.provider?.hostStatus !== "ready") {
    return false;
  }

  if (payload?.data?.persistence?.status !== "ready") {
    return false;
  }

  if (payload?.data?.status === "ok") {
    return true;
  }

  return (
    payload?.data?.status === "degraded" &&
    payload?.data?.incusStorage?.status === "warning" &&
    payload?.data?.incusStorage?.selectedPoolLoopBacked === true
  );
}

async function scpToGuest(
  scpPath,
  { knownHostsPath, remotePath, sshKeyPath, sshPort, sourcePath },
) {
  runChecked(scpPath, [
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
    "-o",
    "StrictHostKeyChecking=no",
    "-i",
    sshKeyPath,
    "-P",
    String(sshPort),
    sourcePath,
    `ubuntu@127.0.0.1:${remotePath}`,
  ]);
}

async function remoteCapture(sshPath, connection, remoteScript) {
  const result = await remoteAttempt(sshPath, connection, remoteScript);

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Remote command failed.");
  }

  return result.stdout;
}

async function remoteAttempt(sshPath, { knownHostsPath, sshKeyPath, sshPort }, remoteScript) {
  const result = spawnSync(
    sshPath,
    buildSshArgs({
      knownHostsPath,
      remoteCommand: "bash -se",
      sshKeyPath,
      sshPort,
    }),
    {
      encoding: "utf8",
      input: remoteScript,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runRemoteScript(sshPath, connection, remoteScript) {
  const result = await remoteAttempt(sshPath, connection, remoteScript);

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Remote script failed.");
  }
}

function buildSshArgs({ knownHostsPath, remoteCommand, sshKeyPath, sshPort }) {
  return [
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-i",
    sshKeyPath,
    "-p",
    String(sshPort),
    "ubuntu@127.0.0.1",
    remoteCommand,
  ];
}

function shutdownQemuVm(pidFile) {
  if (!existsSync(pidFile)) {
    return;
  }

  spawnSync("sudo", ["-n", "pkill", "-TERM", "-F", pidFile], {
    stdio: "ignore",
  });
  spawnSync(
    "sudo",
    [
      "-n",
      "bash",
      "-lc",
      `for _ in $(seq 1 20); do pgrep -F ${shellQuote(pidFile)} >/dev/null 2>&1 || exit 0; sleep 0.5; done; pkill -KILL -F ${shellQuote(pidFile)} >/dev/null 2>&1 || true`,
    ],
    {
      stdio: "ignore",
    },
  );
}

function restoreWorkdirOwnership(targetPath) {
  spawnSync("sudo", [
    "-n",
    "chown",
    "-R",
    `${process.getuid()}:${process.getgid()}`,
    targetPath,
  ], {
    stdio: "ignore",
  });
}

async function pruneWorkdirArtifacts(targetPath) {
  for (const artifactName of [
    "disk.qcow2",
    "known_hosts",
    "meta-data",
    "qemu.pid",
    "seed.iso",
    "user-data",
    "vm-ssh-key",
    "vm-ssh-key.pub",
  ]) {
    await rm(join(targetPath, artifactName), { force: true, recursive: true });
  }
}

function requireCommand(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Required command "${command}" was not found on PATH.`);
  }

  return result.stdout.trim();
}

async function resolvePackagePath(explicitPath) {
  if (explicitPath) {
    return resolve(root, explicitPath);
  }

  const manifestPath = resolve(root, "artifacts/packages/manifest.json");

  if (!existsSync(manifestPath)) {
    throw new Error(
      'No package path was provided and artifacts/packages/manifest.json is missing. Run "pnpm package:deb" first.',
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const match = manifest?.packages?.find(
    (entry) => entry?.format === "deb" && entry?.architecture === "amd64",
  );

  if (!match?.path) {
    throw new Error(`No amd64 deb entry was found in ${manifestPath}.`);
  }

  return resolve(root, match.path);
}

async function allocateTcpPort() {
  const server = createServer();

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to allocate an ephemeral TCP port.");
  }

  const port = address.port;
  await new Promise((resolvePromise) => {
    server.close(resolvePromise);
  });
  return port;
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument "${token}".`);
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);

    if (!rawKey) {
      throw new Error(`Invalid empty argument "${token}".`);
    }

    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const nextToken = argv[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      parsed[rawKey] = "true";
      continue;
    }

    parsed[rawKey] = nextToken;
    index += 1;
  }

  return parsed;
}

function runChecked(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${commandArgs.join(" ")}`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter((entry) => entry.length > 0)
        .join("\n"),
    );
  }

  return result.stdout;
}

function readBooleanFlag(value) {
  return value === true || value === "true" || value === "1";
}

function logStep(message) {
  process.stdout.write(`[validate-package-qemu-amd64] ${message}\n`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
