declare module "@novnc/novnc/lib/rfb.js" {
  export interface RfbCredentials {
    password?: string;
    target?: string;
  }

  export interface RfbDisconnectEventDetail {
    clean: boolean;
  }

  export default class RFB extends EventTarget {
    constructor(
      target: Element,
      url: string,
      options?: {
        credentials?: RfbCredentials;
        shared?: boolean;
      },
    );

    background: string;
    clipViewport: boolean;
    clipboardPasteFrom(text: string): void;
    focus(options?: FocusOptions): void;
    resizeSession: boolean;
    sendKey(keysym: number, code: string, down?: boolean): void;
    scaleViewport: boolean;
    viewOnly: boolean;
    blur(): void;
    disconnect(): void;
  }
}
