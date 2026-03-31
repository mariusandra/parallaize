export interface EmbeddedFrameFocusTargetLike {
  focus(options?: FocusOptions): void;
}

export interface EmbeddedFrameDocumentLike {
  addEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => void;
  body?: EmbeddedFrameFocusTargetLike | null;
  documentElement?: EmbeddedFrameFocusTargetLike | null;
  removeEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ) => void;
}

export interface EmbeddedFrameWindowLike extends EmbeddedFrameFocusTargetLike {
  document?: EmbeddedFrameDocumentLike | null;
}

export interface EmbeddedFrameLike extends EmbeddedFrameFocusTargetLike {
  contentDocument?: EmbeddedFrameDocumentLike | null;
  contentWindow?: EmbeddedFrameWindowLike | null;
}

export function focusEmbeddedFrameTarget(
  frame: EmbeddedFrameLike | null | undefined,
): boolean {
  if (!frame) {
    return false;
  }

  let focused = focusTarget(frame);

  try {
    const frameWindow = frame.contentWindow ?? null;
    const frameDocument = frame.contentDocument ?? frameWindow?.document ?? null;

    focused = focusTarget(frameWindow) || focused;
    focused = focusTarget(frameDocument?.documentElement ?? null) || focused;
    focused = focusTarget(frameDocument?.body ?? null) || focused;
  } catch {
    return focused;
  }

  return focused;
}

export function attachEmbeddedFrameFocusBridge(
  frame: EmbeddedFrameLike | null | undefined,
): () => void {
  if (!frame) {
    return noop;
  }

  try {
    const frameWindow = frame.contentWindow ?? null;
    const frameDocument = frame.contentDocument ?? frameWindow?.document ?? null;

    if (
      !frameDocument?.addEventListener ||
      !frameDocument.removeEventListener
    ) {
      return noop;
    }

    const handlePointerInteraction = () => {
      focusEmbeddedFrameTarget(frame);
    };

    frameDocument.addEventListener("pointerdown", handlePointerInteraction, true);
    frameDocument.addEventListener("mousedown", handlePointerInteraction, true);

    return () => {
      frameDocument.removeEventListener?.("pointerdown", handlePointerInteraction, true);
      frameDocument.removeEventListener?.("mousedown", handlePointerInteraction, true);
    };
  } catch {
    return noop;
  }
}

function focusTarget(
  target: EmbeddedFrameFocusTargetLike | null | undefined,
): boolean {
  if (!target) {
    return false;
  }

  try {
    target.focus({
      preventScroll: true,
    });
    return true;
  } catch {
    try {
      target.focus();
      return true;
    } catch {
      return false;
    }
  }
}

function noop(): void {}
