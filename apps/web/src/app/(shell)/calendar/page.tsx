import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Calendar — Brain" };

export default function Page() {
  return <ScaffoldPage title="Calendar" description="Festival, sale, and marketing calendar with impact annotations." />;
}
