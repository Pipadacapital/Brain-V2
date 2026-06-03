// @paradigm: sql
// shared-libs-7: tests for PII_REDACT_PATHS completeness.
// Ensures bare top-level PII keys (email, phone, firstName, lastName) are present.
// Previously only nested paths (*.email, customer.email) were in the list, so a
// direct log({ email: '...', phone: '...' }) call would not be redacted.

import { describe, it, expect } from 'vitest';
import { PII_REDACT_PATHS } from './redact-paths.js';

describe('PII_REDACT_PATHS — shared-libs-7: bare top-level PII keys', () => {
  it('contains bare "email" path (direct log({email}) must be redacted)', () => {
    expect(PII_REDACT_PATHS).toContain('email');
  });

  it('contains bare "phone" path', () => {
    expect(PII_REDACT_PATHS).toContain('phone');
  });

  it('contains bare "firstName" path', () => {
    expect(PII_REDACT_PATHS).toContain('firstName');
  });

  it('contains bare "lastName" path', () => {
    expect(PII_REDACT_PATHS).toContain('lastName');
  });

  // Regression: nested paths must still be present
  it('still contains *.email (nested path)', () => {
    expect(PII_REDACT_PATHS).toContain('*.email');
  });

  it('still contains *.phone (nested path)', () => {
    expect(PII_REDACT_PATHS).toContain('*.phone');
  });

  it('still contains *.firstName (nested path)', () => {
    expect(PII_REDACT_PATHS).toContain('*.firstName');
  });

  it('still contains *.lastName (nested path)', () => {
    expect(PII_REDACT_PATHS).toContain('*.lastName');
  });

  it('still contains customer.email', () => {
    expect(PII_REDACT_PATHS).toContain('customer.email');
  });

  it('still contains customer.phone', () => {
    expect(PII_REDACT_PATHS).toContain('customer.phone');
  });

  // Auth token paths must also be present
  it('contains access_token redaction path', () => {
    expect(PII_REDACT_PATHS).toContain('access_token');
  });

  it('contains req.headers.authorization redaction path', () => {
    expect(PII_REDACT_PATHS).toContain('req.headers.authorization');
  });

  // Structural: the list is readonly and non-empty
  it('is a non-empty readonly array', () => {
    expect(PII_REDACT_PATHS.length).toBeGreaterThan(0);
    // Verify it is an array (pino expects string[])
    expect(Array.isArray(PII_REDACT_PATHS)).toBe(true);
    for (const path of PII_REDACT_PATHS) {
      expect(typeof path).toBe('string');
    }
  });
});
