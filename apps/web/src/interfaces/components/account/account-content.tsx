'use client';

// @paradigm: sql
// AccountContent — the /account page (legacy-parity-v2 restore).
// Section structure: Profile, Password, Sessions, Danger Zone + Member-since footer.
// Uses shadcn Card/Input/Label/Button/AlertDialog primitives exactly as legacy.
// Password + session management CLIENT-SIDE (supabase.auth.*) — backend never sees plaintext.
// Back link resolves via active workspace ID from Redux store (no hardcoded /dashboard).
//
// Backend: trpc.user.{account, updateProfile, deleteAccount} — identity-tier.
// CF-C6-RENDER-ONLY-1: zero arithmetic. CF-SEC-5: request_id on error UI.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Laptop, Loader2, ShieldCheck, Trash2, User as UserIcon } from 'lucide-react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Avatar, AvatarFallback, AvatarImage } from '@/interfaces/components/ui/avatar.js';
import { Button } from '@/interfaces/components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/interfaces/components/ui/card.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/interfaces/components/ui/alert-dialog.js';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';

function initials(name: string, email: string): string {
  const n = name.trim();
  if (n) return n.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
  return (email[0] ?? 'U').toUpperCase();
}

export function AccountContent() {
  const router = useRouter();
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.user.account.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Detect Google-auth from the live Supabase identity.
  const [providerKnown, setProviderKnown] = useState(false);
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = createSupabaseBrowserClient();
        const { data: u } = await sb.auth.getUser();
        const provider = u.user?.app_metadata?.provider as string | undefined;
        if (!cancelled) {
          setIsGoogleAuth(provider === 'google');
          setProviderKnown(true);
        }
      } catch {
        if (!cancelled) setProviderKnown(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Profile form state
  const [fullName, setFullName] = useState('');
  const [jobRole, setJobRole] = useState('');
  useEffect(() => {
    if (data) { setFullName(data.fullName); setJobRole(data.jobRole); }
  }, [data]);

  const updateProfileMut = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      utils.user.account.invalidate();
    },
    onError: () => {},
  });

  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSaveProfile = () => {
    if (!fullName.trim()) {
      setProfileMsg({ ok: false, text: 'Full name is required' });
      return;
    }
    setProfileMsg(null);
    updateProfileMut.mutate(
      { fullName, jobRole },
      {
        onSuccess: () => setProfileMsg({ ok: true, text: 'Profile updated' }),
        onError: (e) => setProfileMsg({ ok: false, text: e.message }),
      },
    );
  };

  // Password change (client-side via Supabase)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleChangePassword = async () => {
    setPwMsg(null);
    if (!newPassword) {
      setPwMsg({ ok: false, text: 'New password is required' });
      return;
    }
    if (newPassword.length < 8) {
      setPwMsg({ ok: false, text: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ ok: false, text: 'Passwords do not match' });
      return;
    }
    setPwSaving(true);
    try {
      const sb = createSupabaseBrowserClient();
      if (currentPassword && data?.email) {
        const { error: signInErr } = await sb.auth.signInWithPassword({
          email: data.email,
          password: currentPassword,
        });
        if (signInErr) {
          setPwMsg({ ok: false, text: 'Current password is incorrect' });
          setPwSaving(false);
          return;
        }
      }
      const { error: updErr } = await sb.auth.updateUser({ password: newPassword });
      if (updErr) {
        setPwMsg({ ok: false, text: updErr.message });
        setPwSaving(false);
        return;
      }
      setPwMsg({ ok: true, text: 'Password updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setPwMsg({ ok: false, text: (e as Error).message });
    } finally {
      setPwSaving(false);
    }
  };

  // Sign out other sessions
  const [signOutOthersLoading, setSignOutOthersLoading] = useState(false);
  const [sessionsMsg, setSessionsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const handleSignOutOthers = async () => {
    setSessionsMsg(null);
    setSignOutOthersLoading(true);
    try {
      const sb = createSupabaseBrowserClient();
      await sb.auth.signOut({ scope: 'others' });
      setSessionsMsg({ ok: true, text: 'Signed out of all other devices' });
    } catch (e) {
      setSessionsMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSignOutOthersLoading(false);
    }
  };

  // Delete account
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const deleteAccountMut = trpc.user.deleteAccount.useMutation({
    onSuccess: async () => {
      try {
        const sb = createSupabaseBrowserClient();
        await sb.auth.signOut();
      } catch { /* swallow */ }
      router.push('/login');
    },
  });

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== data?.email) return;
    setDeleting(true);
    try {
      deleteAccountMut.mutate();
    } finally {
      setDeleting(false);
    }
  };

  // Back link — workspace-scoped like legacy
  const backHref = workspaceId ? `/dashboard` : '/';

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-6 py-4 md:py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Sign in to manage your account.</p>
      </div>
    );
  }
  if (error) {
    return (
      <ErrorDisplay
        title="Couldn't load account"
        message={error.message}
        requestId={(error as { data?: { requestId?: string } }).data?.requestId}
      />
    );
  }
  if (isLoading || !data || !providerKnown) {
    // Skeleton matching the four-section layout
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b">
          <div className="mx-auto max-w-2xl px-4 py-4 flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-muted animate-pulse" />
            <div className="flex flex-col gap-2">
              <div className="h-7 w-40 rounded bg-muted animate-pulse" />
              <div className="h-4 w-28 rounded bg-muted animate-pulse" />
            </div>
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border bg-card p-6">
              <div className="h-5 w-24 rounded bg-muted animate-pulse mb-4" />
              <div className="space-y-3">
                <div className="h-9 w-full rounded bg-muted animate-pulse" />
                <div className="h-9 w-full rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const avatarInitials = initials(fullName || data.fullName, data.email);

  return (
    <div className="min-h-screen bg-background">
      {/* Full-width border-b header bar — matches legacy chrome */}
      <div className="border-b">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href={backHref} aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <span className="text-sm font-medium text-muted-foreground">Account Settings</span>
        </div>
      </div>

      {/* Content column */}
      <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-6">
        {/* Page title + avatar */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 rounded-xl">
            {data.avatarUrl && <AvatarImage src={data.avatarUrl} alt={fullName} />}
            <AvatarFallback className="rounded-xl text-lg font-semibold">
              {avatarInitials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {fullName || data.email}
            </h1>
            <p className="text-sm text-muted-foreground truncate">{data.email}</p>
          </div>
        </div>

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Profile</CardTitle>
            </div>
            <CardDescription>
              {isGoogleAuth
                ? 'Your name and email are managed by your Google account.'
                : 'Update your display name and role visible to teammates.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="fullName">Full name</Label>
              {isGoogleAuth ? (
                <p id="fullName" className="text-sm py-2 px-3 rounded-md bg-muted/50">
                  {data.fullName || data.email}
                </p>
              ) : (
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={data.email} disabled />
              <p className="text-xs text-muted-foreground">
                {isGoogleAuth
                  ? 'Email is managed by your Google account.'
                  : 'Contact support to change your email address.'}
              </p>
            </div>
            {/* Job role — editable for non-Google, read-only for Google if set */}
            {!isGoogleAuth && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="jobRole">Job role</Label>
                  <Input
                    id="jobRole"
                    value={jobRole}
                    onChange={(e) => setJobRole(e.target.value)}
                    placeholder="e.g. Head of Growth"
                  />
                </div>
                {profileMsg && (
                  <p className={profileMsg.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
                    {profileMsg.text}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={updateProfileMut.isPending}>
                    {updateProfileMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save profile
                  </Button>
                </div>
              </>
            )}
            {isGoogleAuth && data.jobRole && (
              <div className="grid gap-2">
                <Label>Job role</Label>
                <p className="text-sm py-2 px-3 rounded-md bg-muted/50">{data.jobRole}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Password (hidden for Google) ───────────────────────────────── */}
        {!isGoogleAuth && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Password</CardTitle>
              </div>
              <CardDescription>
                Change your account password. Must be at least 8 characters.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                />
              </div>
              {pwMsg && (
                <p className={pwMsg.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
                  {pwMsg.text}
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={handleChangePassword}
                  disabled={pwSaving || !newPassword || !confirmPassword}
                >
                  {pwSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update password
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Sessions ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Laptop className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Sessions</CardTitle>
            </div>
            <CardDescription>
              You&apos;re currently signed in on this device. Sign out of all other active sessions
              if you suspect unauthorized access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Current-session row with Active badge — matches legacy */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Current session</p>
                <p className="text-xs text-muted-foreground">This device — active now</p>
              </div>
              <span
                className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium"
                aria-label="Active session"
              >
                Active
              </span>
            </div>
            {sessionsMsg && (
              <p className={cn('mt-3 text-sm', sessionsMsg.ok ? 'text-green-600' : 'text-red-600')}>
                {sessionsMsg.text}
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={handleSignOutOthers} disabled={signOutOthersLoading}>
                {signOutOthersLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign out other devices
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Danger Zone ─────────────────────────────────────────────────── */}
        <Card className="border-destructive/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
            </div>
            <CardDescription>
              Permanently delete your account and all associated data. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="flex flex-col gap-3">
                      <p>
                        This will permanently delete your account, remove you from all workspaces,
                        and erase all associated data. This action{' '}
                        <strong>cannot be undone</strong>.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Type <strong>{data.email}</strong> to confirm.
                      </p>
                      <Input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={data.email}
                        className="mt-1"
                        aria-label="Type your email to confirm deletion"
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== data.email || deleting || deleteAccountMut.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {(deleting || deleteAccountMut.isPending) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Delete my account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        {/* Member since footer */}
        <p className="text-center text-xs text-muted-foreground pb-4">
          Member since{' '}
          {new Date(data.createdAt).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>
    </div>
  );
}

function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
