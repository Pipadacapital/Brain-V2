import type { Metadata } from "next";
import { LtvContent } from "@/interfaces/components/ltv/ltv-content.js";

export const metadata: Metadata = { title: "Lifetime Value — Brain" };

export default function Page() {
  return <LtvContent />;
}
