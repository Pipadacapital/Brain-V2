"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils.js";
import { can, hasRole, isFeatureEnabled } from "@/lib/features.js";
import type { SidebarNavSection } from "@/interfaces/constants/sidebar-menu.js";
import { useAppSelector } from "@/domain/store/hooks.js";
import { useWorkspaceSlug } from "@/infrastructure/workspace-slug-context.js";
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
  const workspaceSlug = useWorkspaceSlug();

  // Feature flags: not persisted in Redux yet; default all-enabled.
  // When workspace.features is wired into the session slice, swap null here.
  const features: Record<string, boolean> | null = null;

  /**
   * Convert a flat sidebar path (e.g. "/dashboard") to a workspace-scoped URL
   * (e.g. "/w/sugandh-lok/dashboard"). When the slug is available (the normal
   * shell case) we prepend /w/{slug}; otherwise we fall back to the flat path so
   * the nav renders even if the context hasn't hydrated yet.
   */
  function scopedPath(itemPath: string): string {
    if (!workspaceSlug) return itemPath;
    return `/w/${workspaceSlug}${itemPath}`;
  }

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
                  const href = scopedPath(item.path);
                  // Active-state detection: match the scoped URL against the
                  // actual browser pathname (which is workspace-scoped too).
                  const isActive =
                    pathname === href ||
                    (href !== "/" && pathname.startsWith(href + "/"));
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
                        <Link href={href}>
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
