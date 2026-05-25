// @paradigm: sql
// Tests for OnboardingForm (Slice C — multi-step workspace setup).
// CF-C6-PII-CLIENT-1: no PII logged. Covers step nav, slug validation, submit args,
// the deferred "connect store" affordance, and the slice-D affordance being disabled.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the tRPC client's onboarding.complete mutation.
const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));
let onSuccessCb: ((d: { redirectTo: string }) => void) | undefined;
let onErrorCb: ((e: { message: string }) => void) | undefined;

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    onboarding: {
      complete: {
        useMutation: (opts: {
          onSuccess?: (d: { redirectTo: string }) => void;
          onError?: (e: { message: string }) => void;
        }) => {
          onSuccessCb = opts.onSuccess;
          onErrorCb = opts.onError;
          return { mutate: mutateMock, isPending: false };
        },
      },
    },
  },
}));

import { OnboardingForm } from '@/interfaces/components/onboarding/onboarding-form.js';

beforeEach(() => {
  mutateMock.mockReset();
  onSuccessCb = undefined;
  onErrorCb = undefined;
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), origin: 'http://localhost:3000' },
    writable: true,
  });
});

async function fillProfileAndBrand(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/your name/i), 'Owner Name');
  await user.click(screen.getByRole('button', { name: /continue/i }));
  // Brand step
  await user.type(screen.getByLabelText(/brand name/i), 'Brand A');
  // slug auto-derives to 'brand-a'
  await user.click(screen.getByRole('button', { name: /continue/i }));
}

describe('OnboardingForm — multi-step setup', () => {
  it('starts on the profile step', () => {
    render(<OnboardingForm />);
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
  });

  it('NEGATIVE: blocks advancing past profile without a name', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter your name/i);
  });

  it('auto-derives a slug from the brand name', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), 'Owner');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByLabelText(/brand name/i), 'My Cool Brand');
    expect(screen.getByLabelText(/workspace url/i)).toHaveValue('my-cool-brand');
  });

  it('POSITIVE: full flow → onboarding.complete called with the typed args', async () => {
    render(<OnboardingForm defaultFullName="Pre Filled" />);
    const user = userEvent.setup();
    // defaultFullName pre-fills; advance through brand.
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByLabelText(/brand name/i), 'Brand A');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    // Platform step — submit.
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      fullName: 'Pre Filled',
      brandName: 'Brand A',
      slug: 'brand-a',
      platform: 'SHOPIFY',
    });
  });

  it('the live "Connect store" affordance is DISABLED (deferred to slice D)', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByLabelText(/brand name/i), 'Brand A');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const connectBtn = screen.getByRole('button', { name: /connect store — coming in integrations/i });
    expect(connectBtn).toBeDisabled();
  });

  it('on success redirects to the returned path', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    // Trigger the captured onSuccess directly (the mutation is mocked).
    onSuccessCb?.({ redirectTo: '/dashboard' });
    await waitFor(() => {
      expect((window.location.assign as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('on error shows a generic message with no request_id leaked', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    onErrorCb?.({ message: 'This workspace URL is already taken. request_id=req-123' });
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/already taken/i);
      expect(alert).not.toHaveTextContent(/request_id/i);
    });
  });
});
