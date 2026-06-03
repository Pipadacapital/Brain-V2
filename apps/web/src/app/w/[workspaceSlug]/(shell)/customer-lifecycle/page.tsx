import type { Metadata } from "next";
import { CustomerLifecycleContent } from "@/interfaces/components/lifecycle/customer-lifecycle-content.js";

export const metadata: Metadata = { title: "Customer Lifecycle — Brain" };

export default function Page() {
  return <CustomerLifecycleContent />;
}
