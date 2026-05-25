// @paradigm: sql
// Dashboard page — Server Component shell.
// The app shell (sidebar + header) is provided by the (shell) layout.
// CF-C6-RENDER-ONLY-1: zero arithmetic — all values from tRPC BFF.

import type { Metadata } from "next";
import { DashboardContent } from "@/interfaces/components/dashboard/dashboard-content.js";

export const metadata: Metadata = {
  title: "Dashboard — Brain",
};

export default function DashboardPage() {
  return <DashboardContent />;
}
