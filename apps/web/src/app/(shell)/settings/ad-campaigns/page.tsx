import type { Metadata } from "next";
import { AdCampaignsContent } from "@/interfaces/components/settings/ad-campaigns-content.js";

export const metadata: Metadata = { title: "Ad Campaigns — Brain" };

export default function Page() {
  return <AdCampaignsContent />;
}
