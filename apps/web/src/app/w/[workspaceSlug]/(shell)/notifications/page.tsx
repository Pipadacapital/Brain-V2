import type { Metadata } from "next";
import { NotificationsContent } from "@/interfaces/components/notifications/notifications-content.js";

export const metadata: Metadata = { title: "Notifications — Brain" };

export default function Page() {
  return <NotificationsContent />;
}
