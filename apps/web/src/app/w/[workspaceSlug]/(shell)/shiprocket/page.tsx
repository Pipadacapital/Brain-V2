import type { Metadata } from "next";
import { ShiprocketContent } from "@/interfaces/components/logistics/shiprocket-content.js";

export const metadata: Metadata = { title: "Shiprocket — Brain" };

export default function Page() {
  return <ShiprocketContent />;
}
