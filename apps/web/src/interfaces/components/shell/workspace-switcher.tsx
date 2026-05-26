"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
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
  const router = useRouter();
  const dispatch = useAppDispatch();

  const currentWorkspaceId = useAppSelector((s) => s.session.workspaceId);
  const currentUserId = useAppSelector((s) => s.session.userId);
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);

  const { data: workspaceList } = trpc.workspace.list.useQuery(undefined, {
    enabled: !!currentWorkspaceId,
  });

  const switchMutation = trpc.workspace.switch.useMutation({
    onSuccess(data) {
      dispatch(
        setSession({
          userId: currentUserId ?? "anonymous",
          workspaceId: data.workspaceId,
          workspaceRole: workspaceRole ?? "VIEWER",
        })
      );
    },
  });

  // Display the REAL workspace name from the membership list (never a hardcoded brand).
  const currentName =
    workspaceList?.workspaces?.find((w) => w.workspaceId === currentWorkspaceId)?.name ??
    "Workspace";

  const initials = currentName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{currentName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  growth plan
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
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
                onClick={() => {
                  if (ws.workspaceId !== currentWorkspaceId) {
                    // Persist the selection (the tRPC client sends it as x-brain-workspace;
                    // the gateway validates it against real membership) then hard-reload so
                    // every query refetches against the newly-active workspace.
                    try {
                      window.localStorage.setItem('brain.activeWorkspace', ws.workspaceId);
                    } catch {
                      /* ignore */
                    }
                    switchMutation.mutate({ workspaceId: ws.workspaceId });
                    window.location.assign('/dashboard');
                  }
                }}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[10px] font-bold">
                  {ws.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="flex-1 truncate text-sm">
                  {ws.name}
                </span>
                {ws.workspaceId === currentWorkspaceId && (
                  <Check className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push("/onboarding")}
              className="gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
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
