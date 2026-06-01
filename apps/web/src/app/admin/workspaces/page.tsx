// @paradigm: sql
// /admin/workspaces — cross-tenant workspace directory. Thin page → client content.

import type { Metadata } from 'next';
import { AdminWorkspacesContent } from '@/interfaces/components/admin/admin-workspaces-content.js';

export const metadata: Metadata = { title: 'All workspaces — Superadmin' };

export default function Page() {
  return <AdminWorkspacesContent />;
}
