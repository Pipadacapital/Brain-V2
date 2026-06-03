import type { Metadata } from "next";
import { TeamContent } from "@/interfaces/components/workspace/team-content.js";

export const metadata: Metadata = { title: "Team — Brain" };

export default function Page() {
  return <TeamContent />;
}
