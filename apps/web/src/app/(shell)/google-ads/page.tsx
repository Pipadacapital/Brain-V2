import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Google Ads — Brain" };

export default function Page() {
  return <ScaffoldPage title="Google Ads" description="Google Search, Shopping, and Performance Max analytics." />;
}
