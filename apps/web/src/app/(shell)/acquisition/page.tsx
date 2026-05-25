import type { Metadata } from "next";
import { AcquisitionContent } from "@/interfaces/components/marketing/acquisition-content.js";

export const metadata: Metadata = { title: "Acquisition — Brain" };

export default function Page() {
  return <AcquisitionContent />;
}
