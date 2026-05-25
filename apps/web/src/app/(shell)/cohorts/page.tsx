import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Cohorts — Brain" };

export default function Page() {
  return <ScaffoldPage title="Cohorts" description="Repeat purchase heatmap and retention by acquisition month." />;
}
