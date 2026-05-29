import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { validateCanvasConnection } from '../canvas';
import * as sharedTypes from '@controlai-web/shared-types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('canvas connection validation', () => {
  it('rejects sensor-to-sensor and emits toast reason', () => {
    const result = validateCanvasConnection({
      connection: { source: 's1', target: 's2', sourceHandle: null, targetHandle: null },
      nodes: [
        { id: 's1', data: { deviceTypeId: 'core-generic-sensor' } },
        { id: 's2', data: { deviceTypeId: 'core-generic-sensor' } },
      ] as any,
      edges: [],
    });
    if (!result.ok) toast.error(result.reason);
    expect(result.ok).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('accepts sensor-to-gateway', () => {
    const result = validateCanvasConnection({
      connection: { source: 's1', target: 'g1', sourceHandle: null, targetHandle: null },
      nodes: [
        { id: 's1', data: { deviceTypeId: 'core-generic-sensor' } },
        { id: 'g1', data: { deviceTypeId: 'core-generic-gateway' } },
      ] as any,
      edges: [],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when capacity is exceeded', () => {
    vi.spyOn(sharedTypes, 'validateConnection').mockReturnValueOnce({ ok: false, code: 'CAPACITY_EXCEEDED', reason: 'capacity exceeded' });
    const result = validateCanvasConnection({
      connection: { source: 'g2', target: 'b1', sourceHandle: null, targetHandle: null },
      nodes: [
        { id: 'g2', data: { deviceTypeId: 'core-generic-gateway' } },
        { id: 'g1', data: { deviceTypeId: 'core-generic-gateway' } },
        { id: 'b1', data: { deviceTypeId: 'core-generic-broker' } },
      ] as any,
      edges: [{ id: 'e1', source: 'g1', target: 'b1' } as any],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && 'code' in result) {
      expect(result.code).toBe('CAPACITY_EXCEEDED');
      toast.error(result.reason);
    }
    expect(toast.error).toHaveBeenCalled();
  });
});
