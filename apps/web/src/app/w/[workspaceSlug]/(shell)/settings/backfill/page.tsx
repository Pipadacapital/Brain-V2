import type { Metadata } from "next";
import { BackfillContent } from "@/interfaces/components/settings/backfill-content.js";

export const metadata: Metadata = { title: "Backfill — Brain" };

export default function Page() {
  return <BackfillContent />;
}
