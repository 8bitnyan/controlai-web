import { describe, expect, it } from 'vitest';

import { parseDiscoveredChild } from '../parse-discovered-child';

describe('parseDiscoveredChild', () => {
  it('parses valid uppercase input', () => {
    const parsed = parseDiscoveredChild('0B0003000F5355533936302D', 'DAEJAK_VM');

    expect(parsed).toEqual({
      raw: '0B0003000F5355533936302D',
      address: 0x0b,
      firmwareTypeCode: '0003000F',
      serialAscii: 'SUS960-',
      reportedTypeLabel: 'DAEJAK_VM',
      portId: 'rs485-1',
    });
  });

  it('accepts lowercase hex', () => {
    const parsed = parseDiscoveredChild('0b0003000f5355533936302d', 'DAEJAK_VM');
    expect(parsed?.address).toBe(11);
    expect(parsed?.firmwareTypeCode).toBe('0003000f');
    expect(parsed?.serialAscii).toBe('SUS960-');
  });

  it('returns null for short length', () => {
    expect(parseDiscoveredChild('0B0003000F535553393630', 'DAEJAK_VM')).toBeNull();
  });

  it('returns null for long length', () => {
    expect(parseDiscoveredChild('0B0003000F5355533936302D00', 'DAEJAK_VM')).toBeNull();
  });

  it('returns null for non-hex input', () => {
    expect(parseDiscoveredChild('0B0003000F53555339363G2D', 'DAEJAK_VM')).toBeNull();
  });

  it('sets serialAscii null when tail includes control chars', () => {
    const parsed = parseDiscoveredChild('0B0003000F410A4344454647', 'DAEJAK_VM');
    expect(parsed?.serialAscii).toBeNull();
  });

  it('keeps serialAscii when all chars are printable ASCII', () => {
    const parsed = parseDiscoveredChild('010003000F41424344454647', 'DAEJAK_VM');
    expect(parsed?.serialAscii).toBe('ABCDEFG');
  });

  it('preserves reportedTypeLabel in output', () => {
    const parsed = parseDiscoveredChild('010003000F41424344454647', 'CUSTOM_LABEL');
    expect(parsed?.reportedTypeLabel).toBe('CUSTOM_LABEL');
  });
});
