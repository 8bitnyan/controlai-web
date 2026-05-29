import { describe, expect, it } from 'vitest';
import { ProtocolFamily } from '../protocol-families';

describe('ProtocolFamily enum', () => {
  it('contains expected members', () => {
    expect(ProtocolFamily.options).toEqual([
      'mqtt',
      'modbus-rtu',
      'modbus-tcp',
      'lorawan',
      'analog-4-20ma',
      'analog-0-10v',
      'rs485-serial-generic',
    ]);
  });
});
