import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

await mkdir(join(root, "dist", "apps", "web"), { recursive: true });
await cp(join(root, "apps", "web", "static"), join(root, "dist", "apps", "web", "static"), {
  recursive: true,
  force: true,
});
