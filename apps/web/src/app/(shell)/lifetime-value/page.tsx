import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Lifetime Value — Brain" };

export default function Page() {
  return <ScaffoldPage title="Lifetime Value" description="LTV curves by acquisition cohort and channel." />;
}
