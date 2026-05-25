import type { Metadata } from "next";
import { FirstProductCascadeContent } from "@/interfaces/components/catalog/first-product-cascade-content.js";

export const metadata: Metadata = { title: "First Product Cascade — Brain" };

export default function Page() {
  return <FirstProductCascadeContent />;
}
