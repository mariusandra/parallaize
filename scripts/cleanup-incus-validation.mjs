import { spawnSync } from "node:child_process";
import process from "node:process";

const incusBin = process.env.PARALLAIZE_INCUS_BIN ?? "incus";
const deleteRequested = process.argv.includes("--delete");
const prefixes = process.argv
  .slice(2)
  .filter((arg) => arg !== "--delete");

const defaultPrefixes = [
  process.env.PARALLAIZE_SMOKE_VM_PREFIX ?? "smoke-incus",
  process.env.PARALLAIZE_CHURN_VM_PREFIX ?? "churn-incus",
];

const activePrefixes = Array.from(
  new Set((prefixes.length > 0 ? prefixes : defaultPrefixes).filter(Boolean)),
);

const listed = runIncus(["list", "--format", "json"]);
const instances = JSON.parse(listed.stdout);
const matches = instances.filter((instance) =>
  activePrefixes.some((prefix) => String(instance.name ?? "").startsWith(prefix)),
);

if (matches.length === 0) {
  process.stdout.write(
    `No matching Incus instances found for prefixes: ${activePrefixes.join(", ")}\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `Matching Incus instances for prefixes ${activePrefixes.join(", ")}:\n`,
);
for (const instance of matches) {
  process.stdout.write(
    `- ${instance.name} (${instance.status ?? instance.state?.status ?? "unknown"})\n`,
  );
}

if (!deleteRequested) {
  process.stdout.write("Re-run with --delete to force-delete the instances above.\n");
  process.exit(0);
}

for (const instance of matches) {
  runIncus(["delete", String(instance.name), "--force"]);
  process.stdout.write(`Deleted ${instance.name}\n`);
}

function runIncus(args) {
  const result = spawnSync(incusBin, args, {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `${incusBin} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }

  return result;
}
