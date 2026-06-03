import type { Metadata } from "next";
import { LogisticsContent } from "@/interfaces/components/logistics/logistics-content.js";

export const metadata: Metadata = { title: "Logistics — Brain" };

export default function Page() {
  return <LogisticsContent />;
}
