import { describe, it, expect } from 'vitest';
import { SerialProvisioner } from '@/lib/serial-provisioning';

describe('SerialProvisioner', () => {
  it('exports class', () => {
    expect(SerialProvisioner).toBeTypeOf('function');
  });
});
