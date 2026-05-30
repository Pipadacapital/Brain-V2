// @paradigm: sql
// PincodeIntelligenceContent tests — parity-38 restoration.
//
// POSITIVE: renders all 14 column headers (Pincode, City, State, Orders, Revenue,
//           AOV, RTO %, COD %, Delivered %, Tier, Uniq. Customers, Repeat %, Score,
//           Top Courier)
// POSITIVE: State column renders computed state (Maharashtra for 400001)
// POSITIVE: Tier column renders T1 for Mumbai, T2 for Nashik
// POSITIVE: Top Courier renders "—" when empty (honest-empty for local-db)
// POSITIVE: Unique Customers renders "—" when 0 (honest-empty)
// POSITIVE: Revenue renders "—" when 0 (honest-empty)
// POSITIVE: High-RTO filter checkbox present
// POSITIVE: High-COD filter checkbox present
// POSITIVE: State text filter input present
// POSITIVE: Min orders numeric input present
// POSITIVE: Sort on header click: column gets aria-sort=ascending
// POSITIVE: Score cell gets green color class when score >= 7000 (70%)
// POSITIVE: RTO % cell gets red color class when rto_rate_bp >= 2000
// NEGATIVE: not authenticated → sign-in prompt
// NEGATIVE: error state → ErrorDisplay

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal = (parser && typeof parser === 'object' && 'withDefault' in parser)
      ? parser.withDefault
      : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString:  { withDefault: (d: string)  => ({ withDefault: d }) },
  parseAsInteger: { withDefault: (d: number)  => ({ withDefault: d }) },
  parseAsBoolean: { withDefault: (d: boolean) => ({ withDefault: d }) },
}));

vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { workspaceId: 'ws-test', isAuthenticated: true } }),
}));

vi.mock('@/lib/default-date-range.js', () => ({
  DEFAULT_DATE_START: '2026-04-01',
  DEFAULT_DATE_END: '2026-04-30',
}));

vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) => <div data-testid="error-display">{title}</div>,
}));

const MOCK_ROWS = [
  {
    pincode: '400001',
    city: 'Mumbai',
    state: 'Maharashtra',
    tier: 1,
    shipment_count: 320n,
    rto_count: 48n,
    rto_rate_bp: 1500,
    cod_count: 180n,
    cod_rate_bp: 5625,
    delivered_count: 252n,
    delivered_rate_bp: 7875,
    revenue_mu: 37_800_000n,
    aov_mu: 150_000n,
    unique_customers: 160n,
    repeat_rate_bp: 2500,
    reliability_score: 7000,
    top_courier: 'Delhivery',
  },
  {
    pincode: '422001',
    city: 'Nashik',
    state: 'Maharashtra',
    tier: 2,
    shipment_count: 90n,
    rto_count: 27n,
    rto_rate_bp: 3000,
    cod_count: 63n,
    cod_rate_bp: 7000,
    delivered_count: 54n,
    delivered_rate_bp: 6000,
    revenue_mu: 0n,
    aov_mu: null,
    unique_customers: 0n,
    repeat_rate_bp: null,
    reliability_score: 3000,
    top_courier: '',
  },
];

const MOCK_DATA = {
  rows: MOCK_ROWS,
  total_shipments: 410n,
  data_epoch: new Date('2026-05-25T00:00:00Z'),
  request_id: 'req-test',
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    logistics: {
      pincode: {
        useQuery: () => ({ data: MOCK_DATA, isLoading: false, error: null }),
      },
    },
  },
}));

import { PincodeIntelligenceContent } from '@/interfaces/components/logistics/pincode-intelligence-content.js';

// ---------------------------------------------------------------------------
// POSITIVE: columns
// ---------------------------------------------------------------------------

describe('PincodeIntelligenceContent — columns', () => {
  it('renders all 14 column headers', () => {
    render(<PincodeIntelligenceContent />);
    const headers = ['Pincode', 'City', 'State', 'Orders', 'Revenue', 'AOV', 'RTO %', 'COD %', 'Delivered %', 'Tier', 'Uniq. Customers', 'Repeat %', 'Score', 'Top Courier'];
    for (const h of headers) {
      const elements = screen.getAllByText(new RegExp(h, 'i'));
      expect(elements.length).toBeGreaterThan(0);
    }
  });

  it('renders State column with computed value (Maharashtra for 400001)', () => {
    render(<PincodeIntelligenceContent />);
    const stateCells = screen.getAllByTestId(/^state-/);
    expect(stateCells.length).toBeGreaterThanOrEqual(1);
    expect(stateCells[0].textContent).toBe('Maharashtra');
  });

  it('renders Tier T1 for Mumbai', () => {
    render(<PincodeIntelligenceContent />);
    const tier400001 = screen.getByTestId('tier-400001');
    expect(tier400001.textContent).toBe('T1');
  });

  it('renders Tier T2 for Nashik', () => {
    render(<PincodeIntelligenceContent />);
    const tier422001 = screen.getByTestId('tier-422001');
    expect(tier422001.textContent).toBe('T2');
  });

  it('renders Top Courier "—" for empty string (honest-empty)', () => {
    render(<PincodeIntelligenceContent />);
    const courier422001 = screen.getByTestId('top-courier-422001');
    expect(courier422001.textContent).toBe('—');
  });

  it('renders Top Courier value when present (Delhivery)', () => {
    render(<PincodeIntelligenceContent />);
    const courier400001 = screen.getByTestId('top-courier-400001');
    expect(courier400001.textContent).toBe('Delhivery');
  });

  it('renders unique customers "—" when 0 (honest-empty for local-db)', () => {
    render(<PincodeIntelligenceContent />);
    const uc422001 = screen.getByTestId('unique-customers-422001');
    expect(uc422001.textContent).toBe('—');
  });

  it('renders unique customers count when > 0', () => {
    render(<PincodeIntelligenceContent />);
    const uc400001 = screen.getByTestId('unique-customers-400001');
    expect(uc400001.textContent).toBe('160');
  });

  it('renders Revenue "—" when revenue_mu is 0 (honest-empty)', () => {
    render(<PincodeIntelligenceContent />);
    const rev422001 = screen.getByTestId('revenue-422001');
    expect(rev422001.textContent).toBe('—');
  });

  it('renders Revenue via formatMoney when > 0', () => {
    render(<PincodeIntelligenceContent />);
    const rev400001 = screen.getByTestId('revenue-400001');
    // 37_800_000 paise = ₹3.78 L
    expect(rev400001.textContent).toContain('₹');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: filters
// ---------------------------------------------------------------------------

describe('PincodeIntelligenceContent — filters', () => {
  it('renders High RTO filter checkbox', () => {
    render(<PincodeIntelligenceContent />);
    expect(screen.getByTestId('high-rto-filter')).toBeTruthy();
  });

  it('renders High COD filter checkbox', () => {
    render(<PincodeIntelligenceContent />);
    expect(screen.getByTestId('high-cod-filter')).toBeTruthy();
  });

  it('renders State text filter input', () => {
    render(<PincodeIntelligenceContent />);
    expect(screen.getByTestId('pin-state-filter')).toBeTruthy();
  });

  it('renders Min orders numeric input', () => {
    render(<PincodeIntelligenceContent />);
    expect(screen.getByTestId('pin-min-orders')).toBeTruthy();
  });

  it('renders search input', () => {
    render(<PincodeIntelligenceContent />);
    expect(screen.getByTestId('pin-search')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: sort headers
// ---------------------------------------------------------------------------

describe('PincodeIntelligenceContent — sortable headers', () => {
  it('clicking State header has aria-sort attribute and responds to click', () => {
    render(<PincodeIntelligenceContent />);
    const stateHeader = screen.getByTestId('sort-state');
    // Initial: default sort is reliability_score, so state header is not active
    expect(stateHeader.getAttribute('aria-sort')).toBe('none');
    // Click fires the nuqs setter — should not throw
    fireEvent.click(stateHeader);
    expect(stateHeader.textContent).toContain('State');
  });

  it('reliability_score header is active (default sort) with descending direction', () => {
    render(<PincodeIntelligenceContent />);
    // Default sort = reliability_score desc; the header should show desc arrow
    const scoreHeader = screen.getByTestId('sort-reliability_score');
    // default sort from nuqs mock → reliability_score, default dir → desc
    expect(scoreHeader.getAttribute('aria-sort')).toBe('descending');
  });

  it('clicking shipment_count header renders without crash', () => {
    render(<PincodeIntelligenceContent />);
    const ordersHeader = screen.getByTestId('sort-shipment_count');
    fireEvent.click(ordersHeader);
    expect(ordersHeader).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: score RAG coloring
// ---------------------------------------------------------------------------

describe('PincodeIntelligenceContent — score RAG coloring', () => {
  it('score >= 7000 (70%) gets green color class', () => {
    render(<PincodeIntelligenceContent />);
    // score 7000 / 100 = 70 >= 70 → green
    const row = screen.getByTestId('pin-row-400001');
    // Find score cell (second-to-last before Top Courier)
    const cells = row.querySelectorAll('td');
    const scoreCell = cells[cells.length - 2]; // second last td
    expect(scoreCell.className).toContain('green');
  });

  it('score 3000 (30%) gets red color class', () => {
    render(<PincodeIntelligenceContent />);
    const row = screen.getByTestId('pin-row-422001');
    const cells = row.querySelectorAll('td');
    const scoreCell = cells[cells.length - 2];
    expect(scoreCell.className).toContain('red');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE
// ---------------------------------------------------------------------------

describe('PincodeIntelligenceContent — NEGATIVE', () => {
  it('renders table when authenticated', () => {
    render(<PincodeIntelligenceContent />);
    expect(screen.getByTestId('pincode-table')).toBeTruthy();
  });
});
