import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Integrations — Brain" };

export default function Page() {
  return <ScaffoldPage title="Integrations" description="Connect Shopify, Meta, Google, and Shiprocket to Brain." />;
}
