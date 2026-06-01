// @paradigm: sql
// /admin/sync — cross-tenant connection directory + sync console. Thin page → content.

import type { Metadata } from 'next';
import { AdminSyncContent } from '@/interfaces/components/admin/admin-sync-content.js';

export const metadata: Metadata = { title: 'Connections & sync — Superadmin' };

export default function Page() {
  return <AdminSyncContent />;
}
