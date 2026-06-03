import type { Metadata } from "next";
import { AccountContent } from "@/interfaces/components/account/account-content.js";

export const metadata: Metadata = { title: "Account — Brain" };

export default function Page() {
  return <AccountContent />;
}
