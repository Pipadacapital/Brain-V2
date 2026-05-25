import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "P&L — Brain" };

export default function Page() {
  return <ScaffoldPage title="P&L" description="Full profit and loss statement with CM1 through CM4 breakdown." />;
}
