// @paradigm: io
// Slice D — IntegrationsContent tests. Real Connect/Disconnect buttons wired to
// connectors.initiate / connectors.disconnect; per-vendor status from connectors.list.
// Covers: Connect → initiate.mutate → redirect to authUrl; Shopify domain gating;
// Disconnect for a connected vendor; the rendered payload never shows a token.

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
    { vendor: 'SHOPIFY', status: 'NOT_CONNECTED', scopes: [], accountRef: null, tokenExpiresAt: null, lastSyncAt: null, lastSyncError: null, syncPending: false },
    { vendor: 'META', status: 'CONNECTED', scopes: ['ads_read'], accountRef: null, tokenExpiresAt: null, lastSyncAt: null, lastSyncError: null, syncPending: true },
    { vendor: 'GOOGLE', status: 'NOT_CONNECTED', scopes: [], accountRef: null, tokenExpiresAt: null, lastSyncAt: null, lastSyncError: null, syncPending: false },
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
      sync: { useMutation: () => ({ mutate: syncMutate, isPending: false }) },
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
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), search: '' },
    writable: true,
  });
});

describe('IntegrationsContent (Slice D — real Connect/Disconnect)', () => {
  it('renders all three vendors with live status', () => {
    render(<IntegrationsContent />);
    expect(screen.getByText('Shopify')).toBeInTheDocument();
    expect(screen.getByText('Meta Ads')).toBeInTheDocument();
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    // Meta is connected + sync pending (ingestion deferred).
    expect(screen.getByText(/sync pending/i)).toBeInTheDocument();
  });

  it('never renders a token value', () => {
    const { container } = render(<IntegrationsContent />);
    expect(container.innerHTML).not.toMatch(/access_token|refresh_token|shpat_/);
  });

  it('Google Connect → initiate.mutate then redirect to the authUrl', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    // Google is NOT_CONNECTED → has a Connect button (no domain needed).
    const googleRow = screen.getByText('Google Ads').closest('div')!.parentElement!.parentElement!;
    const connectBtn = within(googleRow).getByRole('button', { name: /connect/i });
    await user.click(connectBtn);
    expect(initiateMutate).toHaveBeenCalledWith({ vendor: 'GOOGLE', shopDomain: null });
    // Simulate the mutation success → the component redirects.
    initiateOnSuccess?.({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' });
    expect(window.location.assign).toHaveBeenCalledWith(expect.stringContaining('accounts.google.com'));
  });

  it('Shopify Connect is disabled until a store domain is entered', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Shopify store domain');
    const shopifyRow = input.closest('div')!.parentElement!;
    const connectBtn = within(shopifyRow).getByRole('button', { name: /connect/i });
    expect(connectBtn).toBeDisabled();
    await user.type(input, 'my-store.myshopify.com');
    expect(connectBtn).toBeEnabled();
    await user.click(connectBtn);
    expect(initiateMutate).toHaveBeenCalledWith({ vendor: 'SHOPIFY', shopDomain: 'my-store.myshopify.com' });
  });

  it('Disconnect for the connected Meta vendor calls disconnect.mutate', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const disconnectBtn = screen.getByRole('button', { name: /disconnect/i });
    await user.click(disconnectBtn);
    expect(disconnectMutate).toHaveBeenCalledWith({ vendor: 'META' });
  });

  // Slice E — "Sync now" on a CONNECTED vendor fires connectors.sync.
  it('Sync now on the connected Meta vendor calls sync.mutate', async () => {
    render(<IntegrationsContent />);
    const user = userEvent.setup();
    const syncBtn = screen.getByRole('button', { name: /sync now/i });
    expect(syncBtn).toBeInTheDocument();
    await user.click(syncBtn);
    expect(syncMutate).toHaveBeenCalledWith({ vendor: 'META' });
  });

  it('does not render Sync now for a NOT_CONNECTED vendor', () => {
    render(<IntegrationsContent />);
    // Only the connected Meta vendor has a Sync now button (1 total).
    expect(screen.getAllByRole('button', { name: /sync now/i })).toHaveLength(1);
  });
});
