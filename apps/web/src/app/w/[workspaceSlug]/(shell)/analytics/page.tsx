import type { Metadata } from "next";
import { AnalyticsContent } from "@/interfaces/components/store/analytics-content.js";

export const metadata: Metadata = { title: "Store Analytics — Brain" };

export default function Page() {
  return <AnalyticsContent />;
}
