import type { Metadata } from "next";
import { InventoryContent } from "@/interfaces/components/catalog/inventory-content.js";

export const metadata: Metadata = { title: "Inventory — Brain" };

export default function Page() {
  return <InventoryContent />;
}
