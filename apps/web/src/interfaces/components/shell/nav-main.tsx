"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils.js";
import { can, hasRole, isFeatureEnabled } from "@/lib/features.js";
import type { SidebarNavSection } from "@/interfaces/constants/sidebar-menu.js";
import { useAppSelector } from "@/domain/store/hooks.js";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/interfaces/components/ui/sidebar.js";

export function NavMain({ sections }: { sections: SidebarNavSection[] }) {
  const pathname = usePathname();
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);

  // Feature flags: not persisted in Redux yet; default all-enabled.
  // When workspace.features is wired into the session slice, swap null here.
  const features: Record<string, boolean> | null = null;

  return (
    <>
      {sections.map((section, sectionIdx) => {
        // Hide the Settings section entirely for sub-ANALYST roles.
        if (section.title === "Settings" && !can.viewSettings(workspaceRole)) {
          return null;
        }

        const visibleItems = section.items.filter((item) => {
          if (item.featureKey && !isFeatureEnabled(features, item.featureKey)) return false;
          if (item.minRole && !hasRole(workspaceRole, item.minRole)) return false;
          return true;
        });

        if (visibleItems.length === 0) return null;

        return (
          <SidebarGroup key={section.title ?? sectionIdx}>
            {section.title ? (
              <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent className="flex flex-col gap-2">
              <SidebarMenu>
                {visibleItems.map((item) => {
                  const isActive =
                    pathname === item.path ||
                    (item.path !== "/" && pathname.startsWith(item.path + "/"));
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        tooltip={item.title}
                        className={cn(
                          isActive &&
                            "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        )}
                      >
                        <Link href={item.path}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </>
  );
}
