import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApplyModal } from '../apply-modal';

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    provision: {
      preview: {
        useMutation: (opts: { onSuccess: (data: unknown) => void }) => ({
          mutate: () =>
            opts.onSuccess({
              planId: 'p1',
              planHash: 'h1',
              ops: [
                { id: '1', type: 'setBrokerKind', description: 'Set broker → EMQX', path: '', method: 'PATCH', body: {} },
                { id: '2', type: 'setRetentionDays', description: 'Set retention → 30 days', path: '', method: 'PATCH', body: {} },
                { id: '3', type: 'setIngestMode', description: 'Set ingest mode → push', path: '', method: 'PATCH', body: {} },
              ],
            }),
        }),
      },
      commit: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      status: { invalidate: vi.fn() },
    },
    nodeConfig: { load: { invalidate: vi.fn() } },
    useUtils: () => ({ provision: { status: { invalidate: vi.fn() } }, nodeConfig: { load: { invalidate: vi.fn() } } }),
  },
}));

describe('ApplyModal', () => {
  it('renders preview diff labels for new ops', async () => {
    render(<ApplyModal open onClose={() => {}} orgId="cmorg000000000000000000001" siteGroupId="cmsitegroup0000000000001" />);
    expect(await screen.findByText('Set broker → EMQX')).toBeInTheDocument();
    expect(screen.getByText('Set retention → 30 days')).toBeInTheDocument();
    expect(screen.getByText('Set ingest mode → push')).toBeInTheDocument();
  });
});
