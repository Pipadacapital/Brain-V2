// @paradigm: sql
// Dashboard / Command Center — Server Component shell.
// Client components (KpiStrip, PnlWaterfallPanel, DrillDrawer) are loaded below.
// CF-C6-AS-OF-STAMP-1: date range defaulted to current month; URL state via nuqs.
// CF-C6-RENDER-ONLY-1: this Server Component has zero arithmetic.

import type { Metadata } from 'next';
import { CommandCenter } from '@/interfaces/components/dashboard/command-center.js';

export const metadata: Metadata = {
  title: 'Command Center — Brain',
};

export default function DashboardPage() {
  return <CommandCenter />;
}
