// @paradigm: io
// nav-main tests — role-based access control (RBAC) + feature gating.
// Verifies that the Settings section is hidden for VIEWERs and that
// minRole / featureKey filtering works as intended.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  workspaceRole: 'OWNER' as string | null,
  pathname: '/dashboard',
}));

vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { workspaceRole: h.workspaceRole } }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => h.pathname,
}));

// Stub out the workspace slug context — return empty string so the nav
// falls back to flat paths (matching the hardcoded paths in this test's SECTIONS).
vi.mock('@/infrastructure/workspace-slug-context.js', () => ({
  useWorkspaceSlug: () => '',
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/interfaces/components/ui/sidebar.js', () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  // When asChild=true, wrap children in a span that carries the className so
  // tests can assert active-state styling on the wrapper element.
  SidebarMenuButton: ({
    children,
    asChild,
    className,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    className?: string;
  }) => asChild ? <span className={className}>{children}</span> : <button className={className}>{children}</button>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
}));

vi.mock('@/lib/utils.js', () => ({ cn: (...c: string[]) => c.filter(Boolean).join(' ') }));

import { NavMain } from '@/interfaces/components/shell/nav-main.js';
import type { SidebarNavSection } from '@/interfaces/constants/sidebar-menu.js';

const SECTIONS: SidebarNavSection[] = [
  {
    items: [
      { title: 'Dashboard', path: '/dashboard', icon: () => null },
    ],
  },
  {
    title: 'Settings',
    items: [
      { title: 'General', path: '/settings', icon: () => null, minRole: 'ANALYST' },
      { title: 'Integrations', path: '/settings/integrations', icon: () => null, minRole: 'MANAGER' },
    ],
  },
  {
    items: [
      { title: 'Meta Ads', path: '/meta-ads', icon: () => null, featureKey: 'meta_ads' },
      { title: 'P&L', path: '/pnl', icon: () => null, featureKey: 'pnl' },
      { title: 'Costs', path: '/settings/costs', icon: () => null, minRole: 'ANALYST' },
      { title: 'Team', path: '/team', icon: () => null, minRole: 'ANALYST' },
    ],
  },
];

beforeEach(() => {
  h.workspaceRole = 'OWNER';
  h.pathname = '/dashboard';
});

describe('NavMain — role gating', () => {
  it('OWNER sees all sections including Settings', () => {
    render(<NavMain sections={SECTIONS} />);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Integrations')).toBeTruthy();
    expect(screen.getByText('Costs')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
  });

  it('VIEWER does not see the Settings section', () => {
    h.workspaceRole = 'VIEWER';
    render(<NavMain sections={SECTIONS} />);
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.queryByText('General')).toBeNull();
    expect(screen.queryByText('Integrations')).toBeNull();
  });

  it('ANALYST sees Settings > General but not Integrations (MANAGER required)', () => {
    h.workspaceRole = 'ANALYST';
    render(<NavMain sections={SECTIONS} />);
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.queryByText('Integrations')).toBeNull();
  });

  it('VIEWER does not see Costs or Team (minRole ANALYST)', () => {
    h.workspaceRole = 'VIEWER';
    render(<NavMain sections={SECTIONS} />);
    expect(screen.queryByText('Costs')).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
  });

  it('ANALYST sees Costs and Team', () => {
    h.workspaceRole = 'ANALYST';
    render(<NavMain sections={SECTIONS} />);
    expect(screen.getByText('Costs')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
  });

  it('Dashboard is always visible regardless of role', () => {
    h.workspaceRole = 'VIEWER';
    render(<NavMain sections={SECTIONS} />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });
});

describe('NavMain — feature gating', () => {
  it('all features visible when features=null (default all-enabled)', () => {
    // features=null is the default — all featureKey items should appear.
    render(<NavMain sections={SECTIONS} />);
    expect(screen.getByText('Meta Ads')).toBeTruthy();
    expect(screen.getByText('P&L')).toBeTruthy();
  });
});

describe('NavMain — active state', () => {
  it('active item gets the bg-sidebar-accent class', () => {
    h.pathname = '/dashboard';
    const { container } = render(<NavMain sections={SECTIONS} />);
    const dashLink = container.querySelector('a[href="/dashboard"]');
    // The SidebarMenuButton mock wraps with a span that carries className.
    const wrapper = dashLink?.parentElement;
    expect(wrapper?.className).toContain('bg-sidebar-accent');
  });

  it('non-active items do not get the active class', () => {
    h.pathname = '/dashboard';
    const { container } = render(<NavMain sections={SECTIONS} />);
    const settingsLink = container.querySelector('a[href="/settings"]');
    const wrapper = settingsLink?.parentElement;
    expect(wrapper?.className ?? '').not.toContain('bg-sidebar-accent');
  });
});
