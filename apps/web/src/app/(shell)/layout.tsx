// Shell layout — Server Component.
// Wraps all authenticated pages with the inset sidebar + site header.

import { AppSidebar } from "@/interfaces/components/shell/app-sidebar.js";
import { SiteHeader } from "@/interfaces/components/shell/site-header.js";
import { SidebarInset, SidebarProvider } from "@/interfaces/components/ui/sidebar.js";
import { SessionBootstrap } from "@/interfaces/components/auth/session-bootstrap.js";

interface ShellLayoutProps {
  children: React.ReactNode;
}

export default function ShellLayout({ children }: ShellLayoutProps) {
  return (
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
  );
}
