import type { Metadata } from "next";
import { RtoAnalyticsContent } from "@/interfaces/components/logistics/rto-analytics-content.js";

export const metadata: Metadata = { title: "RTO Analytics — Brain" };

export default function Page() {
  return <RtoAnalyticsContent />;
}
