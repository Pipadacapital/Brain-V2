// @paradigm: sql
// Tests for OnboardingForm (Wave 2 parity — 4-step workspace setup).
// Covers: step sequence in order, all fields + validation, canProceed gating,
// completeOnboarding called with the right payload, redirect to /w/{slug}/dashboard,
// isNewWorkspace mode (profile skipped), error display.
// CF-C6-PII-CLIENT-1: no PII logged.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock tRPC
// ---------------------------------------------------------------------------
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

// Mock cn utility (passthrough)
vi.mock('@/lib/utils.js', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock shadcn primitives (passthrough wrappers)
vi.mock('@/components/ui/button.js', () => ({
  Button: ({ children, onClick, disabled, type, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? 'button'} {...rest}>{children}</button>
  ),
}));
vi.mock('@/components/ui/input.js', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@/components/ui/label.js', () => ({
  Label: ({ children, htmlFor }: { children?: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

// Mock tabler icons (no-op SVGs)
vi.mock('@tabler/icons-react', () => ({
  IconUser: () => <span data-testid="icon-user" />,
  IconBuildingStore: () => <span data-testid="icon-store" />,
  IconPlugConnected: () => <span data-testid="icon-plug" />,
  IconArrowRight: () => <span data-testid="icon-right" />,
  IconArrowLeft: () => <span data-testid="icon-left" />,
  IconCheck: () => <span data-testid="icon-check" />,
  IconShoppingCart: () => <span data-testid="icon-cart" />,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance through profile → brand → platform → connect (full 4 steps). */
async function fillProfileStep(user: ReturnType<typeof userEvent.setup>) {
  // Profile: name + role
  await user.clear(screen.getByTestId('input-fullname'));
  await user.type(screen.getByTestId('input-fullname'), 'Test User');
  await user.click(screen.getByTestId('role-founder'));
  await user.click(screen.getByTestId('btn-continue'));
}

async function fillBrandStep(user: ReturnType<typeof userEvent.setup>, name = 'Brand X') {
  await user.type(screen.getByTestId('input-brandname'), name);
  await user.click(screen.getByTestId('btn-continue'));
}

async function selectShopify(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('platform-shopify'));
  await user.click(screen.getByTestId('btn-continue'));
}

async function selectWooCommerce(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('platform-woocommerce'));
  await user.click(screen.getByTestId('btn-continue'));
}

// ---------------------------------------------------------------------------
// Step rendering order
// ---------------------------------------------------------------------------

describe('OnboardingForm — step sequence', () => {
  it('starts on the profile step', () => {
    render(<OnboardingForm />);
    expect(screen.getByTestId('step-profile')).toBeInTheDocument();
  });

  it('advances to brand step after completing profile', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    expect(screen.getByTestId('step-brand')).toBeInTheDocument();
  });

  it('advances to platform step after completing brand', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await fillBrandStep(user);
    expect(screen.getByTestId('step-platform')).toBeInTheDocument();
  });

  it('advances to connect-shopify step after selecting Shopify', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await fillBrandStep(user);
    await selectShopify(user);
    expect(screen.getByTestId('step-connect-shopify')).toBeInTheDocument();
  });

  it('advances to connect-woo step after selecting WooCommerce', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await fillBrandStep(user);
    await selectWooCommerce(user);
    expect(screen.getByTestId('step-connect-woo')).toBeInTheDocument();
  });

  it('can navigate back from brand to profile', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await user.click(screen.getByTestId('btn-back'));
    expect(screen.getByTestId('step-profile')).toBeInTheDocument();
  });

  it('step rail renders 4 step indicators', () => {
    render(<OnboardingForm />);
    const list = screen.getByRole('list', { name: /onboarding steps/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Validation — NEGATIVE paths
// ---------------------------------------------------------------------------

describe('OnboardingForm — validation (negative)', () => {
  it('blocks advancing past profile when name is empty', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    // Click role but leave name empty
    await user.click(screen.getByTestId('role-founder'));
    // Continue button disabled — canProceed=false; also check directly via aria
    const btn = screen.getByTestId('btn-continue');
    expect(btn).toBeDisabled();
    // Still on profile
    expect(screen.getByTestId('step-profile')).toBeInTheDocument();
  });

  it('blocks advancing past profile when role is not selected', async () => {
    render(<OnboardingForm defaultFullName="Jane" />);
    const user = userEvent.setup();
    const btn = screen.getByTestId('btn-continue');
    // Name pre-filled but no role → disabled
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('step-profile')).toBeInTheDocument();
    // Select a role → button should become enabled
    await user.click(screen.getByTestId('role-marketing'));
    expect(btn).not.toBeDisabled();
  });

  it('blocks advancing past brand when brand name is empty', async () => {
    render(<OnboardingForm defaultFullName="Jane" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('role-founder'));
    await user.click(screen.getByTestId('btn-continue'));
    // On brand step — no name entered
    expect(screen.getByTestId('btn-continue')).toBeDisabled();
  });

  it('blocks advancing past platform when no platform is selected', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await fillBrandStep(user);
    // On platform step — no platform selected; default is '' so button disabled
    expect(screen.getByTestId('btn-continue')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Validation — POSITIVE paths
// ---------------------------------------------------------------------------

describe('OnboardingForm — validation (positive)', () => {
  it('enables Continue on profile once name + role are both set', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-fullname'), 'Jane');
    await user.click(screen.getByTestId('role-analyst'));
    expect(screen.getByTestId('btn-continue')).not.toBeDisabled();
  });

  it('auto-derives a slug from the brand name', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await user.type(screen.getByTestId('input-brandname'), 'My Cool Brand');
    expect(screen.getByTestId('input-slug')).toHaveValue('my-cool-brand');
  });

  it('slug tracks brand name until manually edited', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await user.type(screen.getByTestId('input-brandname'), 'Acme');
    expect(screen.getByTestId('input-slug')).toHaveValue('acme');
    // Manually edit slug
    const slugInput = screen.getByTestId('input-slug');
    await user.clear(slugInput);
    await user.type(slugInput, 'my-custom-slug');
    // Changing brand name should NOT override manual slug
    await user.clear(screen.getByTestId('input-brandname'));
    await user.type(screen.getByTestId('input-brandname'), 'Different Brand');
    expect(screen.getByTestId('input-slug')).toHaveValue('my-custom-slug');
  });

  it('industry pill toggles selection on click', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await user.type(screen.getByTestId('input-brandname'), 'Brand');
    const pill = screen.getByTestId('industry-fashion-&-apparel');
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    await user.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    // Second click deselects
    await user.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'false');
  });

  it('revenue range button toggles selection on click', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await fillProfileStep(user);
    await user.type(screen.getByTestId('input-brandname'), 'Brand');
    const btn = screen.getByTestId('revenue-pre-revenue');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// Submit — payload correctness
// ---------------------------------------------------------------------------

describe('OnboardingForm — submit payload', () => {
  it('calls onboarding.complete with full Shopify payload', async () => {
    render(<OnboardingForm defaultFullName="Pre Filled" email="owner@brand.com" />);
    const user = userEvent.setup();

    // Profile: name is pre-filled; pick a role
    await user.click(screen.getByTestId('role-founder'));
    await user.click(screen.getByTestId('btn-continue'));

    // Brand
    await user.type(screen.getByTestId('input-brandname'), 'Brand A');
    await user.click(screen.getByTestId('industry-beauty-&-cosmetics'));
    await user.click(screen.getByTestId('revenue-10l-50l'));
    await user.click(screen.getByTestId('btn-continue'));

    // Platform: Shopify
    await user.click(screen.getByTestId('platform-shopify'));
    await user.click(screen.getByTestId('btn-continue'));

    // Connect: enter handle
    await user.type(screen.getByTestId('input-store-handle'), 'brand-a-store');
    await user.click(screen.getByTestId('btn-launch-shopify'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      fullName: 'Pre Filled',
      jobRole: 'founder',
      brandName: 'Brand A',
      slug: 'brand-a',
      industry: 'Beauty & Cosmetics',
      monthlyRevenue: '10l-50l',
      platform: 'SHOPIFY',
      storeHandle: 'brand-a-store',
    });
  });

  it('calls onboarding.complete with WooCommerce payload via Connect & launch', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('role-marketing'));
    await user.click(screen.getByTestId('btn-continue'));
    await user.type(screen.getByTestId('input-brandname'), 'Woo Brand');
    await user.click(screen.getByTestId('btn-continue'));
    await user.click(screen.getByTestId('platform-woocommerce'));
    await user.click(screen.getByTestId('btn-continue'));

    // Fill all Woo credentials
    await user.type(screen.getByTestId('input-wc-url'), 'https://mybrand.com');
    await user.type(screen.getByTestId('input-wc-key'), 'ck_abc');
    await user.type(screen.getByTestId('input-wc-secret'), 'cs_xyz');

    // "Connect & launch" should now be enabled
    const connectBtn = screen.getByTestId('btn-connect-woo');
    expect(connectBtn).not.toBeDisabled();
    await user.click(connectBtn);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      platform: 'WOOCOMMERCE',
      storeHandle: 'https://mybrand.com',
    });
  });

  it('WooCommerce "Connect & launch" is disabled when credentials are incomplete', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('role-marketing'));
    await user.click(screen.getByTestId('btn-continue'));
    await user.type(screen.getByTestId('input-brandname'), 'Woo Brand');
    await user.click(screen.getByTestId('btn-continue'));
    await user.click(screen.getByTestId('platform-woocommerce'));
    await user.click(screen.getByTestId('btn-continue'));

    // Only fill URL, leave key/secret empty
    await user.type(screen.getByTestId('input-wc-url'), 'https://mybrand.com');
    expect(screen.getByTestId('btn-connect-woo')).toBeDisabled();
  });

  it('WooCommerce "Skip for now" is always enabled (honest skip affordance)', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('role-developer'));
    await user.click(screen.getByTestId('btn-continue'));
    await user.type(screen.getByTestId('input-brandname'), 'Woo Brand 2');
    await user.click(screen.getByTestId('btn-continue'));
    await user.click(screen.getByTestId('platform-woocommerce'));
    await user.click(screen.getByTestId('btn-continue'));

    expect(screen.getByTestId('btn-skip-woo')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Redirect behaviour
// ---------------------------------------------------------------------------

describe('OnboardingForm — redirect', () => {
  it('navigates to the workspace-scoped dashboard on success', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    onSuccessCb?.({ redirectTo: '/w/my-brand/dashboard' });
    await waitFor(() => {
      expect((window.location.assign as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        '/w/my-brand/dashboard',
      );
    });
  });

  it('falls back to /dashboard if redirectTo is absent', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    // Simulate onSuccess with no redirectTo (type cast to test fallback)
    onSuccessCb?.({ redirectTo: '' });
    await waitFor(() => {
      expect((window.location.assign as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('/dashboard');
    });
  });
});

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

describe('OnboardingForm — error display', () => {
  it('shows the server error message', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    onErrorCb?.({ message: 'This workspace URL is already taken.' });
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-error')).toHaveTextContent(/already taken/i);
    });
  });

  it('strips request_id from the error message (no internal detail leaked)', async () => {
    render(<OnboardingForm defaultFullName="Owner" />);
    onErrorCb?.({ message: 'This workspace URL is already taken. request_id=req-123' });
    await waitFor(() => {
      const alert = screen.getByTestId('onboarding-error');
      expect(alert).toHaveTextContent(/already taken/i);
      expect(alert).not.toHaveTextContent(/request_id/i);
    });
  });
});

// ---------------------------------------------------------------------------
// isNewWorkspace mode
// ---------------------------------------------------------------------------

describe('OnboardingForm — isNewWorkspace mode', () => {
  it('starts on the brand step (profile skipped) when isNewWorkspace=true', () => {
    render(<OnboardingForm isNewWorkspace={true} />);
    expect(screen.getByTestId('step-brand')).toBeInTheDocument();
    expect(screen.queryByTestId('step-profile')).not.toBeInTheDocument();
  });

  it('shows only 3 step indicators when isNewWorkspace=true', () => {
    render(<OnboardingForm isNewWorkspace={true} />);
    const list = screen.getByRole('list', { name: /onboarding steps/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('submits with empty fullName when isNewWorkspace=true', async () => {
    render(<OnboardingForm isNewWorkspace={true} defaultFullName="" />);
    const user = userEvent.setup();

    // Start on brand
    await user.type(screen.getByTestId('input-brandname'), 'New WS Brand');
    await user.click(screen.getByTestId('btn-continue'));
    // Platform
    await user.click(screen.getByTestId('platform-shopify'));
    await user.click(screen.getByTestId('btn-continue'));
    // Connect
    await user.click(screen.getByTestId('btn-launch-shopify'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      brandName: 'New WS Brand',
      platform: 'SHOPIFY',
    });
  });
});
