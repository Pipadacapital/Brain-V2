'use client';

// @paradigm: sql
// NotificationsContent — the /notifications page. Functional parity with the
// legacy notifications-content.tsx (195 LOC): list, All/Unread filter, unread
// badge count, per-item mark-read, mark-all-read, click-through to actionUrl.
//
// Backend: trpc.notifications.{list, unreadCount, markRead, markAllRead}.
// Identity-tier procs — notifications are USER-scoped (workspace_id is
// optional on each row). The "unread" tab + badge re-fetch on every mutation
// for an honest count.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, Check, CheckCheck, Mail, UserPlus, UserMinus,
  ArrowLeftRight, Plug, PlugZap, RefreshCw, AlertTriangle, Info,
} from 'lucide-react';
import { useAppSelector } from '@/domain/store/hooks.js';

// Tiny "X minutes ago" formatter — keeps us off date-fns (not in the web bundle).
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { cn } from '@/lib/utils.js';

// Icon per NotificationType — falls back to the generic bell.
// Legacy SHOPIFY_* keys are aliased so existing DB rows map correctly.
const TYPE_ICONS: Record<string, typeof Bell> = {
  WORKSPACE_INVITE:       Mail,
  INVITE_ACCEPTED:        Check,
  MEMBER_JOINED:          UserPlus,
  MEMBER_REMOVED:         UserMinus,
  ROLE_CHANGED:           ArrowLeftRight,
  CONNECTOR_CONNECTED:    Plug,
  CONNECTOR_DISCONNECTED: PlugZap,
  SHOPIFY_CONNECTED:      Plug,     // legacy alias
  SHOPIFY_DISCONNECTED:   PlugZap,  // legacy alias (was PlugX, closest is PlugZap)
  SYNC_COMPLETED:         RefreshCw,
  SYNC_FAILED:            AlertTriangle,
  SYSTEM:                 Info,
};

export function NotificationsContent() {
  const router = useRouter();
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [isPending, startTransition] = useTransition();
  const utils = trpc.useUtils();

  const enabled = Boolean(isAuthenticated);
  // Workspace-scoped: pass workspaceId to list/unreadCount so the page mirrors
  // legacy per-workspace scoping (workspace rows + globals). Limit = 50 matches legacy.
  const { data, isLoading, error } = trpc.notifications.list.useQuery(
    { filter, limit: 50, workspaceId: workspaceId ?? null },
    { enabled },
  );
  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(
    { workspaceId: workspaceId ?? null },
    { enabled, refetchInterval: 60_000 },
  );

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const items = data?.items ?? [];

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-6 py-4 md:py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">Sign in to see your notifications.</p>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        title="Couldn't load notifications"
        message={error.message}
        requestId={error.data?.httpStatus ? String(error.data.httpStatus) : undefined}
      />
    );
  }

  const handleClick = (n: { id: string; read: boolean; actionUrl: string | null }) => {
    if (!n.read) markRead.mutate({ id: n.id });
    if (n.actionUrl) {
      startTransition(() => { router.push(n.actionUrl!); });
    }
  };

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : "You're all caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAll.mutate({ workspaceId: workspaceId ?? null })}
            disabled={markAll.isPending}
          >
            <CheckCheck className="mr-1.5 h-4 w-4" />
            Mark all as read
          </Button>
        )}
      </div>

      {/* All / Unread filter — minimal inline tab control (no shadcn tabs in this project) */}
      <div className="inline-flex rounded-lg border bg-card p-1">
        {(['all', 'unread'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setFilter(v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              filter === v
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'all' ? 'All' : 'Unread'}
            {v === 'unread' && unreadCount > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  filter === 'unread'
                    ? 'bg-background text-foreground'
                    : 'bg-primary text-primary-foreground',
                )}
              >
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Bell className="h-10 w-10 animate-pulse text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Bell className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map((n) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleClick(n)}
                  disabled={isPending}
                  className={cn(
                    'flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50',
                    !n.read && 'bg-primary/[0.03]',
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          'text-sm leading-snug',
                          !n.read ? 'font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {n.title}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground/60">
                          {relativeTime(n.createdAt)}
                        </span>
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </div>
                    </div>
                    {n.body && (
                      <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
