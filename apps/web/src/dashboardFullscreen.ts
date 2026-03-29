export function readFullscreenActive(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

export async function syncFullscreenKeyboardLock(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const keyboard = fullscreenKeyboardLock();

  if (!keyboard) {
    return;
  }

  if (!document.fullscreenElement) {
    keyboard.unlock();
    return;
  }

  try {
    await keyboard.lock(["Escape"]);
  } catch {
    keyboard.unlock();
  }
}

export function releaseFullscreenKeyboardLock(): void {
  fullscreenKeyboardLock()?.unlock();
}

function fullscreenKeyboardLock():
  | {
      lock: (keyCodes?: string[]) => Promise<void>;
      unlock: () => void;
    }
  | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const keyboard = (
    navigator as Navigator & {
      keyboard?: {
        lock?: (keyCodes?: string[]) => Promise<void>;
        unlock?: () => void;
      };
    }
  ).keyboard;

  if (!keyboard || typeof keyboard.lock !== "function" || typeof keyboard.unlock !== "function") {
    return null;
  }

  return {
    lock: keyboard.lock.bind(keyboard),
    unlock: keyboard.unlock.bind(keyboard),
  };
}
