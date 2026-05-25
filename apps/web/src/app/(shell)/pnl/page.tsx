import type { Metadata } from "next";
import { PnlContent } from "@/interfaces/components/pnl/pnl-content.js";

export const metadata: Metadata = { title: "P&L — Brain" };

export default function Page() {
  return <PnlContent />;
}
