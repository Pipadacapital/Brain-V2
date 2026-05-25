import type { Metadata } from "next";
import { FestivalsContent } from "@/interfaces/components/settings/festivals-content.js";

export const metadata: Metadata = { title: "Festivals — Brain" };

export default function Page() {
  return <FestivalsContent />;
}
