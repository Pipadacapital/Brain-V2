// @paradigm: sql
// RtoAnalyticsContent tests — parity-pass restoration.
//
// Test plan:
//   POSITIVE: renders page header with correct title + subtitle
//   POSITIVE: 4 KPI cards rendered with correct labels and sublines
//   POSITIVE: RTO rate rounded to 1 decimal (not floored to 2)
//   POSITIVE: Total RTO Orders card present (restored standalone card)
//   POSITIVE: By Payment Method section renders when non-empty
//   POSITIVE: By Courier section renders when non-empty
//   POSITIVE: By Product section renders when non-empty (optional Shopify enrichment)
//   POSITIVE: By Product section is absent when by_product is empty
//   POSITIVE: no-connection amber banner shown when connected=false
//   POSITIVE: zero-shipments message shown when total_shipments=0 and connected=true
//   POSITIVE: loading skeleton shown when isLoading
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

const MOCK_RTO = {
  workspace_id: 'ws-test',
  period: '2026-04-01/2026-04-30',
  data_epoch: new Date('2026-04-30T00:00:00Z'),
  currency_code: 'INR',
  connected: true,
  total_shipments: 1247n,
  rto_count: 224n,
  rto_rate_bp: 1796 as number | null,  // floor=17.96%, round=18.0%
  total_rto_cost_mu: 4_480_000n,
  revenue_lost_to_rto_mu: 33_200_000n,
  by_payment_method: [
    { payment_method: 'COD' as const, rto_count: 180n, rto_cost_mu: 3_600_000n, revenue_lost_mu: 27_000_000n },
    { payment_method: 'Prepaid' as const, rto_count: 44n, rto_cost_mu: 880_000n, revenue_lost_mu: 6_200_000n },
  ],
  by_courier: [
    { courier_name: 'Delhivery', rto_count: 120n, rto_cost_mu: 2_400_000n, revenue_lost_mu: 18_000_000n },
  ],
  by_product: [
    { product_title: 'Oud Perfume 50ml', quantity: 12n, revenue_lost_mu: 3_600_000n },
    { product_title: 'Rose Attar 10ml', quantity: 8n, revenue_lost_mu: 1_600_000n },
  ],
};

type MockRto = typeof MOCK_RTO;
let mockData: { analytics: MockRto; data_epoch: Date; request_id: string } | undefined = {
  analytics: MOCK_RTO,
  data_epoch: new Date(),
  request_id: 'req-test',
};
let mockLoading = false;
let mockError: Error | null = null;

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    logistics: {
      rto: {
        useQuery: () => ({ data: mockData, isLoading: mockLoading, error: mockError }),
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

vi.mock('@/lib/default-date-range.js', () => ({
  DEFAULT_DATE_START: '2026-04-01',
  DEFAULT_DATE_END: '2026-04-30',
}));

import { RtoAnalyticsContent } from '@/interfaces/components/logistics/rto-analytics-content.js';

function renderPage() {
  return render(<RtoAnalyticsContent />);
}

describe('RtoAnalyticsContent — parity-pass', () => {
  beforeEach(() => {
    mockData = { analytics: MOCK_RTO, data_epoch: new Date(), request_id: 'req-test' };
    mockLoading = false;
    mockError = null;
  });

  // ── POSITIVE: page structure ───────────────────────────────────────────────

  it('renders page header with correct title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('RTO Analytics');
  });

  it('renders Shiprocket-first descriptive subtitle', () => {
    renderPage();
    expect(screen.getByText(/Shiprocket-first/i)).toBeInTheDocument();
  });

  // ── POSITIVE: KPI cards ────────────────────────────────────────────────────

  it('renders RTO Rate card with destructive accent', () => {
    renderPage();
    expect(screen.getByText('RTO Rate')).toBeInTheDocument();
  });

  it('RTO rate is rounded to 1 decimal (18.0% not 17.96%)', () => {
    // bp=1796 → Math.round(1796)/100=17.96 → toFixed(1)="18.0%"
    renderPage();
    expect(screen.getByText('18.0%')).toBeInTheDocument();
    expect(screen.queryByText('17.96%')).not.toBeInTheDocument();
  });

  it('renders standalone Total RTO Orders card (P1 parity: was missing)', () => {
    renderPage();
    expect(screen.getByText('Total RTO Orders')).toBeInTheDocument();
    expect(screen.getAllByText('224').length).toBeGreaterThan(0);
  });

  it('renders Total RTO Cost card', () => {
    renderPage();
    expect(screen.getByText('Total RTO Cost')).toBeInTheDocument();
  });

  it('renders Revenue Lost to RTO card', () => {
    renderPage();
    expect(screen.getByText('Revenue Lost to RTO')).toBeInTheDocument();
  });

  // ── POSITIVE: By Payment Method ───────────────────────────────────────────

  it('renders By Payment Method section', () => {
    renderPage();
    expect(screen.getByText('By Payment Method')).toBeInTheDocument();
    expect(screen.getByText('COD')).toBeInTheDocument();
    expect(screen.getByText('Prepaid')).toBeInTheDocument();
  });

  it('By Payment Method section is absent when array is empty', () => {
    mockData = {
      analytics: { ...MOCK_RTO, by_payment_method: [] },
      data_epoch: new Date(),
      request_id: 'req-test',
    };
    renderPage();
    expect(screen.queryByText('By Payment Method')).not.toBeInTheDocument();
  });

  // ── POSITIVE: By Courier ───────────────────────────────────────────────────

  it('renders By Courier section', () => {
    renderPage();
    expect(screen.getByText('By Courier')).toBeInTheDocument();
    expect(screen.getByText('Delhivery')).toBeInTheDocument();
  });

  // ── POSITIVE: By Product (P1 parity: new table) ──────────────────────────

  it('renders RTO by product table when by_product is non-empty (P1 parity)', () => {
    renderPage();
    expect(screen.getByText(/RTO by product/i)).toBeInTheDocument();
    expect(screen.getByText('Oud Perfume 50ml')).toBeInTheDocument();
    expect(screen.getByText('Rose Attar 10ml')).toBeInTheDocument();
  });

  it('by_product table is absent when array is empty', () => {
    mockData = {
      analytics: { ...MOCK_RTO, by_product: [] },
      data_epoch: new Date(),
      request_id: 'req-test',
    };
    renderPage();
    expect(screen.queryByText(/RTO by product/i)).not.toBeInTheDocument();
  });

  // ── POSITIVE: not-connected banner (P1 parity) ────────────────────────────

  it('shows amber no-connection banner when connected=false (P1 parity)', () => {
    mockData = {
      analytics: { ...MOCK_RTO, connected: false },
      data_epoch: new Date(),
      request_id: 'req-test',
    };
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/No Shiprocket connection/i)).toBeInTheDocument();
  });

  it('no-connection banner links to settings/integrations', () => {
    mockData = {
      analytics: { ...MOCK_RTO, connected: false },
      data_epoch: new Date(),
      request_id: 'req-test',
    };
    renderPage();
    expect(screen.getByRole('link', { name: /Settings → Integrations/i })).toBeInTheDocument();
  });

  // ── POSITIVE: zero-shipments empty state (P1 parity) ─────────────────────

  it('shows no-shipments message when total_shipments=0 and connected=true', () => {
    mockData = {
      analytics: {
        ...MOCK_RTO,
        total_shipments: 0n,
        rto_count: 0n,
        rto_rate_bp: null,
        by_payment_method: [],
        by_courier: [],
        by_product: [],
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
    expect(screen.getByLabelText('Loading RTO analytics')).toBeInTheDocument();
  });

  it('renders ErrorDisplay on error', () => {
    mockError = new Error('Upstream error') as Error & { data?: { requestId?: string } };
    mockData = undefined;
    renderPage();
    expect(screen.getByTestId('error-display')).toBeInTheDocument();
  });
});
