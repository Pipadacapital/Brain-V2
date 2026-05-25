import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Inventory — Brain" };

export default function Page() {
  return <ScaffoldPage title="Inventory" description="Stock levels, sell-through, and reorder recommendations." />;
}
