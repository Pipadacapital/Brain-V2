import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Timing — Brain" };

export default function Page() {
  return <ScaffoldPage title="Timing" description="Order and purchase timing analysis by hour, day, and week." />;
}
