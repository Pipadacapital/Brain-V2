import type { Metadata } from "next";
import { WaterfallContent } from "@/interfaces/components/waterfall/waterfall-content.js";

export const metadata: Metadata = { title: "Waterfall — Brain" };

export default function Page() {
  return <WaterfallContent />;
}
