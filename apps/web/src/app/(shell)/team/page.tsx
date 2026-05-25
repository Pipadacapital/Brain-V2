import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Team — Brain" };

export default function Page() {
  return <ScaffoldPage title="Team" description="Team members, roles, and access management." />;
}
