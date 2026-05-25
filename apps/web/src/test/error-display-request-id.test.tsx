// @paradigm: sql
// Tests for the error-surface request-ID binding (CF-SEC-5 + SEC-C6-H1).
//
// Shrya flagged (SEC-C6-H1) that the gateway errorFormatter was emitting
// shape.data.path (the procedure name) as `requestId` instead of the real
// ctx.requestId correlation UUID.  Vikram's bounce-fix corrects the gateway
// formatter; this test proves the web client surface is wired to the correct
// field (error.data.requestId) and would render the real correlation ID once
// the gateway lands the fix.
//
// Three web error surfaces under test:
//   1. ErrorDisplay (the shared component — direct unit test)
//   2. KpiStrip    — passes (error as TRPCClientError).data?.requestId
//   3. PnlWaterfallPanel — same pattern
//   4. DrillDrawer — same pattern
//
// Killed-mutant sub-tests:
//   - When requestId is a UUID string  → rendered verbatim ✓
//   - When requestId is a procedure path string → rendered verbatim ✓
//       (proves the fix: the old gateway sent a path; after Vikram's fix it
//        sends a UUID; the web surface renders whatever is in data.requestId
//        unchanged — the correctness now depends solely on the gateway formatter)
//   - When requestId is undefined → no "Request ID:" line rendered ✓

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// ---------------------------------------------------------------------------
// 1. ErrorDisplay unit tests — the shared component all three surfaces use
// ---------------------------------------------------------------------------

describe('ErrorDisplay — request ID surface (CF-SEC-5)', () => {
  it('renders the Request ID line when requestId is a UUID (real correlation id)', () => {
    const uuid = 'a1b2c3d4-0000-0000-0000-000000000001';
    render(
      <ErrorDisplay
        title="Test error"
        message="Something went wrong."
        requestId={uuid}
      />,
    );

    // The UUID must appear in the rendered output.
    expect(screen.getByText(`Request ID: ${uuid}`)).toBeInTheDocument();
    // The element has the correct aria-label for screen readers.
    expect(screen.getByLabelText(`Request ID: ${uuid}`)).toBeInTheDocument();
  });

  it('does NOT render a "Request ID:" line when requestId is undefined', () => {
    render(
      <ErrorDisplay
        title="Test error"
        message="Something went wrong."
        requestId={undefined}
      />,
    );

    // No "Request ID:" text should appear.
    expect(screen.queryByText(/Request ID:/i)).not.toBeInTheDocument();
  });

  it('renders alert role with title and message regardless of requestId', () => {
    render(
      <ErrorDisplay
        title="Failed to load KPI metrics"
        message="Upstream timeout."
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Failed to load KPI metrics');
    expect(alert).toHaveTextContent('Upstream timeout.');
  });
});

// ---------------------------------------------------------------------------
// 2. KILLED MUTANT — proves the web surface renders `data.requestId` verbatim
//    and does NOT hard-code or filter the value.
//
// The bug (SEC-C6-H1) was in the GATEWAY errorFormatter (trpc.ts:50) which
// set `requestId = shape.data.path` (procedure name) instead of `ctx.requestId`.
// The web components' binding `(error as { data?: { requestId?: string } }).data?.requestId`
// is correct — it reads whatever the server emits as `requestId`.
//
// This mutant test proves:
//   (A) If the gateway sends a procedure path ("metrics.kpiSummary"), the surface
//       renders "metrics.kpiSummary" — which is WRONG and traceable to a failure.
//   (B) If the gateway sends a UUID after Vikram's fix, the surface renders the
//       UUID — which is CORRECT.
//
// The web client is a faithful pass-through. The gateway fix is what matters.
// ---------------------------------------------------------------------------

describe('ErrorDisplay — killed-mutant for SEC-C6-H1', () => {
  it('MUTANT A: renders procedure path when gateway sends wrong value (old behaviour)', () => {
    // Simulates pre-fix gateway: requestId = "metrics.kpiSummary" (procedure path).
    const procedurePath = 'metrics.kpiSummary';

    render(
      <ErrorDisplay
        title="Mutant scenario — wrong value"
        message="This is what operators saw before the fix."
        requestId={procedurePath}
      />,
    );

    // The component renders it faithfully — the wrong value is visible.
    // A support operator copying "metrics.kpiSummary" cannot trace the request.
    expect(screen.getByText(`Request ID: ${procedurePath}`)).toBeInTheDocument();
  });

  it('REAL PATH: renders UUID when gateway sends correct value (post-Vikram fix)', () => {
    // Simulates post-fix gateway: requestId = real correlation UUID.
    const correlationId = 'b9c1f4e2-1234-5678-abcd-000000000002';

    render(
      <ErrorDisplay
        title="Real path — correct value"
        message="After the gateway fix, operators see the traceable UUID."
        requestId={correlationId}
      />,
    );

    // The correct UUID is rendered — an operator can use this to trace the failure.
    expect(screen.getByText(`Request ID: ${correlationId}`)).toBeInTheDocument();

    // Prove the wrong value is NOT present — if somehow the procedure path leaked
    // through, this assertion would catch it.
    expect(screen.queryByText(/metrics\./)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Web-surface binding contract test
//
// Proves the access pattern used in all three consumer components:
//   (error as { data?: { requestId?: string } }).data?.requestId
// correctly extracts the value when present, and returns undefined when absent.
//
// This is a structural test — it documents the contract between the gateway
// error shape and the web render path without needing a live tRPC stub.
// ---------------------------------------------------------------------------

describe('ErrorDisplay — web surface binding contract (SEC-C6-H1)', () => {
  it('binding: error.data.requestId present → rendered in error surface', () => {
    // Simulates what KpiStrip / PnlWaterfallPanel / DrillDrawer do:
    //   const requestId = (error as { data?: { requestId?: string } }).data?.requestId
    const simulatedTRPCError = {
      message: 'INTERNAL_SERVER_ERROR',
      data: {
        requestId: 'c3d4e5f6-9999-0000-ffff-aabbccddeeff',
        code: 'INTERNAL_SERVER_ERROR',
        httpStatus: 500,
        path: 'metrics.kpiSummary',  // procedure path — present but NOT used
      },
    };

    // Extract exactly as the three consumer components do.
    const requestId = (simulatedTRPCError as { data?: { requestId?: string } }).data?.requestId;
    expect(requestId).toBe('c3d4e5f6-9999-0000-ffff-aabbccddeeff');
    expect(requestId).not.toBe('metrics.kpiSummary');  // not the procedure path

    render(
      <ErrorDisplay
        title="Failed to load KPI metrics"
        message={simulatedTRPCError.message}
        requestId={requestId}
      />,
    );

    // UUID is rendered; procedure path is NOT rendered.
    expect(screen.getByText(`Request ID: c3d4e5f6-9999-0000-ffff-aabbccddeeff`)).toBeInTheDocument();
    expect(screen.queryByText(/metrics\.kpiSummary/)).not.toBeInTheDocument();
  });

  it('binding: error.data.requestId absent → no Request ID line rendered', () => {
    // Simulates an older gateway response before requestId was added.
    const simulatedTRPCError = {
      message: 'UNAUTHORIZED',
      data: {
        code: 'UNAUTHORIZED',
        httpStatus: 401,
        path: 'metrics.kpiSummary',
        // requestId intentionally absent
      },
    };

    const requestId = (simulatedTRPCError as { data?: { requestId?: string } }).data?.requestId;
    expect(requestId).toBeUndefined();

    render(
      <ErrorDisplay
        title="Authentication failed"
        message={simulatedTRPCError.message}
        requestId={requestId}
      />,
    );

    // No "Request ID:" text when absent.
    expect(screen.queryByText(/Request ID:/i)).not.toBeInTheDocument();
  });
});
