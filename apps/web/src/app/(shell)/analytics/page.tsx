import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Store Analytics — Brain" };

export default function Page() {
  return <ScaffoldPage title="Store Analytics" description="Session, conversion, and funnel analytics from your storefront." />;
}
