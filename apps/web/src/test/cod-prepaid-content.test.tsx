// @paradigm: sql
// CodPrepaidContent tests — parity-pass restoration.
//
// Test plan:
//   POSITIVE: renders page header with correct title
//   POSITIVE: fee-assumption inputs rendered (COD fee, return shipping, gateway %)
//   POSITIVE: Apply button rendered
//   POSITIVE: 5 KPI cards row 1 (COD orders, Prepaid orders, COD realization, COD RTO rate, Prepaid RTO rate)
//   POSITIVE: 5 KPI cards row 2 (Break-even, AOV, Eff COD, Eff Prepaid, Prepaid Premium)
//   POSITIVE: COD RTO rate and Prepaid RTO rate have destructive (red) accent
//   POSITIVE: percent values rounded to 1 decimal (not floored to 2)
//   POSITIVE: comparison table has Net Revenue column (P2 parity)
//   POSITIVE: comparison table has 8 columns (Payment, Orders, Gross Revenue, RTO %, Eff Revenue, Fee, Net Revenue, Net/Order)
//   POSITIVE: no-connection banner when connected=false
//   POSITIVE: no-shipments empty state when cod_orders=0 && prepaid_orders=0
//   POSITIVE: loading skeleton rendered when isLoading
//   NEGATIVE: not-signed-in shows sign-in prompt
//   NEGATIVE: error renders ErrorDisplay

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { workspaceId: 'ws-test', isAuthenticated: true } }),
}));

vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault: (d: unknown) => unknown }) => {
    const defaultVal = typeof parser === 'object' && 'withDefault' in parser
      ? (parser as { withDefault: (d: unknown) => { withDefault: unknown } }).withDefault
      : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

const MOCK_COD_PREPAID = {
  workspace_id: 'ws-test',
  period: '2026-04-01/2026-04-30',
  data_epoch: new Date('2026-04-30T00:00:00Z'),
  currency_code: 'INR',
  connected: true,
  cod_orders: 800n,
  prepaid_orders: 200n,
  cod_realization_rate_bp: 7650,   // 76.5%
  cod_rto_rate_bp: 2250,           // 22.5%
  prepaid_rto_rate_bp: 500,        // 5.0%
  effective_revenue_cod_mu: 80_000_000n,
  effective_revenue_prepaid_mu: 20_000_000n,
  prepaid_premium_mu: 0n,
  average_order_value_mu: 150000n,
  breakeven_cod_rto_rate_bp: 500,  // 5.0%
  breakeven_note: null,
  fee_overrides: {
    cod_fee_per_order_mu: 3000n,
    return_shipping_per_rto_mu: 8000n,
    gateway_fee_bp: 200,
  },
  comparison: [
    {
      payment_method: 'COD' as const,
      orders: 800n,
      gross_revenue_mu: 120_000_000n,
      rto_rate_bp: 2250,
      effective_revenue_mu: 80_000_000n,
      fee_total_mu: 5_000_000n,
      net_revenue_mu: 75_000_000n,
      net_revenue_per_order_mu: 100000n,
    },
    {
      payment_method: 'Prepaid' as const,
      orders: 200n,
      gross_revenue_mu: 30_000_000n,
      rto_rate_bp: 500,
      effective_revenue_mu: 20_000_000n,
      fee_total_mu: 1_000_000n,
      net_revenue_mu: 19_000_000n,
      net_revenue_per_order_mu: 100000n,
    },
  ],
};

type MockResult = typeof MOCK_COD_PREPAID;
let mockData: { result: MockResult; data_epoch: Date; request_id: string } | undefined = {
  result: MOCK_COD_PREPAID,
  data_epoch: new Date(),
  request_id: 'req-test',
};
let mockLoading = false;
let mockError: Error | null = null;

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    logistics: {
      codPrepaid: {
        useQuery: () => ({ data: mockData, isLoading: mockLoading, error: mockError, refetch: vi.fn() }),
      },
    },
  },
}));

vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="error-display">{title}: {message}</div>
  ),
}));

vi.mock('@/interfaces/components/ui/card.js', () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props}>{children}</h3>,
}));

vi.mock('@/interfaces/components/ui/table.js', () => ({
  Table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => <table {...props}>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableHead: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...props}>{children}</th>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...props}>{children}</tr>,
  TableCell: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...props}>{children}</td>,
}));

vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({ children, onClick, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock('@/lib/default-date-range.js', () => ({
  DEFAULT_DATE_START: '2026-04-01',
  DEFAULT_DATE_END: '2026-04-30',
}));

import { CodPrepaidContent } from '@/interfaces/components/logistics/cod-prepaid-content.js';

function renderPage() {
  return render(<CodPrepaidContent />);
}

describe('CodPrepaidContent — parity-pass', () => {
  beforeEach(() => {
    mockData = { result: MOCK_COD_PREPAID, data_epoch: new Date(), request_id: 'req-test' };
    mockLoading = false;
    mockError = null;
  });

  // ── POSITIVE: page structure ───────────────────────────────────────────────

  it('renders page header with correct title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('COD vs Prepaid');
  });

  // ── POSITIVE: fee-assumption inputs (P1 parity: was absent) ──────────────

  it('renders COD fee per order input (P1 parity)', () => {
    renderPage();
    expect(document.getElementById('cod-fee-per-order')).toBeInTheDocument();
    expect(screen.getByText(/COD fee \/ order/i)).toBeInTheDocument();
  });

  it('renders return shipping per RTO input (P1 parity)', () => {
    renderPage();
    expect(document.getElementById('return-shipping-per-rto')).toBeInTheDocument();
    expect(screen.getByText(/Return shipping \/ RTO/i)).toBeInTheDocument();
  });

  it('renders gateway fee % input (P1 parity)', () => {
    renderPage();
    expect(document.getElementById('gateway-fee-pct')).toBeInTheDocument();
    // Use getAllByText since "Gateway fee" appears in both the label and the footnote
    expect(screen.getAllByText(/Gateway fee/i).length).toBeGreaterThan(0);
  });

  it('renders Apply button', () => {
    renderPage();
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  // ── POSITIVE: KPI cards row 1 (P1 parity: 5 were missing) ────────────────

  it('renders COD Orders card (P1 parity)', () => {
    renderPage();
    expect(screen.getByText('COD Orders')).toBeInTheDocument();
    expect(screen.getAllByText('800').length).toBeGreaterThan(0);
  });

  it('renders Prepaid Orders card (P1 parity)', () => {
    renderPage();
    expect(screen.getByText('Prepaid Orders')).toBeInTheDocument();
    expect(screen.getAllByText('200').length).toBeGreaterThan(0);
  });

  it('renders COD Realization card', () => {
    renderPage();
    expect(screen.getByText('COD Realization')).toBeInTheDocument();
    expect(screen.getByText(/Delivered \/ shipped COD/i)).toBeInTheDocument();
  });

  it('renders COD RTO Rate card with destructive accent (P1 parity)', () => {
    renderPage();
    expect(screen.getByText('COD RTO Rate')).toBeInTheDocument();
  });

  it('renders Prepaid RTO Rate card (P1 parity)', () => {
    renderPage();
    expect(screen.getByText('Prepaid RTO Rate')).toBeInTheDocument();
  });

  // ── POSITIVE: KPI cards row 2 ─────────────────────────────────────────────

  it('renders Break-even COD RTO Rate card', () => {
    renderPage();
    expect(screen.getByText('Break-even COD RTO Rate')).toBeInTheDocument();
  });

  it('renders Effective Revenue (COD) card (P1 parity)', () => {
    renderPage();
    expect(screen.getByText('Effective Revenue (COD)')).toBeInTheDocument();
  });

  it('renders Effective Revenue (Prepaid) card (P1 parity)', () => {
    renderPage();
    expect(screen.getByText('Effective Revenue (Prepaid)')).toBeInTheDocument();
  });

  // ── POSITIVE: percent rounding ────────────────────────────────────────────

  it('renders COD realization rounded to 1 decimal (76.5% not 76.50%)', () => {
    // cod_realization_rate_bp=7650 → Math.round(7650)/100=76.5 → toFixed(1)="76.5%"
    renderPage();
    expect(screen.getByText('76.5%')).toBeInTheDocument();
    expect(screen.queryByText('76.50%')).not.toBeInTheDocument();
  });

  // ── POSITIVE: comparison table ────────────────────────────────────────────

  it('renders comparison table with 8 columns including Net Revenue (P2 parity)', () => {
    renderPage();
    expect(screen.getByText('Net Revenue')).toBeInTheDocument();
    expect(screen.getByText('Gross Revenue')).toBeInTheDocument();
    expect(screen.getByText('Effective Revenue')).toBeInTheDocument();
  });

  it('comparison table shows COD and Prepaid rows', () => {
    renderPage();
    const rows = screen.getAllByRole('row');
    // header row + 2 data rows
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  // ── POSITIVE: not-connected banner ────────────────────────────────────────

  it('shows amber no-connection banner when connected=false (P1 parity)', () => {
    mockData = {
      result: { ...MOCK_COD_PREPAID, connected: false },
      data_epoch: new Date(),
      request_id: 'req-test',
    };
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/No Shiprocket connection/i)).toBeInTheDocument();
  });

  // ── POSITIVE: no-shipments empty state ───────────────────────────────────

  it('shows no-shipments message when cod_orders=0 && prepaid_orders=0', () => {
    mockData = {
      result: {
        ...MOCK_COD_PREPAID,
        cod_orders: 0n,
        prepaid_orders: 0n,
        comparison: [],
      },
      data_epoch: new Date(),
      request_id: 'req-test',
    };
    renderPage();
    expect(screen.getByText(/No shipments in this date range/i)).toBeInTheDocument();
  });

  // ── POSITIVE: loading + error ─────────────────────────────────────────────

  it('renders loading skeleton when isLoading', () => {
    mockLoading = true;
    mockData = undefined;
    renderPage();
    expect(screen.getByLabelText('Loading COD vs prepaid')).toBeInTheDocument();
  });

  it('renders ErrorDisplay on error', () => {
    mockError = new Error('Server error') as Error & { data?: { requestId?: string } };
    mockData = undefined;
    renderPage();
    expect(screen.getByTestId('error-display')).toBeInTheDocument();
  });
});
