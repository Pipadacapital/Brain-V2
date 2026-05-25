"use client";

import { Separator } from "@/interfaces/components/ui/separator.js";
import { SidebarTrigger } from "@/interfaces/components/ui/sidebar.js";

export function SiteHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        {/* Page breadcrumb slot — children passed from page layouts */}
        <div className="flex-1" />
      </div>
    </header>
  );
}
