import { describe, expect, it } from 'vitest';
import {
  BOARD_CHUNKED_SUCCESS_REGEX,
  BOARD_DEFAULT_FAILURE_REGEX,
  BOARD_PROMPT_REGEX,
  BOARD_PROVISION_SEQUENCE,
  buildSingleCommandLine,
} from '../board-cli-spec';

describe('BOARD_PROVISION_SEQUENCE', () => {
  it('has six entries in firmware-contract order', () => {
    expect(BOARD_PROVISION_SEQUENCE).toHaveLength(6);
    expect(BOARD_PROVISION_SEQUENCE.map((c) => c.itemId)).toEqual([
      'group_id',
      'broker',
      'certca',
      'certclient',
      'certkey',
      'reboot',
    ]);
  });

  it('certca/certclient/certkey use chunked open/close commands', () => {
    const chunked = BOARD_PROVISION_SEQUENCE.filter((c) => c.kind === 'chunked');
    expect(chunked).toHaveLength(3);
    for (const c of chunked) {
      expect(c.kind).toBe('chunked');
      if (c.kind === 'chunked') {
        expect(c.openCommand).toBe(`${c.itemId} set`);
        expect(c.closeCommand).toBe(`${c.itemId} end`);
      }
    }
  });
});

describe('buildSingleCommandLine', () => {
  it('assembles "<commandWord> <value>"', () => {
    const groupIdCmd = BOARD_PROVISION_SEQUENCE[0]!;
    if (groupIdCmd.kind !== 'single') throw new Error('expected single');
    expect(buildSingleCommandLine(groupIdCmd, 'GROUPID')).toBe('group_id GROUPID');

    const brokerCmd = BOARD_PROVISION_SEQUENCE[1]!;
    if (brokerCmd.kind !== 'single') throw new Error('expected single');
    expect(buildSingleCommandLine(brokerCmd, 'mqtts://h:8883')).toBe('broker mqtts://h:8883');
  });
});

describe('BOARD_PROMPT_REGEX', () => {
  it('matches "CLI>" with optional trailing whitespace', () => {
    expect('CLI>').toMatch(BOARD_PROMPT_REGEX);
    expect('CLI> ').toMatch(BOARD_PROMPT_REGEX);
    expect('CLI>  ').toMatch(BOARD_PROMPT_REGEX);
  });

  it('does not match arbitrary lines', () => {
    expect('hello CLI>').not.toMatch(BOARD_PROMPT_REGEX);
  });
});

describe('BOARD_CHUNKED_SUCCESS_REGEX', () => {
  it('matches firmware "Cert stored: N bytes DER (saved to flash)." line', () => {
    expect('Cert stored: 1234 bytes DER (saved to flash).').toMatch(BOARD_CHUNKED_SUCCESS_REGEX);
    expect('Cert stored: 4096 bytes DER (saved to flash).').toMatch(BOARD_CHUNKED_SUCCESS_REGEX);
  });

  it('matches fallback success tokens', () => {
    expect('stored').toMatch(BOARD_CHUNKED_SUCCESS_REGEX);
    expect('saved').toMatch(BOARD_CHUNKED_SUCCESS_REGEX);
    expect('ok').toMatch(BOARD_CHUNKED_SUCCESS_REGEX);
  });
});

describe('BOARD_DEFAULT_FAILURE_REGEX', () => {
  it('matches firmware failure phrases', () => {
    expect('Error: invalid hex data').toMatch(BOARD_DEFAULT_FAILURE_REGEX);
    expect('Usage: group_id [name]').toMatch(BOARD_DEFAULT_FAILURE_REGEX);
    expect('Unknown command').toMatch(BOARD_DEFAULT_FAILURE_REGEX);
    expect('fail to store').toMatch(BOARD_DEFAULT_FAILURE_REGEX);
  });

  it('does not match success phrases', () => {
    expect('Cert stored: 1234 bytes DER (saved to flash).').not.toMatch(
      BOARD_DEFAULT_FAILURE_REGEX,
    );
    expect('broker set to: mqtts://h:8883').not.toMatch(BOARD_DEFAULT_FAILURE_REGEX);
  });
});
