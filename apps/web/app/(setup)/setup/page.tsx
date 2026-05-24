'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Circle, Loader2, Server, Building2, Rocket } from 'lucide-react';

const STEPS = ['Welcome', 'Create Org', 'Add Instance', 'Done'] as const;
type Step = 1 | 2 | 3 | 4;

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <SetupPageInner />
    </Suspense>
  );
}

function SetupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStep = Number(searchParams.get('step') ?? '1') as Step;
  const [step, setStep] = useState<Step>(
    initialStep >= 1 && initialStep <= 4 ? initialStep : 1,
  );

  // Update URL when step changes (survives page refresh)
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(step));
    window.history.replaceState({}, '', url.toString());
  }, [step]);

  // Org creation state
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgError, setOrgError] = useState<string | null>(null);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  // Instance registration state
  const [instanceName, setInstanceName] = useState('');
  const [instanceURL, setInstanceURL] = useState('');
  const [instanceToken, setInstanceToken] = useState('');
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'HEALTHY' | 'UNREACHABLE' | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const createOrg = trpc.org.create.useMutation();
  const registerInstance = trpc.instance.register.useMutation();

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setOrgError(null);
    try {
      const org = await createOrg.mutateAsync({ name: orgName, slug: orgSlug });
      setCreatedOrgId(org.id);
      setStep(3);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : 'Failed to create org');
    }
  }

  async function handleTestConnection() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(instanceURL.replace(/\/$/, '') + '/v1/health', {
        headers: { Authorization: `Bearer ${instanceToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      setTestResult(res.ok ? 'HEALTHY' : 'UNREACHABLE');
    } catch {
      setTestResult('UNREACHABLE');
    } finally {
      setTestLoading(false);
    }
  }

  async function handleRegisterInstance(e: React.FormEvent) {
    e.preventDefault();
    if (!createdOrgId) return;
    setInstanceError(null);
    try {
      await registerInstance.mutateAsync({
        orgId: createdOrgId,
        name: instanceName,
        baseURL: instanceURL,
        bearerToken: instanceToken,
      });
      setStep(4);
    } catch (err) {
      setInstanceError(
        err instanceof Error ? err.message : 'Failed to register instance',
      );
    }
  }

  return (
    <div className="w-full max-w-lg space-y-6 px-4">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((label, idx) => {
          const stepNum = (idx + 1) as Step;
          const isDone = step > stepNum;
          const isCurrent = step === stepNum;
          return (
            <div key={label} className="flex items-center gap-2">
              {idx > 0 && (
                <div
                  className={`h-px w-8 ${isDone ? 'bg-primary' : 'bg-border'}`}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    isDone
                      ? 'bg-primary text-primary-foreground'
                      : isCurrent
                        ? 'border-2 border-primary text-primary'
                        : 'border-2 border-border text-muted-foreground'
                  }`}
                >
                  {isDone ? <CheckCircle className="h-4 w-4" /> : stepNum}
                </div>
                <span
                  className={`text-xs ${isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 1: Welcome */}
      {step === 1 && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Rocket className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Welcome to controlai-web</CardTitle>
            <CardDescription>
              Let&apos;s get your control plane set up. We&apos;ll walk you through
              creating your first organisation and connecting a controlai daemon.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => setStep(2)}>Get started</Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Create Org */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>Create your organisation</CardTitle>
            </div>
            <CardDescription>
              Your organisation is the top-level workspace. You can invite team
              members later.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleCreateOrg}>
            <CardContent className="space-y-4">
              {orgError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {orgError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="org-name">Organisation name</Label>
                <Input
                  id="org-name"
                  required
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    if (!orgSlug || orgSlug === autoSlug(orgName)) {
                      setOrgSlug(autoSlug(e.target.value));
                    }
                  }}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-slug">
                  URL slug{' '}
                  <span className="text-xs text-muted-foreground">(unique, lowercase)</span>
                </Label>
                <Input
                  id="org-slug"
                  required
                  pattern="[a-z0-9-]+"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  placeholder="acme-corp"
                />
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                type="submit"
                disabled={createOrg.isPending}
                className="w-full"
              >
                {createOrg.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</>
                ) : (
                  'Create organisation'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Step 3: Add Instance */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <CardTitle>Connect a controlai daemon</CardTitle>
            </div>
            <CardDescription>
              Register the HTTPS URL and bearer token for your controlai daemon.
              Run <code className="text-xs bg-muted px-1 py-0.5 rounded">controlai token create web-bff</code> on
              your daemon host to generate a token.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleRegisterInstance}>
            <CardContent className="space-y-4">
              {instanceError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {instanceError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="instance-name">Instance name</Label>
                <Input
                  id="instance-name"
                  required
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="production-us-east-1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instance-url">Base URL</Label>
                <Input
                  id="instance-url"
                  type="url"
                  required
                  value={instanceURL}
                  onChange={(e) => setInstanceURL(e.target.value)}
                  placeholder="https://api.mydeployment.sslip.io"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instance-token">Bearer token</Label>
                <Input
                  id="instance-token"
                  type="password"
                  required
                  value={instanceToken}
                  onChange={(e) => setInstanceToken(e.target.value)}
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
                  disabled={testLoading || !instanceURL || !instanceToken}
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
            <CardFooter>
              <Button
                type="submit"
                disabled={registerInstance.isPending}
                className="w-full"
              >
                {registerInstance.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registering…</>
                ) : (
                  'Register instance'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Step 4: Done */}
      {step === 4 && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle>You&apos;re all set!</CardTitle>
            <CardDescription>
              Your organisation and first controlai instance have been configured.
              Head to the dashboard to start creating projects.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button
              onClick={() => {
                if (createdOrgId) {
                  router.push(`/orgs/${createdOrgId}/projects`);
                } else {
                  router.push('/');
                }
              }}
            >
              Go to dashboard
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
