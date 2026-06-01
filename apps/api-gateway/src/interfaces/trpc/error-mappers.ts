// @paradigm: sql
// Shared tRPC error mappers (Phase-E router split). Extracted from application/router.ts so the
// per-domain router factories under interfaces/trpc/ can map core-service domain errors to tRPC
// errors. Each mapper NEVER surfaces raw error detail (no PII / no DB internals) — only a generic
// message + the requestId for correlation.

import { TRPCError } from '@trpc/server';
import { OnboardingError } from '@brain/core-onboarding';
import { ConnectorError } from '@brain/core-connectors';
import { SettingsError } from '@brain/core-settings';

/**
 * Map a core-service OnboardingError to a tRPC error (Slice C). Validation/slug issues →
 * BAD_REQUEST; invitation issues → NOT_FOUND/CONFLICT. A non-OnboardingError (e.g. a DB fault)
 * is re-wrapped as INTERNAL_SERVER_ERROR with a GENERIC message.
 */
export function mapOnboardingError(err: unknown, requestId: string): TRPCError {
  if (err instanceof OnboardingError) {
    const codeMap: Record<string, 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND'> = {
      VALIDATION: 'BAD_REQUEST',
      SLUG_INVALID: 'BAD_REQUEST',
      SLUG_TAKEN: 'CONFLICT',
      INVITATION_NOT_FOUND: 'NOT_FOUND',
      INVITATION_NOT_PENDING: 'CONFLICT',
      INVITATION_EXPIRED: 'CONFLICT',
    };
    return new TRPCError({
      code: codeMap[err.code] ?? 'BAD_REQUEST',
      message: `${err.message} request_id=${requestId}`,
    });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Operation failed. request_id=${requestId}`,
  });
}

/**
 * Map a core-service SettingsError to a tRPC error (Wave-3). NOT_FOUND / CONFLICT / VALIDATION
 * map to 4xx; all others are INTERNAL_SERVER_ERROR with a generic message.
 */
export function mapSettingsError(err: unknown, requestId: string): TRPCError {
  if (err instanceof SettingsError) {
    const codeMap: Record<string, 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'FORBIDDEN'> = {
      NOT_FOUND: 'NOT_FOUND',
      CONFLICT: 'CONFLICT',
      VALIDATION: 'BAD_REQUEST',
      FORBIDDEN: 'FORBIDDEN',
    };
    return new TRPCError({
      code: codeMap[err.code] ?? 'BAD_REQUEST',
      message: `${err.message} request_id=${requestId}`,
    });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Settings operation failed. request_id=${requestId}`,
  });
}

/**
 * Map a core-service ConnectorError to a tRPC error (Slice D). Validation/domain issues →
 * BAD_REQUEST/FORBIDDEN; a non-ConnectorError (DB/crypto fault) is wrapped as
 * INTERNAL_SERVER_ERROR with a GENERIC message — no token value can leak through this mapper.
 */
export function mapConnectorError(err: unknown, requestId: string): TRPCError {
  if (err instanceof ConnectorError) {
    const codeMap: Record<string, 'BAD_REQUEST' | 'FORBIDDEN'> = {
      VALIDATION: 'BAD_REQUEST',
      INVALID_SHOP_DOMAIN: 'BAD_REQUEST',
      INVALID_STATE: 'FORBIDDEN',
      HMAC_INVALID: 'FORBIDDEN',
      EXCHANGE_FAILED: 'BAD_REQUEST',
    };
    return new TRPCError({
      code: codeMap[err.code] ?? 'BAD_REQUEST',
      message: `${err.message} request_id=${requestId}`,
    });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Connector operation failed. request_id=${requestId}`,
  });
}
