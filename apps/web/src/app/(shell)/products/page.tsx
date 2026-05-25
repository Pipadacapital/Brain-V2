import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Products — Brain" };

export default function Page() {
  return <ScaffoldPage title="Products" description="Per-SKU profitability, returns, and ad attribution." />;
}
