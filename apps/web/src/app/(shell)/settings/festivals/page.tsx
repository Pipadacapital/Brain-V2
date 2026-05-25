import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Festivals — Brain" };

export default function Page() {
  return <ScaffoldPage title="Festivals" description="Configure Indian festival calendar and impact periods." />;
}
