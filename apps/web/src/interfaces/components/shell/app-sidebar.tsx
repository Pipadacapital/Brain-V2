"use client";

import * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/interfaces/components/ui/sidebar.js";
import { NavMain } from "@/interfaces/components/shell/nav-main.js";
import { NavUser } from "@/interfaces/components/shell/nav-user.js";
import { WorkspaceSwitcher } from "@/interfaces/components/shell/workspace-switcher.js";
import { sidebarNavSections } from "@/interfaces/constants/sidebar-menu.js";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain sections={sidebarNavSections} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
