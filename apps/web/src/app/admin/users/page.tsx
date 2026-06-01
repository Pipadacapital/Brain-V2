// @paradigm: sql
// /admin/users — cross-tenant user directory. Thin page → client content.

import type { Metadata } from 'next';
import { AdminUsersContent } from '@/interfaces/components/admin/admin-users-content.js';

export const metadata: Metadata = { title: 'All users — Superadmin' };

export default function Page() {
  return <AdminUsersContent />;
}
