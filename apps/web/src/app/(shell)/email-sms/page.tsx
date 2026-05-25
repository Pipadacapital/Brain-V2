import type { Metadata } from "next";
import { EmailSmsContent } from "@/interfaces/components/lifecycle/email-sms-content.js";

export const metadata: Metadata = { title: "Email & SMS — Brain" };

export default function Page() {
  return <EmailSmsContent />;
}
