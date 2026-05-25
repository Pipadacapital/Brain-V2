import type { Metadata } from "next";
import { IntegrationsContent } from "@/interfaces/components/settings/integrations-content.js";

export const metadata: Metadata = { title: "Integrations — Brain" };

export default function Page() {
  return <IntegrationsContent />;
}
