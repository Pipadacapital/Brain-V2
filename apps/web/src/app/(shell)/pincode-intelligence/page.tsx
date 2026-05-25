import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Pincode Intelligence — Brain" };

export default function Page() {
  return <ScaffoldPage title="Pincode Intelligence" description="Delivery success rates and RTO risk scores by pincode." />;
}
