"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils.js";
import type { SidebarNavSection } from "@/interfaces/constants/sidebar-menu.js";
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

  return (
    <>
      {sections.map((section, sectionIdx) => {
        if (section.items.length === 0) return null;
        return (
          <SidebarGroup key={section.title ?? sectionIdx}>
            {section.title ? (
              <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent className="flex flex-col gap-2">
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive = pathname === item.path || pathname.startsWith(item.path + "/");
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        tooltip={item.title}
                        className={cn(
                          isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
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
