import type { Metadata } from "next";
import { ProductsContent } from "@/interfaces/components/catalog/products-content.js";

export const metadata: Metadata = { title: "Products — Brain" };

export default function Page() {
  return <ProductsContent />;
}
