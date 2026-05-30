"use client";

import { IconSelector, IconCheck, IconPlus } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
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
import { useAppSelector, useAppDispatch } from "@/domain/store/hooks.js";
import { setSession } from "@/domain/store/session-slice.js";
import { trpc } from "@/infrastructure/trpc-client.js";

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar();
  const dispatch = useAppDispatch();

  const currentWorkspaceId = useAppSelector((s) => s.session.workspaceId);
  const currentUserId = useAppSelector((s) => s.session.userId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const { data: workspaceList } = trpc.workspace.list.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const currentWs = workspaceList?.workspaces?.find(
    (w) => w.workspaceId === currentWorkspaceId,
  );

  const currentName = currentWs?.name ?? "Workspace";
  const currentPlan = currentWs?.plan ?? "Growth";

  const initials = currentName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const switchMutation = trpc.workspace.switch.useMutation({
    onSuccess(data) {
      // 1. Persist to localStorage FIRST — the tRPC client reads this header on
      //    every request, so it must be set before the hard reload triggers a new
      //    page load and any new tRPC calls.
      try {
        window.localStorage.setItem("brain.activeWorkspace", data.workspaceId);
      } catch {
        /* ignore — private browsing */
      }

      // 2. Update Redux so any interim renders use the correct workspace.
      dispatch(
        setSession({
          userId: currentUserId ?? "anonymous",
          workspaceId: data.workspaceId,
          workspaceRole: data.role,
        }),
      );

      // 3. Hard reload so every query refetches under the new workspace context.
      //    The new x-brain-workspace header is picked up from localStorage by the
      //    tRPC client on the fresh load.
      window.location.assign("/dashboard");
    },
  });

  const handleSwitch = (workspaceId: string) => {
    if (workspaceId === currentWorkspaceId) return;
    switchMutation.mutate({ workspaceId });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="workspace-switcher-trigger"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{currentName}</span>
                <span className="truncate text-xs text-muted-foreground capitalize">
                  {currentPlan.toLowerCase()} plan
                </span>
              </div>
              <IconSelector className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {workspaceList?.workspaces?.map((ws) => (
              <DropdownMenuItem
                key={ws.workspaceId}
                onClick={() => handleSwitch(ws.workspaceId)}
                className="gap-2 p-2"
                data-testid={`workspace-option-${ws.workspaceId}`}
              >
                <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[10px] font-bold">
                  {ws.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
                <span className="flex-1 truncate text-sm">{ws.name}</span>
                {ws.workspaceId === currentWorkspaceId && (
                  <IconCheck className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => window.location.assign("/onboarding")}
              className="gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <IconPlus className="size-4" />
              </div>
              <span className="text-muted-foreground text-sm">
                Create workspace
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
