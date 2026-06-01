// @paradigm: sql
// Shared zod input schemas reused across multiple tRPC domain routers (Phase-E split).
// Extracted from the createBrainRouter closure so each per-domain factory under interfaces/trpc/
// can import them instead of relying on closure scope.

import { z } from 'zod';

/** Standard ISO date-range input ({date_start, date_end}) used by the analytics routers. */
export const dateInput = z.object({
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
  date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
});

/** Connector vendor discriminator (Shopify / Meta / Google). */
export const connectorVendor = z.enum(['SHOPIFY', 'META', 'GOOGLE']);
