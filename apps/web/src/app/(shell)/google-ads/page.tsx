import type { Metadata } from "next";
import { PlatformAdsView } from "@/interfaces/components/marketing/platform-ads-view.js";

export const metadata: Metadata = { title: "Google Ads — Brain" };

export default function Page() {
  return <PlatformAdsView platform="google" />;
}
