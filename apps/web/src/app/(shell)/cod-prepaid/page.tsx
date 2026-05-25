import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "COD vs Prepaid — Brain" };

export default function Page() {
  return <ScaffoldPage title="COD vs Prepaid" description="Payment mode split, RTO risk by COD, and prepaid conversion rate." />;
}
