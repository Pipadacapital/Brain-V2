import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "RTO Analytics — Brain" };

export default function Page() {
  return <ScaffoldPage title="RTO Analytics" description="Return-to-origin analysis by courier, pincode, and product." />;
}
