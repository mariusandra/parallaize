export const themeModeStorageKey = "parallaize.theme";
export const livePreviewsStorageKey = "parallaize.live-previews";
export const railWidthStorageKey = "parallaize.rail-width";
export const activeCpuThresholdsByVmStorageKey =
  "parallaize.active-cpu-thresholds-by-vm";
export const overviewSidepanelCollapsedStorageKey =
  "parallaize.overview-sidepanel-collapsed";
export const desktopResolutionByVmStorageKey = "parallaize.desktop-resolution-by-vm";
export const resolutionControlClientIdStorageKey =
  "parallaize.resolution-control-client-id";
export const sidepanelWidthStorageKey = "parallaize.sidepanel-width";
export const sidepanelCollapsedByVmStorageKey = "parallaize.sidepanel-collapsed-vms";
export const collapsedProjectsStorageKey = "parallaize.collapsed-projects";
export const homepageWallpaperStorageKey = "parallaize.homepage-wallpaper";

export type ThemeModePreference = "light" | "dark";

export function readHomepageWallpaperName(): string | null {
  const stored = readStoredString(homepageWallpaperStorageKey);

  if (!stored) {
    return null;
  }

  const trimmed = stored.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readThemeMode(): ThemeModePreference {
  const stored = readStoredString(themeModeStorageKey);

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = readStoredString(key);

  if (stored === "true") {
    return true;
  }

  if (stored === "false") {
    return false;
  }

  return fallback;
}

export function readStoredNumber(key: string): number | null {
  const stored = readStoredString(key);

  if (!stored) {
    return null;
  }

  const value = Number(stored);

  return Number.isFinite(value) ? value : null;
}

export function readStoredString(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function clearStoredString(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore persistence failures and keep the session usable.
  }
}

export function writeStoredString(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore persistence failures and keep the session usable.
  }
}

export function readDocumentVisible(): boolean {
  return typeof document === "undefined" ? true : document.visibilityState === "visible";
}

export function readViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

export function readSidepanelCollapsedByVm(): Record<string, true> {
  const stored = readStoredString(sidepanelCollapsedByVmStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([vmId, collapsed]) => vmId.length > 0 && collapsed === true,
      ),
    ) as Record<string, true>;
  } catch {
    return {};
  }
}

export function readCollapsedProjects(): Record<string, true> {
  const stored = readStoredString(collapsedProjectsStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([projectId, collapsed]) => projectId.length > 0 && collapsed === true,
      ),
    ) as Record<string, true>;
  } catch {
    return {};
  }
}

export function readActiveCpuThresholdsByVm(
  normalizeThreshold: (value: number) => number,
): Record<string, number> {
  const stored = readStoredString(activeCpuThresholdsByVmStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([vmId, threshold]) => {
          if (vmId.length === 0 || typeof threshold !== "number" || !Number.isFinite(threshold)) {
            return null;
          }

          return [vmId, normalizeThreshold(threshold)];
        })
        .filter((entry): entry is [string, number] => entry !== null),
    );
  } catch {
    return {};
  }
}

export function readDesktopResolutionByVm<T>(
  normalizePreference: (preference: unknown) => T,
): Record<string, T> {
  const stored = readStoredString(desktopResolutionByVmStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([vmId]) => vmId.length > 0)
        .map(([vmId, preference]) => [vmId, normalizePreference(preference)]),
    ) as Record<string, T>;
  } catch {
    return {};
  }
}
