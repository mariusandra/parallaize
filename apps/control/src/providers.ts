import type { ProviderKind } from "../../../packages/shared/src/types.js";

import type { CreateProviderOptions, DesktopProvider } from "./providers-contracts.js";
import { IncusProvider } from "./providers-incus.js";
import { MockProvider } from "./providers-mock.js";

export * from "./providers-contracts.js";

export function createProvider(
  kind: ProviderKind,
  incusBinary: string,
  options: CreateProviderOptions = {},
): DesktopProvider {
  if (kind === "incus") {
    return new IncusProvider(incusBinary, options);
  }

  return new MockProvider();
}
