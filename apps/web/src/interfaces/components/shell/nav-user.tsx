"use client";

import { useRouter } from "next/navigation";
import {
  CreditCard,
  LogOut,
  Bell,
  UserCircle,
  MoreVertical,
} from "lucide-react";
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
import { useAppSelector } from "@/domain/store/hooks.js";
import { trpc } from "@/infrastructure/trpc-client.js";

function getUserInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);
  const userId = useAppSelector((s) => s.session.userId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Unread notifications badge — small, polled every 60s. Identity-tier proc:
  // works as soon as we have a session, no workspace context needed.
  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchInterval: 60_000 },
  );
  const unreadCount = unreadData?.count ?? 0;

  const displayName = "Brain User";
  const displayEmail = userId ? `${userId.slice(0, 8)}@brain.app` : "user@brain.app";
  const initials = getUserInitials(displayName);

  const handleLogout = () => {
    router.push("/login");
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
                <span className="text-muted-foreground truncate text-xs">
                  {workspaceRole ? workspaceRole.toLowerCase() : "viewer"}
                </span>
              </div>
              <MoreVertical className="ml-auto size-4" />
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
                <UserCircle className="size-4" />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard className="size-4" />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/notifications")}>
                <Bell className="size-4" />
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
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
