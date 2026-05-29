import { z } from 'zod';

export const ProtocolFamily = z.enum([
  'mqtt',
  'modbus-rtu',
  'modbus-tcp',
  'lorawan',
  'analog-4-20ma',
  'analog-0-10v',
  'rs485-serial-generic',
]);

export type ProtocolFamily = z.infer<typeof ProtocolFamily>;
