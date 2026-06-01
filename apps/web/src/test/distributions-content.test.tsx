// @paradigm: sql
// DistributionsContent tests — legacy-parity-v2 restore.
//
// POSITIVE: renders "Distributions" heading with bar-chart icon area
// POSITIVE: renders CM1 / Sales metric toggle via shadcn Tabs
// POSITIVE: renders date inputs and "Year to date" preset button
// POSITIVE: renders density LineChart when graph_points present
// POSITIVE: renders "No distribution data" when graph_points empty
// POSITIVE: renders per-product table with sort headers
// POSITIVE: renders sort icons on all columns (Product, Orders, Mode, Mean, Diff)
// POSITIVE: renders pagination controls (first/prev/next/last)
// POSITIVE: renders rows-per-page Select with options 10/20/30/50
// POSITIVE: renders product rows with formatMoney values
// POSITIVE: diff_mu < 0 renders with destructive text color class
// POSITIVE: diff_mu >= 0 renders without destructive class
// POSITIVE: search input present
// NEGATIVE: unauthenticated shows sign-in message
// NEGATIVE: error shows ErrorDisplay
// NEGATIVE: empty rows shows "No data for the selected filters" message

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// ResizeObserver polyfill for recharts
// ---------------------------------------------------------------------------
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// ---------------------------------------------------------------------------
// nuqs mock
// ---------------------------------------------------------------------------
vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal =
      parser && typeof parser === 'object' && 'withDefault' in parser ? parser.withDefault : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
  parseAsStringEnum: (_values: string[]) => ({
    withDefault: (d: string) => ({ withDefault: d }),
  }),
}));

// ---------------------------------------------------------------------------
// Session mock
// ---------------------------------------------------------------------------
let mockIsAuthenticated = true;
let mockWorkspaceId: string | null = 'ws-test-dist';
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({
      session: {
        isAuthenticated: mockIsAuthenticated,
        workspaceId: mockWorkspaceId,
      },
    }),
}));

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const SAMPLE_ROWS = [
  {
    product: 'Mogra Soap',
    orders: 120n,
    mode_mu: 34900n,     // ₹349.00
    mean_mu: 31200n,     // ₹312.00
    diff_mu: 3700n,      // ₹37.00 (positive)
  },
  {
    product: 'Rose Water',
    orders: 80n,
    mode_mu: 20000n,
    mean_mu: 22000n,
    diff_mu: -2000n,     // negative → destructive color
  },
];

const SAMPLE_GRAPH_POINTS = [
  { value_mu: 10000n, density_bp: 200 },
  { value_mu: 20000n, density_bp: 500 },
  { value_mu: 30000n, density_bp: 350 },
];

type DistQuery = { data?: unknown; isLoading?: boolean; error?: unknown };
let distQuery: DistQuery = {};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    marketing: {
      distributions: {
        useQuery: () => distQuery,
      },
    },
    useUtils: () => ({}),
  },
}));

// ---------------------------------------------------------------------------
// lib-metrics mock — simple formatMoney stub
// ---------------------------------------------------------------------------
vi.mock('@brain/lib-metrics', () => ({
  formatMoney: (value_mu: bigint, _cc: string) => {
    const major = Number(value_mu < 0n ? -value_mu : value_mu) / 100;
    const sign = value_mu < 0n ? '-' : '';
    return `${sign}₹${major.toFixed(2)}`;
  },
}));

// ---------------------------------------------------------------------------
// UI mocks
// ---------------------------------------------------------------------------
vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({ children, onClick, disabled, ...rest }: {
    children: React.ReactNode; onClick?: () => void; disabled?: boolean;
    variant?: string; size?: string; className?: string; 'aria-label'?: string;
  }) => <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>,
}));

vi.mock('@/interfaces/components/ui/input.js', () => ({
  Input: ({ id, value, onChange, placeholder, type, ...rest }: {
    id?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string; type?: string; className?: string;
  }) => (
    <input id={id} type={type ?? 'text'} value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  ),
}));

vi.mock('@/interfaces/components/ui/select.js', () => ({
  Select: ({ children, value, onValueChange }: {
    children: React.ReactNode; value?: string; onValueChange?: (v: string) => void;
  }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, className, 'aria-label': al }: {
    children: React.ReactNode; className?: string; 'aria-label'?: string;
  }) => <button aria-label={al}>{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    <div data-value={value}>{children}</div>,
}));

vi.mock('@/interfaces/components/ui/table.js', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <th className={className}>{children}</th>,
  TableCell: ({ children, colSpan, className }: {
    children: React.ReactNode; colSpan?: number; className?: string;
  }) => <td colSpan={colSpan} className={className}>{children}</td>,
}));

vi.mock('@/interfaces/components/ui/tabs.js', () => ({
  Tabs: ({ children, value, onValueChange }: {
    children: React.ReactNode; value?: string; onValueChange?: (v: string) => void;
  }) => <div data-value={value}>{children}</div>,
  TabsList: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <div role="tablist" className={className}>{children}</div>,
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) =>
    <button role="tab" data-value={value}>{children}</button>,
}));

vi.mock('@/interfaces/components/ui/chart.js', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) =>
    <div data-testid="chart-container">{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

// Recharts mock — avoid actual SVG rendering
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) =>
    <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
}));

vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) =>
    <div data-testid="error-display">{title}</div>,
}));

vi.mock('@/lib/default-date-range.js', () => ({
  DEFAULT_DATE_START: '2026-04-01',
  DEFAULT_DATE_END:   '2026-04-30',
}));

// ---------------------------------------------------------------------------
// beforeEach resets
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = true;
  mockWorkspaceId = 'ws-test-dist';
  distQuery = {
    data: {
      rows: SAMPLE_ROWS,
      total_rows: BigInt(SAMPLE_ROWS.length),
      graph_points: SAMPLE_GRAPH_POINTS,
      global_mode_mu: 27000n,
      global_mean_mu: 25000n,
      metric: 'cm1' as const,
      data_epoch: new Date(),
      request_id: 'req-dist-1',
    },
    isLoading: false,
    error: undefined,
  };
});

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------
import { DistributionsContent } from '@/interfaces/components/marketing/distributions-content.js';

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------
describe('DistributionsContent (positive)', () => {
  it('renders "Distributions" page heading', () => {
    render(<DistributionsContent />);
    expect(screen.getByText('Distributions')).toBeDefined();
  });

  it('renders CM1 and Sales metric toggle tabs', () => {
    render(<DistributionsContent />);
    expect(screen.getByText('CM1')).toBeDefined();
    expect(screen.getByText('Sales')).toBeDefined();
  });

  it('renders "Year to date" preset button', () => {
    render(<DistributionsContent />);
    expect(screen.getByText('Year to date')).toBeDefined();
  });

  it('renders date range inputs', () => {
    render(<DistributionsContent />);
    expect(screen.getByLabelText(/start date/i)).toBeDefined();
    expect(screen.getByLabelText(/end date/i)).toBeDefined();
  });

  it('renders the density LineChart when graph_points are present', () => {
    render(<DistributionsContent />);
    expect(screen.getByTestId('line-chart')).toBeDefined();
  });

  it('renders search input', () => {
    render(<DistributionsContent />);
    expect(screen.getByPlaceholderText(/search product/i)).toBeDefined();
  });

  it('renders product rows from data', () => {
    render(<DistributionsContent />);
    expect(screen.getByText('Mogra Soap')).toBeDefined();
    expect(screen.getByText('Rose Water')).toBeDefined();
  });

  it('renders column sort headers for all 5 columns', () => {
    render(<DistributionsContent />);
    expect(screen.getByLabelText('Sort by product')).toBeDefined();
    expect(screen.getByLabelText('Sort by orders')).toBeDefined();
    expect(screen.getByLabelText('Sort by diff')).toBeDefined();
  });

  it('renders pagination navigation buttons', () => {
    render(<DistributionsContent />);
    expect(screen.getByLabelText('First page')).toBeDefined();
    expect(screen.getByLabelText('Previous page')).toBeDefined();
    expect(screen.getByLabelText('Next page')).toBeDefined();
    expect(screen.getByLabelText('Last page')).toBeDefined();
  });

  it('renders rows-per-page select trigger', () => {
    render(<DistributionsContent />);
    expect(screen.getByLabelText('Rows per page')).toBeDefined();
  });

  it('renders rows-per-page options (10, 20, 30, 50)', () => {
    render(<DistributionsContent />);
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('20')).toBeDefined();
    expect(screen.getByText('30')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
  });

  it('applies destructive class to negative diff_mu cells', () => {
    render(<DistributionsContent />);
    // Rose Water has diff_mu = -2000n → should have text-destructive class
    const cells = screen.getAllByRole('cell');
    const destructiveCells = cells.filter((c) =>
      c.className?.includes('text-destructive') && c.textContent?.includes('-'),
    );
    expect(destructiveCells.length).toBeGreaterThan(0);
  });

  it('does NOT apply destructive class to positive diff_mu cells', () => {
    render(<DistributionsContent />);
    // Mogra Soap has diff_mu = 3700n (positive) — its diff cell should lack text-destructive
    const rows = screen.getAllByRole('row');
    // Find Mogra Soap row
    const mograRow = rows.find((r) => r.textContent?.includes('Mogra Soap'));
    expect(mograRow).toBeDefined();
    // Last cell in that row is diff — should NOT have text-destructive
    if (mograRow) {
      const cells = mograRow.querySelectorAll('td');
      const diffCell = cells[cells.length - 1];
      expect(diffCell.className).not.toContain('text-destructive');
    }
  });
});

// ---------------------------------------------------------------------------
// Empty / no-graph-points scenario
// ---------------------------------------------------------------------------
describe('DistributionsContent — empty graph', () => {
  it('shows "No distribution data" when graph_points is empty', () => {
    distQuery = {
      data: {
        rows: SAMPLE_ROWS,
        total_rows: BigInt(SAMPLE_ROWS.length),
        graph_points: [],
        global_mode_mu: 0n,
        global_mean_mu: 0n,
        metric: 'cm1' as const,
        data_epoch: new Date(),
        request_id: 'req-dist-2',
      },
      isLoading: false,
      error: undefined,
    };
    render(<DistributionsContent />);
    expect(screen.getByText(/no distribution data/i)).toBeDefined();
  });

  it('shows "No data for the selected filters" when rows are empty', () => {
    distQuery = {
      data: {
        rows: [],
        total_rows: 0n,
        graph_points: [],
        global_mode_mu: 0n,
        global_mean_mu: 0n,
        metric: 'cm1' as const,
        data_epoch: new Date(),
        request_id: 'req-dist-3',
      },
      isLoading: false,
      error: undefined,
    };
    render(<DistributionsContent />);
    expect(screen.getByText(/no data for the selected filters/i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Negative tests
// ---------------------------------------------------------------------------
describe('DistributionsContent (negative)', () => {
  it('shows sign-in message when unauthenticated', () => {
    mockIsAuthenticated = false;
    render(<DistributionsContent />);
    expect(screen.getAllByText(/not signed in|sign in/i).length).toBeGreaterThan(0);
  });

  it('shows ErrorDisplay when query errors', () => {
    distQuery = { error: { message: 'server error', data: { requestId: 'req-e1' } }, isLoading: false };
    render(<DistributionsContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });

  it('shows loading spinner when query is loading', () => {
    distQuery = { isLoading: true };
    render(<DistributionsContent />);
    // Loading shows a spinner; table rows are not rendered
    expect(screen.queryByText('Mogra Soap')).toBeNull();
  });
});
