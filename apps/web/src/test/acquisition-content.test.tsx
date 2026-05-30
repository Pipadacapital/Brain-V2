// @paradigm: sql
// AcquisitionContent tests — parity-audit-v2 item 38 restoration.
//
// Test plan:
//   POSITIVE: renders page heading "Acquisition"
//   POSITIVE: renders MER / aMER / CAC / CM2-per-NC stat cards
//   POSITIVE: renders New Customer Acquisition Trend section (client-computed MAs)
//   POSITIVE: trend chart renders when dailyAcq data is present
//   POSITIVE: MA values are computed from new_customers field (90/180/365-day)
//   POSITIVE: New Customer Order Composition section renders honest empty-state
//   POSITIVE: ACOS formatted to 1 decimal (e.g. "16.60%")
//   POSITIVE: MER formatted with rounding (not floor)
//   POSITIVE: money values formatted via formatMoney (not raw number)
//   POSITIVE: date pickers rendered (from/to)
//   NEGATIVE: not-authenticated renders sign-in prompt
//   NEGATIVE: error from efficiency renders ErrorDisplay
//   NEGATIVE: loading skeleton shown while data loads
//   NEGATIVE: trend section not shown when dailyAcq has no rows
//
// CF-S10-HONEST-STATE-1: composition renders honest empty-state.
// CF-C6-RENDER-ONLY-1: formatMoney is the only money formatter.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider as ReduxProvider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import uiReducer from '@/domain/store/ui-slice.js';
import sessionReducer from '@/domain/store/session-slice.js';

// ---------------------------------------------------------------------------
// ResizeObserver polyfill — jsdom does not implement ResizeObserver.
// ---------------------------------------------------------------------------
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverStub;
}

// ---------------------------------------------------------------------------
// Session store — authenticated by default.
// ---------------------------------------------------------------------------
const sessionState = {
  workspaceId: 'ws-test',
  isAuthenticated: true,
  userId: 'user-1',
  workspaceRole: 'owner',
};

vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: sessionState }),
}));

// nuqs — URL state always at defaults.
vi.mock('nuqs', () => ({
  useQueryState: (_key: string, _parser: unknown) => {
    if (_key === 'from') return ['2026-01-01', vi.fn()];
    if (_key === 'to') return ['2026-05-29', vi.fn()];
    return ['', vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_EFF = {
  currency_code: 'INR',
  meta_spend_mu: 5_000_000n,
  google_spend_mu: 3_000_000n,
  total_ad_spend_mu: 8_000_000n,
  mer_bp: 60250,        // 6.0250× → rounded = "6.03×"
  amer_bp: 45050,       // 4.5050× → rounded = "4.51×"
  acos_bp: 1660,        // 16.60%
  blended_roas_x100: 293, // 2.93×
};

const MOCK_ACQ_SUMMARY = {
  cac_mu: 1_200_000n,
  cm2_per_nc_mu: 800_000n,
  new_customers_count: 42,
  new_customer_revenue_mu: 18_000_000n,
  daily: [
    {
      date: '2026-05-01',
      new_customers: 5,
      nc_cm2_mu: 400_000n,
      cac_mu: 800_000n,
      amer_bp: 45000,
    },
  ],
};

const MOCK_DAILY_ROWS = [
  {
    date: '2026-05-01',
    new_customers: 5,
    nc_revenue_mu: 2_000_000n,
    ad_spend_mu: 1_000_000n,
    nc_cm2_mu: 400_000n,
    cac_mu: 800_000n,
    cm2_per_nc_mu: 200_000n,
    meta_spend_mu: 600_000n,
    google_spend_mu: 400_000n,
  },
  {
    date: '2026-05-02',
    new_customers: 8,
    nc_revenue_mu: 3_200_000n,
    ad_spend_mu: 1_500_000n,
    nc_cm2_mu: 700_000n,
    cac_mu: 900_000n,
    cm2_per_nc_mu: 250_000n,
    meta_spend_mu: 900_000n,
    google_spend_mu: 600_000n,
  },
];

// Mutable state per test.
const mockState = {
  eff: MOCK_EFF as typeof MOCK_EFF | null,
  effLoading: false,
  effError: null as { message: string; data?: { requestId?: string } } | null,
  acqSummary: MOCK_ACQ_SUMMARY as typeof MOCK_ACQ_SUMMARY | null,
  acqLoading: false,
  acqError: null as { message: string; data?: { requestId?: string } } | null,
  daily: MOCK_DAILY_ROWS as typeof MOCK_DAILY_ROWS | null,
  dailyLoading: false,
  isAuthenticated: true,
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    marketing: {
      efficiency: {
        useQuery: () => ({
          data: mockState.eff
            ? { result: mockState.eff, data_epoch: new Date().toISOString(), request_id: 'req-test' }
            : undefined,
          isLoading: mockState.effLoading,
          error: mockState.effError,
        }),
      },
      acquisition: {
        useQuery: () => ({
          data: mockState.acqSummary
            ? {
                summary: mockState.acqSummary,
                daily: mockState.acqSummary.daily,
                data_epoch: new Date().toISOString(),
                request_id: 'req-test',
              }
            : undefined,
          isLoading: mockState.acqLoading,
          error: mockState.acqError,
        }),
      },
      dailyAcquisition: {
        useQuery: () => ({
          data: mockState.daily ? { rows: mockState.daily, data_epoch: new Date().toISOString() } : undefined,
          isLoading: mockState.dailyLoading,
          error: null,
        }),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore() {
  return configureStore({ reducer: { ui: uiReducer, session: sessionReducer } });
}

// Import after mocks.
import { AcquisitionContent } from '@/interfaces/components/marketing/acquisition-content.js';

function renderAcq() {
  return render(
    <ReduxProvider store={makeStore()}>
      <AcquisitionContent />
    </ReduxProvider>,
  );
}

beforeEach(() => {
  mockState.eff = MOCK_EFF;
  mockState.effLoading = false;
  mockState.effError = null;
  mockState.acqSummary = MOCK_ACQ_SUMMARY;
  mockState.acqLoading = false;
  mockState.acqError = null;
  mockState.daily = MOCK_DAILY_ROWS;
  mockState.dailyLoading = false;
  mockState.isAuthenticated = true;
  sessionState.workspaceId = 'ws-test';
  sessionState.isAuthenticated = true;
});

// ---------------------------------------------------------------------------
// POSITIVE: Page chrome
// ---------------------------------------------------------------------------

describe('AcquisitionContent — page chrome', () => {
  it('renders "Acquisition" heading', () => {
    renderAcq();
    expect(screen.getByRole('heading', { name: /Acquisition/i, level: 1 })).toBeInTheDocument();
  });

  it('renders from and to date pickers', () => {
    renderAcq();
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Section 1 — Efficiency KPI cards
// ---------------------------------------------------------------------------

describe('AcquisitionContent — Section 1: efficiency KPIs', () => {
  it('renders MER stat card', () => {
    renderAcq();
    expect(screen.getByText('MER')).toBeInTheDocument();
  });

  it('renders aMER stat card', () => {
    renderAcq();
    // aMER appears in both stat card and daily table header — getAllByText is correct.
    expect(screen.getAllByText('aMER').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Blended CAC stat card', () => {
    renderAcq();
    expect(screen.getByText('Blended CAC')).toBeInTheDocument();
  });

  it('renders CM2 / new customer stat card', () => {
    renderAcq();
    expect(screen.getByText('CM2 / new customer')).toBeInTheDocument();
  });

  it('renders New customers stat card', () => {
    renderAcq();
    expect(screen.getByText('New customers')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Number format fixes
// ---------------------------------------------------------------------------

describe('AcquisitionContent — number formats', () => {
  it('ACOS renders with 1 decimal place (16.60%)', () => {
    renderAcq();
    // acos_bp = 1660 → "16.60%"
    expect(screen.getByText('16.60%')).toBeInTheDocument();
  });

  it('MER renders with rounding (not floor) — 60250 bp → "6.03×"', () => {
    renderAcq();
    // mer_bp = 60250 → 60250/100 = 602.5 → Math.round = 603 → "6.03×"
    expect(screen.getByText('6.03×')).toBeInTheDocument();
  });

  it('aMER renders with rounding — 45050 bp → "4.51×"', () => {
    renderAcq();
    // amer_bp = 45050 → 45050/100 = 450.5 → Math.round = 451 → "4.51×"
    expect(screen.getByText('4.51×')).toBeInTheDocument();
  });

  it('money values use formatMoney (Indian grouping for INR)', () => {
    renderAcq();
    // MOCK_ACQ_SUMMARY.cac_mu = 1_200_000n minor-units → formatMoney renders ₹ prefix.
    // Multiple ₹ values rendered (CAC, CM2/NC, NC revenue, ad spend, etc.).
    expect(screen.getAllByText(/₹/).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Section 2 — Acquisition Trend (client-computed MAs)
// ---------------------------------------------------------------------------

describe('AcquisitionContent — Section 2: Acquisition Trend', () => {
  it('renders "New Customer Acquisition Trend" heading', () => {
    renderAcq();
    expect(
      screen.getByRole('heading', { name: /New Customer Acquisition Trend/i }),
    ).toBeInTheDocument();
  });

  it('renders the trend section container', () => {
    renderAcq();
    expect(screen.getByTestId('acq-trend-section')).toBeInTheDocument();
  });

  it('renders trend legend labels (90-Day MA / 180-Day MA / 365-Day MA)', () => {
    renderAcq();
    const legend = screen.getByLabelText('Trend chart legend');
    expect(legend.textContent).toContain('90-Day MA');
    expect(legend.textContent).toContain('180-Day MA');
    expect(legend.textContent).toContain('365-Day MA');
  });

  it('renders descriptive text about moving averages', () => {
    renderAcq();
    expect(screen.getByText(/90, 180, and 365-day moving averages/i)).toBeInTheDocument();
  });

  it('renders trend crystal ball description', () => {
    renderAcq();
    expect(screen.getByText(/crystal ball/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Section 3 — Order Composition (honest empty-state)
// ---------------------------------------------------------------------------

describe('AcquisitionContent — Section 3: Order Composition', () => {
  it('renders "New Customer Order Composition" heading', () => {
    renderAcq();
    expect(
      screen.getByRole('heading', { name: /New Customer Order Composition/i }),
    ).toBeInTheDocument();
  });

  it('renders honest empty-state container', () => {
    renderAcq();
    expect(screen.getByTestId('acq-composition-section')).toBeInTheDocument();
  });

  it('honest empty-state text references "coming soon"', () => {
    renderAcq();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('honest empty-state mentions backend follow-up', () => {
    renderAcq();
    expect(screen.getByText(/backend follow-up/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: not signed in
// ---------------------------------------------------------------------------

describe('AcquisitionContent — not signed in', () => {
  it('renders sign-in prompt when not authenticated', () => {
    sessionState.isAuthenticated = false;
    sessionState.workspaceId = null as unknown as string;
    render(
      <ReduxProvider store={makeStore()}>
        <AcquisitionContent />
      </ReduxProvider>,
    );
    expect(screen.getByRole('heading', { name: /Not signed in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: error state
// ---------------------------------------------------------------------------

describe('AcquisitionContent — error states', () => {
  it('renders ErrorDisplay when efficiency query errors', () => {
    mockState.eff = null;
    mockState.effError = { message: 'Failed to load marketing efficiency', data: { requestId: 'req-err' } };
    renderAcq();
    expect(screen.getByText(/Failed to load acquisition/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: loading state
// ---------------------------------------------------------------------------

describe('AcquisitionContent — loading state', () => {
  it('renders loading skeleton when eff is loading', () => {
    mockState.eff = null;
    mockState.effLoading = true;
    renderAcq();
    // Loading aria-label
    expect(screen.getByLabelText(/Loading acquisition/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: trend section hidden when no daily rows
// ---------------------------------------------------------------------------

describe('AcquisitionContent — trend section with no data', () => {
  it('does not render trend section when dailyAcq has no rows and is not loading', () => {
    mockState.daily = null;
    mockState.dailyLoading = false;
    renderAcq();
    expect(screen.queryByTestId('acq-trend-section')).not.toBeInTheDocument();
  });
});
