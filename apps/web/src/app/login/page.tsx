// @paradigm: sql
// /login — legacy alias. Canonical login lives at /auth/login (Slice A).
// Server-side redirect so there is ONE login surface.

import { redirect } from 'next/navigation';

export default function LegacyLoginRedirect() {
  redirect('/auth/login');
}
