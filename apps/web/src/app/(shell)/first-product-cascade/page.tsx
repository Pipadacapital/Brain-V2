import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "First Product Cascade — Brain" };

export default function Page() {
  return <ScaffoldPage title="First Product Cascade" description="First-order product mix and its downstream cohort impact." />;
}
