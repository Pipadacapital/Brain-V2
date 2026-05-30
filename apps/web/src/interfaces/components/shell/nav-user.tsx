"use client";

import { useRouter } from "next/navigation";
import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
} from "@tabler/icons-react";
import {
  Avatar,
  AvatarFallback,
} from "@/interfaces/components/ui/avatar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/interfaces/components/ui/dropdown-menu.js";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/interfaces/components/ui/sidebar.js";
import { useAppDispatch, useAppSelector } from "@/domain/store/hooks.js";
import { clearSession } from "@/domain/store/session-slice.js";
import { trpc } from "@/infrastructure/trpc-client.js";
import { createSupabaseBrowserClient } from "@/infrastructure/supabase/client.js";

function getUserInitials(name: string, fallbackEmail: string): string {
  const n = name.trim();
  if (n) {
    return n
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (fallbackEmail[0] ?? "U").toUpperCase();
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Real profile drives the avatar + dropdown label (Slice 2 backend).
  const { data: profile } = trpc.user.account.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  // Unread notifications badge — small, polled every 60s. Identity-tier proc:
  // works as soon as we have a session, no workspace context needed.
  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchInterval: 60_000 },
  );
  const unreadCount = unreadData?.count ?? 0;

  const displayName = profile?.fullName?.trim() || profile?.email || "";
  const displayEmail = profile?.email || "";
  const initials = getUserInitials(profile?.fullName ?? "", displayEmail);

  // Real logout: kill the Supabase session, drop Redux state + the persisted
  // workspace, then route to /login. Without auth.signOut() the cookie persists
  // and the middleware bounces the user back into the protected shell.
  const handleLogout = async () => {
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      /* best-effort — proceed to clear local state */
    }
    dispatch(clearSession());
    try {
      window.localStorage.removeItem("brain.activeWorkspace");
    } catch {
      /* ignore */
    }
    // Use a hard navigation so any in-flight queries + caches reset cleanly.
    // Redirect directly to /auth/login (canonical login surface, matching legacy).
    window.location.assign("/auth/login");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary text-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                {/* Trigger subtitle shows email, matching legacy nav-user */}
                <span className="text-muted-foreground truncate text-xs">
                  {displayEmail}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary text-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {displayEmail}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push("/account")}>
                <IconUserCircle />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <IconCreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/notifications")}>
                <IconNotification />
                <span className="flex-1">Notifications</span>
                {unreadCount > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
