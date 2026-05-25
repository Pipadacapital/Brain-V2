import type { Metadata } from "next";
import { CohortsContent } from "@/interfaces/components/cohorts/cohorts-content.js";

export const metadata: Metadata = { title: "Cohorts — Brain" };

export default function Page() {
  return <CohortsContent />;
}
