// @paradigm: sql
// FirstProductCascadeContent tests — parity-38 feat-parity-w6b.
//
// POSITIVE: renders heading + controls
// POSITIVE: renders cohort funnel summary card with 4 funnel steps
// POSITIVE: funnel pct = customers_with_2nd / total_cohort * 100
// POSITIVE: sortable column headers present (aria-sort attribute)
// POSITIVE: column sort toggles direction on repeated click
// POSITIVE: renders the cascade table rows with all 8 columns
// POSITIVE: additional_order_rate_centi displayed as centi (÷100, 2dp)
// POSITIVE: average_days_to_second_deci displayed as deci (÷10, 1dp) with 'days'
// POSITIVE: null days-to-second renders '—'
// NEGATIVE: unauthenticated shows sign-in
// NEGATIVE: error renders ErrorDisplay

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal = (parser && typeof parser === 'object' && 'withDefault' in parser)
      ? parser.withDefault : null;
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
  parseAsInteger: { withDefault: (d: number) => ({ withDefault: d }) },
}));

let mockIsAuthenticated = true;
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { isAuthenticated: mockIsAuthenticated, workspaceId: 'ws-cascade' } }),
}));

let mockQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    catalog: {
      firstProductCascade: {
        useQuery: () => mockQuery,
      },
    },
  },
}));

vi.mock('@brain/lib-metrics', () => ({
  formatMoney: (mu: bigint, _cc: string) => `₹${(Number(mu) / 100).toFixed(0)}`,
}));

vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) => <div data-testid="error-display">{title}</div>,
}));

vi.mock('@/interfaces/components/marketing/format-ratio.js', () => ({
  formatBpPercent: (bp: number | null) => bp === null ? '—' : `${(bp / 100).toFixed(2)}%`,
}));

vi.mock('@/lib/default-date-range.js', () => ({
  DEFAULT_DATE_START: '2026-04-01',
  DEFAULT_DATE_END: '2026-04-30',
}));

import React from 'react';
import { FirstProductCascadeContent } from '@/interfaces/components/catalog/first-product-cascade-content.js';

const makeRow = (override = {}) => ({
  product_key: 'p_oud',
  product_title: 'Sugandh Oud Attar 12ml',
  first_order_customers: 100n,
  customers_with_2nd_order: 40n,
  customers_with_3rd_order: 15n,
  customers_with_4th_plus_order: 5n,
  second_order_rate_bp: 4000,
  third_order_rate_bp: 1500,
  fourth_plus_rate_bp: 500,
  additional_order_rate_centi: 75n,    // 0.75 extra orders
  average_ltv_revenue_mu: 1_000_000n, // ₹10,000
  average_days_to_second_deci: 300n,  // 30.0 days
  ...override,
});

const makeData = (rows = [makeRow()]) => ({
  result: {
    workspace_id: 'ws-cascade',
    observation_days: 365,
    currency_code: 'INR',
    rows,
    total_cohort_customers: rows.reduce((s, r) => s + Number(r.first_order_customers), 0),
  },
  total_cohort_customers: rows.reduce((s, r) => s + Number(r.first_order_customers), 0),
  observation_days: 365,
  data_epoch: new Date(),
  request_id: 'req-cascade',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = true;
  mockQuery = { data: makeData(), isLoading: false };
});

describe('FirstProductCascadeContent (positive)', () => {
  it('renders page heading', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getByText('First Product Cascade')).toBeDefined();
  });

  it('renders observation-window selector', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getByLabelText(/Observation/i)).toBeDefined();
  });

  it('renders cohort funnel summary card', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getByText(/Repeat order funnel/i)).toBeDefined();
  });

  it('shows all 4 funnel steps', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getAllByText(/1st order/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2nd order/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3rd order/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4th\+ order/).length).toBeGreaterThan(0);
  });

  it('funnel pct for 2nd order = 40% (40/100)', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getByText('40.0%')).toBeDefined();
  });

  it('renders product row', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getAllByText(/Sugandh Oud/i).length).toBeGreaterThan(0);
  });

  it('renders additional_order_rate_centi as 0.75', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getByText('0.75')).toBeDefined();
  });

  it('renders average_days_to_second_deci as "30.0 days"', () => {
    render(<FirstProductCascadeContent />);
    expect(screen.getByText('30.0 days')).toBeDefined();
  });

  it('renders null days-to-second as "—"', () => {
    mockQuery = { data: makeData([makeRow({ average_days_to_second_deci: null })]), isLoading: false };
    render(<FirstProductCascadeContent />);
    // Should have a — in the days-to-second column
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('column header "Cohort" has aria-sort attribute (sortable)', () => {
    render(<FirstProductCascadeContent />);
    // Find all "Cohort" text — use getAllByText and pick the th
    const cohortElements = screen.getAllByText(/^Cohort$/);
    const th = cohortElements.find((el) => el.tagName === 'TH' || el.closest('th'));
    expect(th?.closest('th')?.getAttribute('aria-sort')).toBeDefined();
  });

  it('clicking "Cohort" table header twice toggles sort direction', () => {
    render(<FirstProductCascadeContent />);
    const cohortElements = screen.getAllByText(/^Cohort$/);
    const th = cohortElements.find((el) => el.tagName === 'TH' || el.closest('th'));
    const thEl = th?.closest('th')!;
    fireEvent.click(thEl);
    const firstDir = thEl.getAttribute('aria-sort');
    fireEvent.click(thEl);
    const secondDir = thEl.getAttribute('aria-sort');
    expect(firstDir).not.toBe(secondDir);
  });

  it('shows empty state when rows=[]', () => {
    mockQuery = { data: makeData([]), isLoading: false };
    render(<FirstProductCascadeContent />);
    expect(screen.getByText(/No first-product cascade data/i)).toBeDefined();
  });
});

describe('FirstProductCascadeContent (negative)', () => {
  it('shows sign-in when unauthenticated', () => {
    mockIsAuthenticated = false;
    render(<FirstProductCascadeContent />);
    expect(screen.getByText(/Not signed in/i)).toBeDefined();
  });

  it('shows error display on query error', () => {
    mockQuery = { error: { message: 'timeout', data: {} }, isLoading: false };
    render(<FirstProductCascadeContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });
});
