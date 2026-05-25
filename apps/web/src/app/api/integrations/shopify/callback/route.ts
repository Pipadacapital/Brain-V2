// @paradigm: io
// Shopify OAuth callback (Slice D) — REGISTER THIS URL in the Shopify Partner
// dashboard (App setup → Allowed redirection URL(s)):
//   http://localhost:3000/api/integrations/shopify/callback
// Shopify returns ?code&state&shop&hmac&host&timestamp; core-service validates the
// state (CSRF) + HMAC (timing-safe) before the per-store token exchange.

import { type NextRequest } from 'next/server';
import { handleConnectorCallback } from '@/infrastructure/connector-callback-handler.js';

export async function GET(request: NextRequest) {
  return handleConnectorCallback(request, 'SHOPIFY');
}
