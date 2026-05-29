import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: 'cmorg000000000000000000001' }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/layout/breadcrumb', () => ({ Breadcrumb: () => null }));
vi.mock('@/components/instances/provision-instance-dialog', () => ({ ProvisionInstanceDialog: () => <button>Provision</button> }));
vi.mock('@/components/domain/delete-confirm-dialog', () => ({ DeleteConfirmDialog: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => null }));
vi.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    instance: {
      list: { useQuery: () => ({ isLoading: false, data: [{ id: 'i1', name: 'Sandbox daemon', baseURL: 'https://d', status: 'HEALTHY', lastSeenAt: null, version: null, capacityUsedMB: null, capacityAllowedMB: null, env: 'prod', legacy: false }] }) },
      delete: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      retryProvision: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deprovision: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({ instance: { list: { invalidate: vi.fn() } } }),
  },
}));

import InstancesPage from '../app/(app)/orgs/[orgId]/instances/page';

describe('InstancesPage', () => {
  it('hides Provision button and renders health pill when default daemon exists', () => {
    render(<InstancesPage />);
    expect(screen.getByText(/Sandbox daemon: HEALTHY \(default\)/)).toBeInTheDocument();
    expect(screen.queryByText(/^Provision$/)).not.toBeInTheDocument();
  });
});
