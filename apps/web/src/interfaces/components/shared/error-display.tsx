// @paradigm: sql
// ErrorDisplay — surfaces request_id on error for end-to-end traceability.
// CF-SEC-5: request_id propagated from tRPC error response.
// CF-C6-PII-CLIENT-1: only request_id surfaced — no user/order/PII.

interface ErrorDisplayProps {
  title?: string;
  message?: string;
  requestId?: string;
}

export function ErrorDisplay({
  title = 'Something went wrong',
  message = 'Please try again. If the problem persists, contact support.',
  requestId,
}: ErrorDisplayProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md bg-red-50 border border-red-200 p-4"
    >
      <div className="flex">
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800">{title}</h3>
          <p className="mt-1 text-sm text-red-700">{message}</p>
          {requestId && (
            <p className="mt-2 text-xs font-mono text-red-500" aria-label={`Request ID: ${requestId}`}>
              Request ID: {requestId}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
