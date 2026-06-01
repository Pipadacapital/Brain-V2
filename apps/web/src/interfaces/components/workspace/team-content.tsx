'use client';

// @paradigm: sql
// TeamContent — the /team page, parity-38 feat-parity-w6b.
// Full CRUD: invite (dialog), change role, remove member, transfer ownership, revoke invite.
// shadcn Table/Avatar/Badge/Dialog/DropdownMenu.
// Role gates:
//   - ANALYST+ can VIEW members
//   - MANAGER+ can invite, change role (non-OWNER target), remove non-OWNER, revoke invite
//   - OWNER only can change an OWNER's role, remove an OWNER, transfer ownership
// Email sending is honest-deferred: invite creates the DB row + token only.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from tRPC.

import { useState } from 'react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Badge } from '@/interfaces/components/ui/badge.js';
import { Avatar, AvatarFallback } from '@/interfaces/components/ui/avatar.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/interfaces/components/ui/dialog.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/interfaces/components/ui/dropdown-menu.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/interfaces/components/ui/select.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/interfaces/components/ui/table.js';
import { MoreHorizontal, UserPlus } from 'lucide-react';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

// shadcn Badge variant mapping per role — matches legacy ROLE_COLORS.
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';
const ROLE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  OWNER: 'default',
  ADMIN: 'default',
  MANAGER: 'secondary',
  ANALYST: 'outline',
  VIEWER: 'outline',
};

type Member = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  joined_at: string;
};

type InviteRole = 'MANAGER' | 'ANALYST' | 'VIEWER';
type ChangeRole = 'MANAGER' | 'ANALYST' | 'VIEWER';

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function TeamContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const currentUserId = useAppSelector((s) => s.session.userId);

  const enabled = Boolean(isAuthenticated && workspaceId);
  const utils = trpc.useUtils();

  const q = trpc.team.members.useQuery(undefined, { enabled });

  // Derive the current user's role from the members list (avoids storing PII in Redux).
  const currentMember = q.data?.members.find((m) => m.user_id === currentUserId);
  const userRole = currentMember?.role;
  const isOwner = userRole === 'OWNER';
  const isManager = userRole === 'MANAGER' || isOwner;
  const invitesQ = trpc.team.pendingInvitations.useQuery(undefined, {
    enabled: enabled && isManager,
  });

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('ANALYST');

  // Change role dialog state
  const [changeRoleTarget, setChangeRoleTarget] = useState<Member | null>(null);
  const [newRole, setNewRole] = useState<ChangeRole>('ANALYST');

  // Transfer ownership dialog state
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);

  // Remove confirmation state
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const invalidate = () => {
    utils.team.members.invalidate();
    utils.team.pendingInvitations.invalidate();
  };

  const inviteMut = trpc.team.invite.useMutation({ onSuccess: () => { setInviteOpen(false); setInviteEmail(''); invalidate(); } });
  const changeRoleMut = trpc.team.changeRole.useMutation({ onSuccess: () => { setChangeRoleTarget(null); invalidate(); } });
  const removeMut = trpc.team.removeMember.useMutation({ onSuccess: () => { setRemoveTarget(null); invalidate(); } });
  const revokeInviteMut = trpc.team.revokeInvite.useMutation({ onSuccess: () => invalidate() });
  const transferMut = trpc.team.transferOwnership.useMutation({ onSuccess: () => { setTransferTarget(null); invalidate(); } });

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-0.5">workspace members &amp; roles</p>
        </div>
        {isManager && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Invite member
          </Button>
        )}
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading members" className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load team" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <section className="bg-card rounded-lg border p-6 space-y-4">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Members ({q.data.members.length})</h2>
            {q.data.pending_invitations > 0 && (
              <span className="text-xs text-muted-foreground">{q.data.pending_invitations} pending invitation(s)</span>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {isManager && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.members.map((m) => {
                const isCurrentUser = m.user_id === currentUserId;
                const canManageThisRow = isOwner || (isManager && m.role !== 'OWNER');
                return (
                  <TableRow key={m.user_id}>
                    {/* Avatar + identity cell */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">{initials(m.full_name || m.email)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                            {m.full_name || '—'}
                            {isCurrentUser && <span className="text-[10px] text-muted-foreground">(you)</span>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role badge */}
                    <TableCell>
                      <Badge variant={ROLE_BADGE_VARIANT[m.role] ?? 'outline'}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </Badge>
                    </TableCell>

                    <TableCell className="tabular-nums text-muted-foreground text-sm">
                      {m.joined_at}
                    </TableCell>

                    {isManager && (
                      <TableCell>
                        {canManageThisRow && !isCurrentUser && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${m.full_name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setChangeRoleTarget(m);
                                  setNewRole((m.role === 'OWNER' ? 'MANAGER' : m.role) as ChangeRole);
                                }}
                              >
                                Change role
                              </DropdownMenuItem>
                              {isOwner && m.role !== 'OWNER' && (
                                <DropdownMenuItem onClick={() => setTransferTarget(m)}>
                                  Transfer ownership
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setRemoveTarget(m)}
                              >
                                Remove member
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}

      {/* Pending invitations list */}
      {isManager && invitesQ.data && invitesQ.data.invitations.length > 0 && (
        <section className="bg-card rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Pending invitations ({invitesQ.data.invitations.length})</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead>Join link</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitesQ.data.invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-sm">{inv.email}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_BADGE_VARIANT[inv.role] ?? 'outline'}>{ROLE_LABEL[inv.role] ?? inv.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded break-all">/join/{inv.token}</code>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7 text-xs"
                      onClick={() => revokeInviteMut.mutate({ invitation_id: inv.id })}
                      disabled={revokeInviteMut.isPending}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            An invitation link will be created. Email sending is not yet wired — share the link manually.
          </p>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@brand.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as InviteRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="ANALYST">Analyst</SelectItem>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteMut.data && !inviteMut.data.ok && (
              <p className="text-sm text-destructive">{(inviteMut.data as { ok: false; error: string }).error}</p>
            )}
            {inviteMut.data && inviteMut.data.ok && (inviteMut.data as { ok: true; token?: string }).token && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Invitation created. Share this link:</p>
                <code className="block text-xs bg-muted px-2 py-1.5 rounded break-all">
                  /join/{(inviteMut.data as { ok: true; token?: string }).token}
                </code>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              onClick={() => inviteMut.mutate({ email: inviteEmail, role: inviteRole })}
              disabled={inviteMut.isPending || !inviteEmail}
            >
              {inviteMut.isPending ? 'Creating…' : 'Create invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change role dialog */}
      <Dialog open={Boolean(changeRoleTarget)} onOpenChange={() => setChangeRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role — {changeRoleTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="change-role">New role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as ChangeRole)}>
                <SelectTrigger id="change-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="ANALYST">Analyst</SelectItem>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeRoleTarget(null)}>Cancel</Button>
            <Button
              onClick={() => changeRoleTarget && changeRoleMut.mutate({ user_id: changeRoleTarget.user_id, new_role: newRole })}
              disabled={changeRoleMut.isPending}
            >
              {changeRoleMut.isPending ? 'Saving…' : 'Save role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove member dialog */}
      <Dialog open={Boolean(removeTarget)} onOpenChange={() => setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.full_name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove {removeTarget?.email} from the workspace. They can be re-invited later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => removeTarget && removeMut.mutate({ user_id: removeTarget.user_id })}
              disabled={removeMut.isPending}
            >
              {removeMut.isPending ? 'Removing…' : 'Remove member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer ownership dialog */}
      <Dialog open={Boolean(transferTarget)} onOpenChange={() => setTransferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer ownership to {transferTarget?.full_name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {transferTarget?.full_name} ({transferTarget?.email}) will become the workspace Owner.
            You will be demoted to Manager. This cannot be undone without their cooperation.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => transferTarget && transferMut.mutate({ new_owner_user_id: transferTarget.user_id })}
              disabled={transferMut.isPending}
            >
              {transferMut.isPending ? 'Transferring…' : 'Transfer ownership'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
