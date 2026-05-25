import type { Metadata } from "next";
import { PincodeIntelligenceContent } from "@/interfaces/components/logistics/pincode-intelligence-content.js";

export const metadata: Metadata = { title: "Pincode Intelligence — Brain" };

export default function Page() {
  return <PincodeIntelligenceContent />;
}
