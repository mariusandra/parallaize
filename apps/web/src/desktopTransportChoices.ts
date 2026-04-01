import type { VmDesktopTransport } from "../../../packages/shared/src/types.js";
import {
  formatDesktopTransportLabel,
  vmDesktopTransports,
} from "../../../packages/shared/src/desktopTransport.js";

export interface DesktopTransportChoice {
  copy: string;
  value: VmDesktopTransport;
}

const transportCopyByValue: Record<VmDesktopTransport, string> = {
  guacamole: "Canvas tunnel through guacd.",
  selkies: "Fast WebRTC path.",
  vnc: "Direct noVNC bridge.",
};

export const desktopTransportChoices: DesktopTransportChoice[] = vmDesktopTransports.map(
  (value) => ({
    copy: transportCopyByValue[value],
    value,
  }),
);

export function desktopTransportChoiceLabel(
  transport: VmDesktopTransport,
): string {
  return formatDesktopTransportLabel(transport);
}
