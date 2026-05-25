import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Costs — Brain" };

export default function Page() {
  return <ScaffoldPage title="Costs" description="COGS, logistics, and fixed cost configuration." />;
}
