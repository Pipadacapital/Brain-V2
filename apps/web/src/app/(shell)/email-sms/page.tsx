import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Email & SMS — Brain" };

export default function Page() {
  return <ScaffoldPage title="Email & SMS" description="Campaign performance, revenue attribution, and unsubscribe rates." />;
}
