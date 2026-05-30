// @paradigm: io
// IntegrationsContent tests — Wave-3 parity restoration.
//
// Wave-3 additions: 7-vendor card layout (Shopify/Meta/Google wired,
// Shiprocket/Unicommerce/Klaviyo/WooCommerce honest-disabled "coming soon").
//
// Test plan:
//   POSITIVE: all 3 wired vendor cards render (Shopify, Meta, Google)
//   POSITIVE: all 4 unwired vendor cards render (Shiprocket, Unicommerce, Klaviyo, WooCommerce)
//   POSITIVE: 7 vendor cards total
//   POSITIVE: connected vendors show Disconnect button
//   POSITIVE: connected CONNECTED vendors show Sync now button
//   POSITIVE: not-connected wired vendors show Connect button
//   POSITIVE: unwired vendors show coming-soon disabled state (no Connect button enabled)
//   POSITIVE: Shopify Connect is disabled until a store domain is entered
//   POSITIVE: Connect → initiate.mutate → redirect to authUrl
//   POSITIVE: Disconnect for a connected vendor calls disconnect.mutate
//   POSITIVE: Sync now on a connected vendor calls sync.mutate
//   POSITIVE: never renders a token value
//   NEGATIVE: does not render Sync now for a NOT_CONNECTED vendor

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the session store hook: authenticated with a workspace.
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { workspaceId: 'ws-1', isAuthenticated: true } }),
}));

const { initiateMutate, disconnectMutate, syncMutate, invalidate } = vi.hoisted(() => ({
  initiateMutate: vi.fn(),
  disconnectMutate: vi.fn(),
  syncMutate: vi.fn(),
  invalidate: vi.fn(),
}));
let initiateOnSuccess: ((d: { authUrl: string }) => void) | undefined;

const listData = {
  rows: [
    {
      vendor: 'SHOPIFY',
      status: 'NOT_CONNECTED',
      scopes: [],
      accountRef: null,
      tokenExpiresAt: null,
      lastSyncAt: null,
      lastSyncError: null,
      syncPending: false,
    },
    {
      vendor: 'META',
      status: 'CONNECTED',
      scopes: ['ads_read'],
      accountRef: null,
      tokenExpiresAt: null,
      lastSyncAt: null,
      lastSyncError: null,
      syncPending: true,
    },
    {
      vendor: 'GOOGLE',
      status: 'NOT_CONNECTED',
      scopes: [],
      accountRef: null,
      tokenExpiresAt: null,
      lastSyncAt: null,
      lastSyncError: null,
      syncPending: false,
    },
  ],
  requestId: 'req-1',
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    connectors: {
      list: { useQuery: () => ({ data: listData, isLoading: false, error: null }) },
      initiate: {
        useMutation: (opts: { onSuccess?: (d: { authUrl: string }) => void }) => {
          initiateOnSuccess = opts.onSuccess;
          return { mutate: initiateMutate, isPending: false };
        },
      },
      disconnect: { useMutation: () => ({ mutate: disconnectMutate, isPending: false }) },
      sync: {
        useMutation: (opts?: {
          onSuccess?: (d: {
            vendor: string;
            status: string;
            ordersSynced: number;
            lineItemsSynced: number;
            productsSynced: number;
            adRowsSynced: number;
            error?: string;
          }) => void;
        }) => {
          void opts; // used for onSuccess callback
          return { mutate: syncMutate, isPending: false };
        },
      },
    },
    store: { invalidate },
    pnl: { invalidate },
    metrics: { invalidate },
    marketing: { invalidate },
    useUtils: () => ({
      connectors: { list: { invalidate } },
      store: { invalidate },
      pnl: { invalidate },
      metrics: { invalidate },
      marketing: { invalidate },
    }),
  },
}));

import { IntegrationsContent } from '@/interfaces/components/settings/integrations-content.js';

beforeEach(() => {
  initiateMutate.mockReset();
  disconnectMutate.mockReset();
  syncMutate.mockReset();
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), search: '' },
    writable: true,
  });
});

describe('IntegrationsContent — Wave-3 7-vendor layout', () => {
  // ── 7 vendor cards total ─────────────────────────────────────────────────

  it('renders all 3 wired vendor cards (Shopify, Meta Ads, Google Ads)', () => {
    render(<IntegrationsContent />);
    expect(screen.getByText('Shopify')).toBeInTheDocument();
    expect(screen.getByText('Meta Ads')).toBeInTheDocument();
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
  });

  it('renders all 4 unwired vendor cards (Shiprocket, Unicommerce, Klaviyo, WooCommerce)', () => {
    render(<IntegrationsContent />);
    expect(screen.getByText('Shiprocket')).toBeInTheDocument();
    expect(screen.getByText('Unicommerce')).toBeInTheDocument();
    expect(screen.getByText('Klaviyo')).toBeInTheDocument();
    expect(screen.getByText('WooCommerce')).toBeInTheDocument();
  });

  it('renders 7 vendor cards total', () => {
    const { container } = render(<IntegrationsContent />);
    // Each vendor card has data-testid="vendor-card-*"
    const cards = container.querySelectorAll('[data-testid^="vendor-card-"]');
    expect(cards).toHaveLength(7);
  });

  // ── Connected vendor: connect/disconnect buttons ──────────────────────────

  it('connected META vendor shows Disconnect button', () => {
    render(<IntegrationsContent />);
    const disconnectBtn = screen.getByTestId('disconnect-btn-meta');
    expect(disconnectBtn).toBeInTheDocument();
    expect(disconnectBtn).not.toBeDisabled();
  });

  it('connected META vendor shows Sync now button (status=CONNECTED)', () => {
    render(<IntegrationsContent />);
    const syncBtn = screen.getByTestId('sync-btn-meta');
    expect(syncBtn).toBeInTheDocument();
    expect(syncBtn).not.toBeDisabled();
  });

  it('not-connected SHOPIFY shows Connect button', () => {
    render(<IntegrationsContent />);
    const connectBtn = screen.getByTestId('connect-btn-shopify');
    expect(connectBtn).toBeInTheDocument();
  });

  it('not-connected GOOGLE shows Connect button', () => {
    render(<IntegrationsContent />);
    const connectBtn = screen.getByTestId('connect-btn-google');
    expect(connectBtn).toBeInTheDocument();
  });

  // ── Unwired vendors — honest disabled state ───────────────────────────────

  it('Shiprocket card shows disabled "coming soon" button', () => {
    render(<IntegrationsContent />);
    const btn = screen.getByTestId('coming-soon-btn-shiprocket');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/coming soon/i);
  });

  it('Unicommerce card shows disabled "coming soon" button', () => {
    render(<IntegrationsContent />);
    const btn = screen.getByTestId('coming-soon-btn-unicommerce');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/coming soon/i);
  });

  it('Klaviyo card shows disabled "coming soon" button', () => {
    render(<IntegrationsContent />);
    const btn = screen.getByTestId('coming-soon-btn-klaviyo');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/coming soon/i);
  });

  it('WooCommerce card shows disabled "coming soon" button', () => {
    render(<IntegrationsContent />);
    const btn = screen.getByTestId('coming-soon-btn-woocommerce');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/coming soon/i);
  });

  it('unwired vendor cards have "Not connected" status badge', () => {
    render(<IntegrationsContent />);
    const shiprocketBadge = screen.getByTestId('status-badge-shiprocket');
    expect(shiprocketBadge).toHaveTextContent('Not connected');
    const woocommerceBadge = screen.getByTestId('status-badge-woocommerce');
    expect(woocommerceBadge).toHaveTextContent('Not connected');
  });

  // ── Wired vendor interactions ─────────────────────────────────────────────

  it('Shopify Connect is disabled until a store domain is entered', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Shopify store domain');
    const connectBtn = screen.getByTestId('connect-btn-shopify');
    expect(connectBtn).toBeDisabled();
    await user.type(input, 'my-store.myshopify.com');
    expect(connectBtn).toBeEnabled();
  });

  it('Google Connect → initiate.mutate then redirect to the authUrl', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const connectBtn = screen.getByTestId('connect-btn-google');
    await user.click(connectBtn);
    expect(initiateMutate).toHaveBeenCalledWith({ vendor: 'GOOGLE', shopDomain: null });
    // Simulate the mutation success → the component redirects.
    initiateOnSuccess?.({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' });
    expect(window.location.assign).toHaveBeenCalledWith(
      expect.stringContaining('accounts.google.com'),
    );
  });

  it('Shopify Connect calls initiate.mutate with shopDomain', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Shopify store domain');
    await user.type(input, 'my-store.myshopify.com');
    const connectBtn = screen.getByTestId('connect-btn-shopify');
    await user.click(connectBtn);
    expect(initiateMutate).toHaveBeenCalledWith({
      vendor: 'SHOPIFY',
      shopDomain: 'my-store.myshopify.com',
    });
  });

  it('Disconnect for the connected Meta vendor calls disconnect.mutate', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const disconnectBtn = screen.getByTestId('disconnect-btn-meta');
    await user.click(disconnectBtn);
    expect(disconnectMutate).toHaveBeenCalledWith({ vendor: 'META' });
  });

  it('Sync now on the connected Meta vendor calls sync.mutate', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const syncBtn = screen.getByTestId('sync-btn-meta');
    await user.click(syncBtn);
    expect(syncMutate).toHaveBeenCalledWith({ vendor: 'META' });
  });

  it('does not render Sync now for a NOT_CONNECTED vendor (only 1 sync button)', () => {
    render(<IntegrationsContent />);
    // Only the connected Meta vendor has a Sync now button (1 total wired).
    // Unwired vendors have "coming soon" buttons but not sync buttons.
    const syncBtns = screen.queryAllByTestId(/^sync-btn-/);
    expect(syncBtns).toHaveLength(1);
    expect(syncBtns[0]).toHaveTextContent(/sync now/i);
  });

  // ── Security: no token value ──────────────────────────────────────────────

  it('never renders a token value', () => {
    const { container } = render(<IntegrationsContent />);
    expect(container.innerHTML).not.toMatch(/access_token|refresh_token|shpat_/);
  });

  // ── Header copy ───────────────────────────────────────────────────────────

  it('renders page heading and subtitle with vendor list', () => {
    render(<IntegrationsContent />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Integrations');
    expect(
      screen.getByText(/Connect Shopify, Meta, Google, Shiprocket, and Klaviyo/),
    ).toBeInTheDocument();
  });

  // ── Meta sync pending copy ────────────────────────────────────────────────

  it('connected Meta vendor shows sync pending copy', () => {
    render(<IntegrationsContent />);
    expect(screen.getByText(/sync pending/i)).toBeInTheDocument();
  });
});

// Legacy compatibility — ensure the pre-Wave-3 test scenarios still pass.
describe('IntegrationsContent (Slice D — real Connect/Disconnect) — legacy compat', () => {
  it('renders all three wired vendors with live status', () => {
    render(<IntegrationsContent />);
    expect(screen.getByText('Shopify')).toBeInTheDocument();
    expect(screen.getByText('Meta Ads')).toBeInTheDocument();
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    expect(screen.getByText(/sync pending/i)).toBeInTheDocument();
  });

  it('never renders a token value', () => {
    const { container } = render(<IntegrationsContent />);
    expect(container.innerHTML).not.toMatch(/access_token|refresh_token|shpat_/);
  });

  it('Google Connect → initiate.mutate then redirect to the authUrl', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const connectBtn = screen.getByTestId('connect-btn-google');
    await user.click(connectBtn);
    expect(initiateMutate).toHaveBeenCalledWith({ vendor: 'GOOGLE', shopDomain: null });
    initiateOnSuccess?.({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' });
    expect(window.location.assign).toHaveBeenCalledWith(expect.stringContaining('accounts.google.com'));
  });

  it('Shopify Connect is disabled until a store domain is entered', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Shopify store domain');
    const connectBtn = screen.getByTestId('connect-btn-shopify');
    expect(connectBtn).toBeDisabled();
    await user.type(input, 'my-store.myshopify.com');
    expect(connectBtn).toBeEnabled();
    await user.click(connectBtn);
    expect(initiateMutate).toHaveBeenCalledWith({ vendor: 'SHOPIFY', shopDomain: 'my-store.myshopify.com' });
  });

  it('Disconnect for the connected Meta vendor calls disconnect.mutate', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const disconnectBtn = screen.getByTestId('disconnect-btn-meta');
    await user.click(disconnectBtn);
    expect(disconnectMutate).toHaveBeenCalledWith({ vendor: 'META' });
  });

  it('Sync now on the connected Meta vendor calls sync.mutate', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const syncBtn = screen.getByTestId('sync-btn-meta');
    expect(syncBtn).toBeInTheDocument();
    await user.click(syncBtn);
    expect(syncMutate).toHaveBeenCalledWith({ vendor: 'META' });
  });

  it('does not render Sync now for a NOT_CONNECTED vendor', () => {
    render(<IntegrationsContent />);
    const syncBtns = screen.queryAllByTestId(/^sync-btn-/);
    expect(syncBtns).toHaveLength(1);
  });
});
