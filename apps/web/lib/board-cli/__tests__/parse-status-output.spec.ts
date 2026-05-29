import { describe, expect, it } from 'vitest';

import { parseStatusOutput } from '../parse-status-output';

const GOLDEN = `
[Board Status]
  Board ID:    2C004A001351353230363438
  Board Type:  MAIN
  Firmware     DAEJAK_MAIN v1.2.0
  IP Address:  192.168.39.71
  State:       NORMAL
  RTC Time:    2026-05-27 17:54:54

[MQTT Status]
  connected: connected
  broker:   mqtts://api.52-79-241-139.nip.io:8883
  port:     8883
  clientid: 2C004A001351353230363438
  subs:     2 topic(s)
    [1] modules/modules/NCMD/2C004A001351353230363438
    [2] modules/modules/DCMD/2C004A001351353230363438/+

[MQTT]
  group_id:      modules
  edge_node_id:  2C004A001351353230363438
  collection_period:     600 sec
  collection_align:      on

[485 Bus Status]
  Registered: 1
  [1] 0B0003000F5355533936302D  type=DAEJAK_VM
`;

describe('parseStatusOutput', () => {
  it('parses golden sample snapshot', () => {
    expect(parseStatusOutput(GOLDEN)).toMatchSnapshot();
  });

  it('throws on empty input', () => {
    expect(() => parseStatusOutput('')).toThrow(/empty/i);
  });

  it('throws on whitespace-only input', () => {
    expect(() => parseStatusOutput('   \n\t  ')).toThrow(/empty/i);
  });

  it('throws on mangled header', () => {
    expect(() => parseStatusOutput('[Board Status\nBoard ID: x')).toThrow(/header/i);
  });

  it('supports only board status section', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: A\n');
    expect(parsed.boardReportedUuid).toBe('A');
    expect(parsed._unparsed).toEqual([]);
  });

  it('supports CRLF line endings', () => {
    const parsed = parseStatusOutput('[Board Status]\r\nBoard ID: A\r\n');
    expect(parsed.boardReportedUuid).toBe('A');
  });

  it('supports lone LF line endings', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: A\n');
    expect(parsed.boardReportedUuid).toBe('A');
  });

  it('tolerates leading and trailing whitespace', () => {
    const parsed = parseStatusOutput('  \n  [Board Status]\n  Board ID: A  \n  ');
    expect(parsed.boardReportedUuid).toBe('A');
  });

  it('supports lowercase section headers', () => {
    const parsed = parseStatusOutput('[board status]\nboard id: abc\n');
    expect(parsed.boardReportedUuid).toBe('abc');
  });

  it('supports mixed-case keys', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoArD Id: abc\n');
    expect(parsed.boardReportedUuid).toBe('abc');
  });

  it('captures unrecognized lines in board section', () => {
    const parsed = parseStatusOutput('[Board Status]\nfoo: bar\n');
    expect(parsed._unparsed).toEqual(['foo: bar']);
  });

  it('captures unknown section body lines', () => {
    const parsed = parseStatusOutput('[Unknown Section]\nabc\n[Board Status]\nBoard ID: x\n');
    expect(parsed._unparsed).toContain('abc');
  });

  it('handles missing 485 bus section', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: x\n[MQTT]\ngroup_id: g\n');
    expect(parsed.bus485.registered).toBeNull();
    expect(parsed.bus485.children).toEqual([]);
  });

  it('handles missing mqtt subs list', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: x\n[MQTT Status]\nsubs: 0 topic(s)\n');
    expect(parsed.mqttStatus.subscriptions).toEqual([]);
  });

  it('parses mqtt subscriptions lines', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: x\n[MQTT Status]\n[1] a/b\n[2] c/d\n');
    expect(parsed.mqttStatus.subscriptions).toEqual(['a/b', 'c/d']);
  });

  it('parses 485 children lines', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: x\n[485 Bus Status]\n[1] 0B0003000F5355533936302D  type=DAEJAK_VM\n');
    expect(parsed.bus485.children[0]).toEqual({ raw: '0B0003000F5355533936302D', reportedTypeLabel: 'DAEJAK_VM' });
  });

  it('ignores blank lines inside sections', () => {
    const parsed = parseStatusOutput('[Board Status]\n\nBoard ID: x\n\n');
    expect(parsed.boardReportedUuid).toBe('x');
  });

  it('keeps unknown mqtt key in _unparsed', () => {
    const parsed = parseStatusOutput('[Board Status]\nBoard ID: x\n[MQTT]\nfoo_key: abc\n');
    expect(parsed._unparsed).toContain('foo_key: abc');
  });
});
