import type { Metadata } from "next";
import { CostsContent } from "@/interfaces/components/settings/costs-content.js";

export const metadata: Metadata = { title: "Costs — Brain" };

export default function Page() {
  return <CostsContent />;
}
