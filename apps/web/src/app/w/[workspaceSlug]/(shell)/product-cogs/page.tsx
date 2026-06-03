import type { Metadata } from "next";
import { ProductCogsContent } from "@/interfaces/components/product-cogs/product-cogs-content.js";

export const metadata: Metadata = { title: "Product COGS — Brain" };

export default function Page() {
  return <ProductCogsContent />;
}
