// @paradigm: sql
// Store page — Server Component shell. The (shell) layout provides sidebar+header.
// CF-C6-RENDER-ONLY-1: zero arithmetic — all values from the tRPC BFF.
// Phase-2 slice-1 (feat-store-order-fact-layer): real, data-backed revenue ladder.

import type { Metadata } from "next";
import { StoreContent } from "@/interfaces/components/store/store-content.js";

export const metadata: Metadata = { title: "Store — Brain" };

export default function Page() {
  return <StoreContent />;
}
