import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Meta Ads — Brain" };

export default function Page() {
  return <ScaffoldPage title="Meta Ads" description="Facebook and Instagram ad spend, ROAS, and campaign performance." />;
}
