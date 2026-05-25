import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Logistics — Brain" };

export default function Page() {
  return <ScaffoldPage title="Logistics" description="End-to-end logistics cost and delivery time breakdowns." />;
}
