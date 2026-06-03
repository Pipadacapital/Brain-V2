import type { Metadata } from "next";
import { TimingsContent } from "@/interfaces/components/lifecycle/timings-content.js";

export const metadata: Metadata = { title: "Order Timings — Brain" };

export default function Page() {
  return <TimingsContent />;
}
