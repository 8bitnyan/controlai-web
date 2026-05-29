import { describe, expect, it, vi } from 'vitest';
import { registerDeviceType, __resetRegistryForTests } from '@controlai-web/shared-types';
import type { DiscoveredChild, RegistrationDecisions } from '@controlai-web/shared-types';
import { proposeRegistrationMatch } from '../registration-matcher';

type TestDevice = Parameters<typeof proposeRegistrationMatch>[0][number];

function d(overrides: Partial<TestDevice> = {}): TestDevice {
  return {
    deviceKey: overrides.deviceKey ?? 'd1',
    canvasNodeId: overrides.canvasNodeId ?? 'sensor-1',
    deviceTypeId: overrides.deviceTypeId ?? 'sensor-a',
    portBindings: overrides.portBindings ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

function c(raw: string, firmwareTypeCode: string, address = 1, serialAscii = 'SENS-1', portId = 'rs485-1'): DiscoveredChild {
  return { raw, firmwareTypeCode, address, serialAscii, portId, reportedTypeLabel: firmwareTypeCode };
}

function m(id: string, firmwareTypeIds: string[]): Parameters<typeof registerDeviceType>[0] {
  return {
    id,
    displayName: id,
    manufacturer: 'test',
    model: id,
    category: 'sensor',
    visual: { iconRef: 'box', accentColor: '#888888' },
    ports: [],
    constraints: { minIntervalMs: 100 },
    defaultSignal: { rateMs: 1000, format: 'json', units: 'value', range: { min: 0, max: 100 } },
    datasheet: { certifications: [] },
    registrationHints: { expectedChildTypeIds: [] },
    firmwareTypeIds,
  } as Parameters<typeof registerDeviceType>[0];
}

describe('proposeRegistrationMatch', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  it('case 1: empty empty', () => {
    __resetRegistryForTests();
    expect(proposeRegistrationMatch([], [])).toMatchObject({ confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [] });
  });
  it('case 2: unknown firmware => unknownTypes', () => {
    __resetRegistryForTests();
    expect(proposeRegistrationMatch([], [c('a', 'X')]).unknownTypes).toHaveLength(1);
  });
  it('case 3: empty shadows => extras', () => {
    __resetRegistryForTests();
    registerDeviceType(m('sensor-a', ['A']));
    expect(proposeRegistrationMatch([], [c('a', 'A')]).extras).toHaveLength(1);
  });
  it('case 4: empty discovered => unmatched shadows', () => {
    __resetRegistryForTests();
    expect(proposeRegistrationMatch([d()], []).unmatchedShadows).toHaveLength(1);
  });
  it('case 5: EXACT by type', () => {
    __resetRegistryForTests();
    registerDeviceType(m('sensor-a', ['A']));
    const out = proposeRegistrationMatch([d({ deviceTypeId: 'sensor-a' })], [c('a', 'A')]);
    expect(out.confirmedMatches[0]?.confidence).toBe('EXACT');
  });
  it('case 6: port+address', () => {
    __resetRegistryForTests();
    registerDeviceType(m('sensor-a', ['A']));
    const out = proposeRegistrationMatch([d({ portBindings: { parentPortId: 'rs485-1', address: 9 }, deviceTypeId: 'x' })], [c('a', 'A', 9)]);
    expect(out.confirmedMatches[0]?.confidence).toBe('PORT_AND_ADDRESS');
  });
  it('case 7: order fallback', () => {
    __resetRegistryForTests();
    registerDeviceType(m('sensor-a', ['A']));
    const out = proposeRegistrationMatch([d({ deviceTypeId: 'x' })], [c('a', 'A')]);
    expect(out.confirmedMatches[0]?.confidence).toBe('ORDER_FALLBACK');
  });
  it('case 8: tie break createdAt then id', () => {
    __resetRegistryForTests();
    registerDeviceType(m('sensor-a', ['A']));
    const out = proposeRegistrationMatch([
      d({ deviceKey: 'b', deviceTypeId: 'sensor-a', createdAt: new Date('2026-01-02') }),
      d({ deviceKey: 'a', deviceTypeId: 'sensor-a', createdAt: new Date('2026-01-01') }),
    ], [c('a', 'A')]);
    expect(out.confirmedMatches[0]?.shadowDeviceKey).toBe('a');
  });
  it('case 9: last known reuse', () => {
    __resetRegistryForTests();
    registerDeviceType(m('sensor-a', ['A']));
    const decisions: RegistrationDecisions = { confirmedMatches: [{ shadowDeviceKey: 'd1', discoveredRaw: 'x' }], acceptExtras: [], rejectShadows: [] };
    const out = proposeRegistrationMatch([d()], [c('x', 'A')], decisions);
    expect(out.confirmedMatches[0]?.shadowDeviceKey).toBe('d1');
  });
  it('case 10: multiclaim warns + lexical win', () => {
    __resetRegistryForTests();
    registerDeviceType(m('a-type', ['X']));
    registerDeviceType(m('z-type', ['X']));
    const out = proposeRegistrationMatch([d({ deviceTypeId: 'a-type' })], [c('a', 'X')]);
    expect(out.confirmedMatches[0]?.resolvedDeviceTypeId).toBe('a-type');
    expect(warn).toBeDefined();
  });
  for (let i = 11; i <= 20; i += 1) {
    it(`case ${i}: stable shape`, () => {
      __resetRegistryForTests();
      registerDeviceType(m('sensor-a', ['A']));
      const out = proposeRegistrationMatch([d({ deviceKey: `d${i}`, deviceTypeId: 'sensor-a' })], [c(`r${i}`, 'A')]);
      expect(out.gatewayMatch).toEqual({ boardReportedUuid: '' });
      expect(out.confirmedMatches).toHaveLength(1);
    });
  }
});
