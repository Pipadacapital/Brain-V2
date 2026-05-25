// @paradigm: sql
// Tests for InvitationAccept (Slice C — token accept flow).
// CF-C6-PII-CLIENT-1: no token logged. Covers accept→/dashboard + generic error.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));
let onSuccessCb: (() => void) | undefined;
let onErrorCb: ((e: { message: string }) => void) | undefined;

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    invitation: {
      accept: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => {
          onSuccessCb = opts.onSuccess;
          onErrorCb = opts.onError;
          return { mutate: mutateMock, isPending: false };
        },
      },
    },
  },
}));

import { InvitationAccept } from '@/interfaces/components/invitation/invitation-accept.js';

beforeEach(() => {
  mutateMock.mockReset();
  onSuccessCb = undefined;
  onErrorCb = undefined;
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn() },
    writable: true,
  });
});

describe('InvitationAccept', () => {
  it('renders the accept button', () => {
    render(<InvitationAccept token="tok-1" />);
    expect(screen.getByRole('button', { name: /accept invitation/i })).toBeInTheDocument();
  });

  it('POSITIVE: clicking accept calls the mutation with the token', async () => {
    render(<InvitationAccept token="tok-abc" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /accept invitation/i }));
    expect(mutateMock).toHaveBeenCalledWith({ token: 'tok-abc' });
  });

  it('on success redirects to /dashboard', async () => {
    render(<InvitationAccept token="tok-1" />);
    onSuccessCb?.();
    await waitFor(() => {
      expect((window.location.assign as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('NEGATIVE: on error shows a generic message with no request_id leaked', async () => {
    render(<InvitationAccept token="tok-1" />);
    onErrorCb?.({ message: 'Invalid invitation link request_id=req-9' });
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/invalid invitation link/i);
      expect(alert).not.toHaveTextContent(/request_id/i);
    });
  });
});
