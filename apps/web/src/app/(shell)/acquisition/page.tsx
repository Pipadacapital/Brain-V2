import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Acquisition — Brain" };

export default function Page() {
  return <ScaffoldPage title="Acquisition" description="New customer acquisition costs and channel attribution." />;
}
