'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Circle, Loader2, Server } from 'lucide-react';

export default function RegisterInstancePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [testResult, setTestResult] = useState<'HEALTHY' | 'UNREACHABLE' | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registerInstance = trpc.instance.register.useMutation({
    onSuccess: () => {
      router.push(`/orgs/${orgId}/instances`);
    },
  });

  async function handleTestConnection() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(baseURL.replace(/\/$/, '') + '/v1/health', {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      setTestResult(res.ok ? 'HEALTHY' : 'UNREACHABLE');
    } catch {
      setTestResult('UNREACHABLE');
    } finally {
      setTestLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await registerInstance.mutateAsync({ orgId, name, baseURL, bearerToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Breadcrumb
          segments={[
            { label: 'Instances', href: `/orgs/${orgId}/instances` },
            { label: 'Register' },
          ]}
        />
        <h1 className="mt-1 text-2xl font-bold">Register Instance</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <CardTitle>Controlai daemon details</CardTitle>
          </div>
          <CardDescription>
            Run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              controlai token create web-bff
            </code>{' '}
            on your daemon host to generate a bearer token.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="inst-name">Instance name</Label>
              <Input
                id="inst-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="production-us-east-1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inst-url">Base URL</Label>
              <Input
                id="inst-url"
                type="url"
                required
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.mydeployment.sslip.io"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inst-token">Bearer token</Label>
              <Input
                id="inst-token"
                type="password"
                required
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="ct_…"
              />
            </div>

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testLoading || !baseURL || !bearerToken}
              >
                {testLoading ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Testing…</>
                ) : (
                  'Test connection'
                )}
              </Button>
              {testResult === 'HEALTHY' && (
                <Badge variant="success">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Reachable
                </Badge>
              )}
              {testResult === 'UNREACHABLE' && (
                <Badge variant="destructive">
                  <Circle className="mr-1 h-3 w-3" />
                  Unreachable
                </Badge>
              )}
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={registerInstance.isPending}>
              {registerInstance.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registering…</>
              ) : (
                'Register instance'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
