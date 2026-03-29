import { buildRandomVmNameParts } from "../../../packages/shared/src/vm-name-words.js";

export function buildRandomVmName(
  random: () => number = Math.random,
): string {
  return buildRandomVmNameParts(random).slug;
}
