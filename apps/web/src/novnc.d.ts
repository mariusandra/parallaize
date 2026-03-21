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
    resizeSession: boolean;
    scaleViewport: boolean;
    viewOnly: boolean;
    disconnect(): void;
  }
}
