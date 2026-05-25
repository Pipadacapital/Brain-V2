import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "General Settings — Brain" };

export default function Page() {
  return <ScaffoldPage title="General Settings" description="Workspace general settings and preferences." />;
}
