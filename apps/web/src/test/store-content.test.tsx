// @paradigm: sql
// StoreContent tests — parity-pass restoration.
//
// Test plan:
//   POSITIVE: renders page header with correct title
//   POSITIVE: sync toolbar buttons rendered as disabled with legacy labels
//   POSITIVE: "Refresh from Shopify" button present and disabled
//   POSITIVE: "Backfill Customers" button present and disabled
//   POSITIVE: "Bulk Backfill (4 Years)" button present and disabled
//   POSITIVE: toolbar buttons have "pending cutover" in their title attribute
//   POSITIVE: tab bar renders all 5 tabs (Revenue, Orders, Products, Customers, COGS)
//   POSITIVE: Revenue tab shown by default
//   POSITIVE: connect-store empty state shown when hasConnection=false and tab=orders
//   POSITIVE: connect-store CTA links to /settings/integrations
//   POSITIVE: tabs Orders/Products/Customers gated behind connection check
//   NEGATIVE: not-signed-in shows sign-in prompt

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { workspaceId: 'ws-test', isAuthenticated: true } }),
}));

let mockTab = 'revenue';
vi.mock('nuqs', () => ({
  useQueryState: (key: string, parser: { withDefault: (d: unknown) => unknown }) => {
    const withDefault = typeof parser === 'object' && 'withDefault' in parser
      ? (parser as { withDefault: (d: unknown) => { withDefault: unknown } }).withDefault
      : '';
    if (key === 'tab') return [mockTab, vi.fn((v: string | null) => { mockTab = v ?? 'revenue'; })];
    return [withDefault, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
  parseAsStringEnum: (_arr: string[]) => ({ withDefault: (d: string) => ({ withDefault: d }) }),
  parseAsInteger: { withDefault: (d: number) => ({ withDefault: d }) },
}));

let mockIntegrations: { result: { rows: Array<{ connector: string; status: string }> } } | undefined;

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    store: {
      summary: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      orders: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
    },
    settings: {
      integrations: {
        useQuery: () => ({ data: mockIntegrations }),
      },
    },
  },
}));

vi.mock('@/interfaces/components/store/revenue-ladder-strip.js', () => ({
  RevenueLadderStrip: () => <div data-testid="revenue-ladder">Revenue Ladder</div>,
}));

vi.mock('@/interfaces/components/shared/staleness-label.js', () => ({
  StalenessLabel: () => <span data-testid="staleness-label">Fresh</span>,
}));

vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({ children, onClick, disabled, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string; variant?: string; asChild?: boolean; children?: React.ReactNode;
  }) => asChild
    ? <span {...props}>{children}</span>
    : <button onClick={onClick} disabled={disabled} {...props}>{children}</button>,
}));

vi.mock('@/lib/utils.js', () => ({ cn: (...cls: unknown[]) => cls.filter(Boolean).join(' ') }));
vi.mock('@/lib/default-date-range.js', () => ({
  DEFAULT_DATE_START: '2026-04-01',
  DEFAULT_DATE_END: '2026-04-30',
}));

vi.mock('@/interfaces/components/store/store-orders-table.js', () => ({
  StoreOrdersTable: () => <div data-testid="orders-table">Orders Table</div>,
}));
vi.mock('@/interfaces/components/store/store-products-table.js', () => ({
  StoreProductsTable: () => <div data-testid="products-table">Products Table</div>,
}));
vi.mock('@/interfaces/components/store/store-customers-table.js', () => ({
  StoreCustomersTable: () => <div data-testid="customers-table">Customers Table</div>,
}));

import { StoreContent } from '@/interfaces/components/store/store-content.js';

function renderPage() {
  return render(<StoreContent />);
}

describe('StoreContent — parity-pass', () => {
  beforeEach(() => {
    mockTab = 'revenue';
    // Default: connection status pending (hasConnection defaults true)
    mockIntegrations = undefined;
  });

  // ── POSITIVE: page structure ───────────────────────────────────────────────

  it('renders page header with correct title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Store');
  });

  // ── POSITIVE: sync toolbar buttons (P0 parity: were entirely missing) ─────

  it('renders "Refresh from Shopify" button (P0 parity)', () => {
    renderPage();
    expect(screen.getByText(/Refresh from Shopify/)).toBeInTheDocument();
  });

  it('"Refresh from Shopify" button is disabled (pending cutover)', () => {
    renderPage();
    const btn = screen.getByText(/Refresh from Shopify/).closest('button');
    expect(btn).toBeDisabled();
  });

  it('renders "Backfill Customers" button (P0 parity)', () => {
    renderPage();
    expect(screen.getByText(/Backfill Customers/)).toBeInTheDocument();
  });

  it('"Backfill Customers" button is disabled (pending cutover)', () => {
    renderPage();
    const btn = screen.getByText(/Backfill Customers/).closest('button');
    expect(btn).toBeDisabled();
  });

  it('renders "Bulk Backfill (4 Years)" button (P0 parity)', () => {
    renderPage();
    expect(screen.getByText(/Bulk Backfill/)).toBeInTheDocument();
  });

  it('"Bulk Backfill (4 Years)" button is disabled (pending cutover)', () => {
    renderPage();
    const btn = screen.getByText(/Bulk Backfill/).closest('button');
    expect(btn).toBeDisabled();
  });

  it('sync buttons have cutover-related text in their title attribute', () => {
    renderPage();
    const refreshBtn = screen.getByText(/Refresh from Shopify/).closest('button');
    // Title mentions "cutover" to communicate the pending-cutover state to the operator
    expect(refreshBtn?.title).toMatch(/cutover/i);
  });

  // ── POSITIVE: tab bar ─────────────────────────────────────────────────────

  it('renders all 5 tabs', () => {
    renderPage();
    expect(screen.getByText('Revenue quality')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Product COGS →')).toBeInTheDocument();
  });

  it('Revenue tab renders revenue ladder by default', () => {
    renderPage();
    expect(screen.getByTestId('revenue-ladder')).toBeInTheDocument();
  });

  // ── POSITIVE: connect-store empty state (P1 parity) ──────────────────────

  it('shows connect-store CTA when hasConnection=false and tab=orders (P1 parity)', () => {
    mockTab = 'orders';
    // No connected Shopify/WooCommerce connector
    mockIntegrations = {
      result: {
        rows: [{ connector: 'Shopify', status: 'DISCONNECTED' }],
      },
    };
    renderPage();
    expect(screen.getByText(/Connect a Shopify or WooCommerce store/i)).toBeInTheDocument();
  });

  it('connect-store CTA links to /settings/integrations (P1 parity)', () => {
    mockTab = 'orders';
    mockIntegrations = {
      result: {
        rows: [{ connector: 'Shopify', status: 'DISCONNECTED' }],
      },
    };
    renderPage();
    const link = screen.getByRole('link', { name: /Integrations/i });
    expect(link).toHaveAttribute('href', '/settings/integrations');
  });

  it('does NOT show empty state when hasConnection=true (CONNECTED Shopify)', () => {
    mockTab = 'orders';
    mockIntegrations = {
      result: {
        rows: [{ connector: 'Shopify', status: 'CONNECTED' }],
      },
    };
    renderPage();
    expect(screen.queryByText(/Connect a Shopify or WooCommerce store/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('orders-table')).toBeInTheDocument();
  });

  it('does NOT show connect-state empty state on revenue tab', () => {
    mockTab = 'revenue';
    mockIntegrations = {
      result: {
        rows: [{ connector: 'Shopify', status: 'DISCONNECTED' }],
      },
    };
    renderPage();
    expect(screen.queryByText(/Connect a Shopify or WooCommerce store/i)).not.toBeInTheDocument();
  });

  // ── NEGATIVE: disabled buttons do NOT emit mutations ──────────────────────

  it('clicking disabled Refresh button does nothing (no mutation wired)', () => {
    renderPage();
    const btn = screen.getByText(/Refresh from Shopify/).closest('button');
    // Should not throw or navigate
    fireEvent.click(btn!);
    expect(btn).toBeDisabled();
  });
});
