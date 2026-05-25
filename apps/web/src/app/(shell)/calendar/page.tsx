import type { Metadata } from "next";
import { CalendarContent } from "@/interfaces/components/settings/calendar-content.js";

export const metadata: Metadata = { title: "Calendar — Brain" };

export default function Page() {
  return <CalendarContent />;
}
