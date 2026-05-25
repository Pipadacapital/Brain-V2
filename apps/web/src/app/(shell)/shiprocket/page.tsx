import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Shiprocket — Brain" };

export default function Page() {
  return <ScaffoldPage title="Shiprocket" description="Shipment status, courier performance, and dispatch analytics." />;
}
