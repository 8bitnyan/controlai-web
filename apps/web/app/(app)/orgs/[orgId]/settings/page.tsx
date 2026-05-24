'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DeleteConfirmDialog } from '@/components/domain/delete-confirm-dialog';
import { Loader2, UserPlus } from 'lucide-react';

const ROLE_VARIANT = {
  OWNER: 'default',
  ADMIN: 'secondary',
  MEMBER: 'outline',
} as const;

export default function OrgSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  // General tab
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  // Invite tab
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'general' | 'members' | 'danger'>('general');

  const { data: members, isLoading: membersLoading } = trpc.org.listMembers.useQuery({ orgId });
  const utils = trpc.useUtils();

  const updateOrg = trpc.org.update.useMutation({
    onSuccess: () => utils.org.list.invalidate(),
  });
  const deleteOrg = trpc.org.delete.useMutation({
    onSuccess: () => router.push('/'),
  });
  const inviteMember = trpc.org.inviteMember.useMutation({
    onSuccess: () => {
      setInviteEmail('');
      setInviteError(null);
    },
  });
  const removeMember = trpc.org.removeMember.useMutation({
    onSuccess: () => void utils.org.listMembers.invalidate({ orgId }),
  });

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setNameSaving(true);
    try {
      await updateOrg.mutateAsync({ orgId, name: newName });
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setNameSaving(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    try {
      await inviteMember.mutateAsync({ orgId, email: inviteEmail, role: inviteRole });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb segments={[{ label: 'Settings' }]} />
        <h1 className="mt-1 text-2xl font-bold">Organisation Settings</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['general', 'members', 'danger'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* General tab */}
      {activeTab === 'general' && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Update your organisation name</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveName} className="space-y-4">
              {nameError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {nameError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="org-name-update">Organisation name</Label>
                <Input
                  id="org-name-update"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  minLength={2}
                  placeholder="Acme Corp"
                />
              </div>
              <Button type="submit" disabled={nameSaving}>
                {nameSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save changes'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Members tab */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* Invite form */}
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Invite a member</CardTitle>
              <CardDescription>They will receive an email invitation</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="space-y-4">
                {inviteError && (
                  <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {inviteError}
                  </div>
                )}
                {inviteMember.isSuccess && (
                  <div className="rounded-md bg-green-100 p-3 text-sm text-green-800">
                    Invitation sent to {inviteEmail}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="invitee@example.com"
                    className="flex-1"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER')}
                    className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <Button type="submit" disabled={inviteMember.isPending}>
                    {inviteMember.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Members list */}
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-12 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : (
                <div className="divide-y">
                  {members?.map((m) => (
                    <div key={m.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium">{m.user.name}</p>
                        <p className="text-xs text-muted-foreground">{m.user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={ROLE_VARIANT[m.role]}>{m.role}</Badge>
                        {m.role !== 'OWNER' && (
                          <DeleteConfirmDialog
                            resourceName={m.user.name ?? m.user.email}
                            resourceType="member"
                            onConfirm={() =>
                              removeMember.mutateAsync({ orgId, userId: m.userId })
                            }
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Danger zone */}
      {activeTab === 'danger' && (
        <Card className="max-w-lg border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible actions. Please be sure before proceeding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete this organisation</p>
                <p className="text-xs text-muted-foreground">
                  All projects and site groups will be permanently deleted.
                </p>
              </div>
              <DeleteConfirmDialog
                resourceName="this organisation"
                resourceType="organisation"
                onConfirm={() => deleteOrg.mutateAsync({ orgId })}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
