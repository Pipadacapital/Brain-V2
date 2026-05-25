import type { Metadata } from "next";
import { GoalsContent } from "@/interfaces/components/settings/goals-content.js";

export const metadata: Metadata = { title: "Goals — Brain" };

export default function Page() {
  return <GoalsContent />;
}
