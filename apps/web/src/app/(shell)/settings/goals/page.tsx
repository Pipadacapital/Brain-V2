import type { Metadata } from "next";
import { ScaffoldPage } from "@/interfaces/components/shell/scaffold-page.js";

export const metadata: Metadata = { title: "Goals — Brain" };

export default function Page() {
  return <ScaffoldPage title="Goals" description="Set revenue, CM, and ROAS targets for RAG scoring." />;
}
