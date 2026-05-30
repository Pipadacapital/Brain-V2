import type { Metadata } from "next";
import { PlatformAdsView, META_VENDOR_CONFIG } from "@/interfaces/components/marketing/platform-ads-view.js";

export const metadata: Metadata = { title: "Meta Ads — Brain" };

export default function Page() {
  return <PlatformAdsView config={META_VENDOR_CONFIG} />;
}
