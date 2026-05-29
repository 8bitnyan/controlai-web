import { z } from 'zod';

export const PortType = z.enum(['rs485-bus', 'mqtt-topic', 'analog-input', 'lorawan-uplink', 'ethernet', 'usb-serial']);

export type PortType = z.infer<typeof PortType>;

export const PORT_TYPE_META: Record<PortType, { label: string }> = {
  'rs485-bus': { label: 'RS485 Bus' },
  'mqtt-topic': { label: 'MQTT Topic' },
  'analog-input': { label: 'Analog Input' },
  'lorawan-uplink': { label: 'LoRaWAN Uplink' },
  ethernet: { label: 'Ethernet' },
  'usb-serial': { label: 'USB Serial' },
};
