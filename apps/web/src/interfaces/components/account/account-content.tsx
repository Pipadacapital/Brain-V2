'use client';

// @paradigm: sql
// AccountContent — the /account page (parity with legacy account-content.tsx
// 468 LOC). Profile (name/role), Email (read-only), Password (Supabase-managed),
// Sign out other sessions, Delete account.
//
// Backend: trpc.user.{account, updateProfile, deleteAccount} — identity-tier.
// Password + session management are CLIENT-SIDE (supabase.auth.*) — the backend
// never sees the plaintext.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ShieldCheck, User as UserIcon, Trash2, Laptop, Loader2,
} from 'lucide-react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Avatar, AvatarFallback, AvatarImage } from '@/interfaces/components/ui/avatar.js';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';

const INPUT_CLS =
  'w-full px-3 py-2 border border-input bg-background rounded-md text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring disabled:opacity-50';
const LABEL_CLS = 'block text-sm font-medium';

function initials(name: string, email: string): string {
  const n = name.trim();
  if (n) return n.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
  return (email[0] ?? 'U').toUpperCase();
}

export function AccountContent() {
  const router = useRouter();
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.user.account.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Detect Google-auth from the live Supabase identity (the backend doesn't
  // know which provider issued the JWT; supabase.auth.getUser does).
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
        if (!cancelled) setProviderKnown(true);   // fall through to "not Google"
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Profile form state — hydrate from server data on first load.
  const [fullName, setFullName] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [profileBanner, setProfileBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  useEffect(() => {
    if (data) { setFullName(data.fullName); setJobRole(data.jobRole); }
  }, [data]);

  const updateProfileMut = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      utils.user.account.invalidate();
      setProfileBanner({ kind: 'ok', msg: 'Profile updated.' });
    },
    onError: (e) => setProfileBanner({ kind: 'err', msg: e.message }),
  });

  // Password change (client-side via Supabase)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwBanner, setPwBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const handleChangePassword = async () => {
    setPwBanner(null);
    if (newPassword.length < 8) {
      setPwBanner({ kind: 'err', msg: 'Password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwBanner({ kind: 'err', msg: 'Passwords do not match.' });
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
          setPwBanner({ kind: 'err', msg: 'Current password is incorrect.' });
          setPwSaving(false);
          return;
        }
      }
      const { error: updErr } = await sb.auth.updateUser({ password: newPassword });
      if (updErr) {
        setPwBanner({ kind: 'err', msg: updErr.message });
        setPwSaving(false);
        return;
      }
      setPwBanner({ kind: 'ok', msg: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setPwBanner({ kind: 'err', msg: (e as Error).message });
    } finally {
      setPwSaving(false);
    }
  };

  // Sign out other sessions
  const [signOutOthersLoading, setSignOutOthersLoading] = useState(false);
  const [sessionsBanner, setSessionsBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const handleSignOutOthers = async () => {
    setSessionsBanner(null);
    setSignOutOthersLoading(true);
    try {
      const sb = createSupabaseBrowserClient();
      await sb.auth.signOut({ scope: 'others' });
      setSessionsBanner({ kind: 'ok', msg: 'Signed out of all other devices.' });
    } catch (e) {
      setSessionsBanner({ kind: 'err', msg: (e as Error).message });
    } finally {
      setSignOutOthersLoading(false);
    }
  };

  // Delete account
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBanner, setDeleteBanner] = useState<{ kind: 'err'; msg: string } | null>(null);
  const deleteAccountMut = trpc.user.deleteAccount.useMutation({
    onSuccess: async () => {
      try {
        const sb = createSupabaseBrowserClient();
        await sb.auth.signOut();
      } catch { /* swallow — user is gone anyway */ }
      router.push('/login');
    },
    onError: (e) => setDeleteBanner({ kind: 'err', msg: e.message }),
  });

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-6 py-4 md:py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Sign in to manage your account.</p>
      </div>
    );
  }
  if (error) {
    return <ErrorDisplay title="Couldn't load account" message={error.message} />;
  }
  if (isLoading || !data || !providerKnown) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const i = initials(fullName || data.fullName, data.email);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 md:py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href="/dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <span className="text-sm font-medium text-muted-foreground">Account Settings</span>
      </div>

      {/* Identity card */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 rounded-xl">
          {data.avatarUrl && <AvatarImage src={data.avatarUrl} alt={fullName} />}
          <AvatarFallback className="rounded-xl text-lg font-semibold">{i}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {fullName || data.email}
          </h1>
          <p className="text-sm text-muted-foreground truncate">{data.email}</p>
        </div>
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6 flex flex-col gap-4 shadow-sm">
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Profile</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {isGoogleAuth
            ? 'Your name and email are managed by your Google account.'
            : 'Update your display name and role visible to teammates.'}
        </p>
        <div className="space-y-2">
          <label htmlFor="fullName" className={LABEL_CLS}>Full name</label>
          {isGoogleAuth ? (
            <p id="fullName" className="text-sm py-2 px-3 rounded-md bg-muted/50">
              {data.fullName || data.email}
            </p>
          ) : (
            <input
              id="fullName" type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full name" className={INPUT_CLS}
            />
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="email" className={LABEL_CLS}>Email</label>
          <input id="email" type="email" value={data.email} disabled className={INPUT_CLS} />
          <p className="text-xs text-muted-foreground">
            {isGoogleAuth ? 'Email is managed by your Google account.' : 'Contact support to change your email address.'}
          </p>
        </div>
        {!isGoogleAuth && (
          <>
            <div className="space-y-2">
              <label htmlFor="jobRole" className={LABEL_CLS}>Job role</label>
              <input
                id="jobRole" type="text" value={jobRole}
                onChange={(e) => setJobRole(e.target.value)}
                placeholder="e.g. Head of Growth" className={INPUT_CLS}
              />
            </div>
            {profileBanner && (
              <p className={profileBanner.kind === 'ok' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
                {profileBanner.msg}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                onClick={() => updateProfileMut.mutate({ fullName, jobRole })}
                disabled={updateProfileMut.isPending || !fullName.trim()}
              >
                {updateProfileMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save profile
              </Button>
            </div>
          </>
        )}
      </section>

      {/* ── Password (hidden for Google) ────────────────────────────────────── */}
      {!isGoogleAuth && (
        <section className="rounded-xl border bg-card p-6 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Password</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Change your account password. Must be at least 8 characters.
          </p>
          <div className="space-y-2">
            <label htmlFor="currentPassword" className={LABEL_CLS}>Current password</label>
            <input
              id="currentPassword" type="password" value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password" autoComplete="current-password"
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="newPassword" className={LABEL_CLS}>New password</label>
            <input
              id="newPassword" type="password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters" autoComplete="new-password"
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className={LABEL_CLS}>Confirm new password</label>
            <input
              id="confirmPassword" type="password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password" autoComplete="new-password"
              className={INPUT_CLS}
            />
          </div>
          {pwBanner && (
            <p className={pwBanner.kind === 'ok' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
              {pwBanner.msg}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              onClick={handleChangePassword}
              disabled={pwSaving || !newPassword || !confirmPassword}
            >
              {pwSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change password
            </Button>
          </div>
        </section>
      )}

      {/* ── Sessions ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6 flex flex-col gap-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Laptop className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Active sessions</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign out of this account everywhere except this device.
        </p>
        {sessionsBanner && (
          <p className={sessionsBanner.kind === 'ok' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
            {sessionsBanner.msg}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={handleSignOutOthers} disabled={signOutOthersLoading}>
            {signOutOthersLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign out other sessions
          </Button>
        </div>
      </section>

      {/* ── Danger zone ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-destructive/40 bg-destructive/[0.02] p-6 flex flex-col gap-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          <h2 className="text-base font-semibold text-destructive">Delete account</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Permanently delete your account and all associated data. This cannot be undone.
          If you are the sole owner of a workspace with other members, transfer ownership first.
        </p>
        {!showDelete ? (
          <div className="flex justify-end">
            <Button variant="destructive" onClick={() => setShowDelete(true)}>
              Delete account
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="deleteConfirm" className={LABEL_CLS}>
                Type your email <span className="font-mono">{data.email}</span> to confirm
              </label>
              <input
                id="deleteConfirm" type="text" value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={data.email} className={INPUT_CLS}
              />
            </div>
            {deleteBanner && <p className="text-sm text-red-600">{deleteBanner.msg}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowDelete(false); setDeleteConfirm(''); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirm !== data.email || deleteAccountMut.isPending}
                onClick={() => deleteAccountMut.mutate()}
              >
                {deleteAccountMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                I understand, delete my account
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
