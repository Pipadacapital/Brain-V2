import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Customer Lifecycle — Brain" };

export default function Page() {
  return <ScaffoldPage title="Customer Lifecycle" description="Active, at-risk, lapsed, and reactivated customer segments." />;
}
