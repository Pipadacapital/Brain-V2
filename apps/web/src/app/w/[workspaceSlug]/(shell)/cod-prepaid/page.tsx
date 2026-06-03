import type { Metadata } from "next";
import { CodPrepaidContent } from "@/interfaces/components/logistics/cod-prepaid-content.js";

export const metadata: Metadata = { title: "COD vs Prepaid — Brain" };

export default function Page() {
  return <CodPrepaidContent />;
}
