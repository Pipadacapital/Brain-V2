import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Distributions — Brain" };

export default function Page() {
  return <ScaffoldPage title="Distributions" description="Order value, AOV, and margin distributions." />;
}
