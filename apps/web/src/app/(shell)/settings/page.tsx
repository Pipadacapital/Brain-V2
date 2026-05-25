import type { Metadata } from "next";
import { WorkspaceSettingsContent } from "@/interfaces/components/settings/workspace-settings-content.js";

export const metadata: Metadata = { title: "General Settings — Brain" };

export default function Page() {
  return <WorkspaceSettingsContent />;
}
