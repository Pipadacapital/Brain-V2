import type { Metadata } from "next";
import { PlatformAdsView, GOOGLE_VENDOR_CONFIG } from "@/interfaces/components/marketing/platform-ads-view.js";

export const metadata: Metadata = { title: "Google Ads — Brain" };

export default function Page() {
  return <PlatformAdsView config={GOOGLE_VENDOR_CONFIG} />;
}
