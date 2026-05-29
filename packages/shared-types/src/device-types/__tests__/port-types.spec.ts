import { describe, expect, it } from 'vitest';
import { PortType } from '../port-types';

describe('PortType enum', () => {
  it('contains expected members', () => {
    expect(PortType.options).toEqual([
      'rs485-bus',
      'mqtt-topic',
      'analog-input',
      'lorawan-uplink',
      'ethernet',
      'usb-serial',
    ]);
  });
});
