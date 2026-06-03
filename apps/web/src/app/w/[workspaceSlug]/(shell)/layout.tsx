// @paradigm: sql
// Workspace-scoped shell layout — app/w/[workspaceSlug]/(shell)/layout.tsx
//
// This is the AUTHORITATIVE entry point for every authenticated, workspace-scoped
// page. The workspaceSlug in the URL is the single source of truth for which
// workspace is active.
//
// Responsibilities:
//   1. Reads params.workspaceSlug and makes it available to every child via
//      WorkspaceSlugProvider (client context).
//   2. Renders the same AppSidebar + SiteHeader + SidebarProvider chrome that
//      the old flat (shell)/layout.tsx used.
//   3. Delegates auth + workspace-id resolution to SessionBootstrap (unchanged).
//
// Unknown slug: SessionBootstrap already handles the case where auth.session
// returns UNAUTHORIZED (e.g. the slug belongs to a workspace the user is not
// a member of) — it redirects to /onboarding or /login?error=session.
//
// The OLD flat (shell)/ pages at app/(shell)/* are REMOVED in this PR.
// All shell routes now live under app/w/[workspaceSlug]/(shell)/*.

import { AppSidebar } from '@/interfaces/components/shell/app-sidebar.js';
import { SiteHeader } from '@/interfaces/components/shell/site-header.js';
import {
  SidebarInset,
  SidebarProvider,
} from '@/interfaces/components/ui/sidebar.js';
import { SessionBootstrap } from '@/interfaces/components/auth/session-bootstrap.js';
import { WorkspaceSlugProvider } from '@/infrastructure/workspace-slug-context.js';

interface WorkspaceShellLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceShellLayout({
  children,
  params,
}: WorkspaceShellLayoutProps) {
  const { workspaceSlug } = await params;

  return (
    <WorkspaceSlugProvider slug={workspaceSlug}>
      <SidebarProvider>
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
            {/* Hydrate the Redux session from the verified JWT before rendering
                protected content — otherwise every page renders "Not signed in". */}
            <SessionBootstrap>{children}</SessionBootstrap>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceSlugProvider>
  );
}
