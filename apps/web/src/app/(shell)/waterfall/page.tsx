import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Waterfall — Brain" };

export default function Page() {
  return <ScaffoldPage title="Waterfall" description="Contribution margin waterfall chart — interactive drill-down." />;
}
