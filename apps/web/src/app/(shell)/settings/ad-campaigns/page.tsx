import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Ad Campaigns — Brain" };

export default function Page() {
  return <ScaffoldPage title="Ad Campaigns" description="Link ad campaigns to Brain metrics for attribution." />;
}
