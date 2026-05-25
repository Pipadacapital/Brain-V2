import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Backfill — Brain" };

export default function Page() {
  return <ScaffoldPage title="Backfill" description="Trigger historical data backfills for connected integrations." />;
}
