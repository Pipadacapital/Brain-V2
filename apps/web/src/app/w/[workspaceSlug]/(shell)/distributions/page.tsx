import type { Metadata } from "next";
import { DistributionsContent } from "@/interfaces/components/marketing/distributions-content.js";

export const metadata: Metadata = { title: "Distributions — Brain" };

export default function Page() {
  return <DistributionsContent />;
}
