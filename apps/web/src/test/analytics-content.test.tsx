// @paradigm: sql
// AnalyticsContent tests — parity-audit-v2 item 38 restoration.
//
// Test plan:
//   POSITIVE: renders page header "Store Analytics"
//   POSITIVE: renders date-preset buttons (Yesterday / 7D / 30D / 90D / 1Y)
//   POSITIVE: 30D preset is active by default
//   POSITIVE: clicking a preset calls setDateStart/setDateEnd
//   POSITIVE: AI Insight honest placeholder is present
//   POSITIVE: KPI card grid rendered (DashboardMetricsGrid present)
//   POSITIVE: customize button toggles panel
//   POSITIVE: daily AreaChart renders when dailySales data present
//   POSITIVE: Goal RAG hint text is present
//   POSITIVE: storefront engagement section rendered (honest empty)
//   NEGATIVE: "No data yet" empty-state when dataAvailability.hasSeedData = false
//   NEGATIVE: NOT-SIGNED-IN state renders sign-in prompt
//   NEGATIVE: error from dailySales renders ErrorDisplay
//   NEGATIVE: sessions/conversion rate always show "—" (no local data)
//
// CF-S10-HONEST-STATE-1: sessions/conversion render "—"; AI insights show honest placeholder.
// CF-C6-RENDER-ONLY-1: formatMoney is the only money formatter.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider as ReduxProvider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import uiReducer from '@/domain/store/ui-slice.js';
import sessionReducer from '@/domain/store/session-slice.js';

// ---------------------------------------------------------------------------
// ResizeObserver polyfill — jsdom does not implement ResizeObserver.
// Recharts ResponsiveContainer requires it. Provide a no-op stub.
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
// Mocks
// ---------------------------------------------------------------------------

// Session store — authenticated by default.
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
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    if (_key === 'from') return [iso(from), vi.fn()];
    if (_key === 'to') return [iso(today), vi.fn()];
    return ['', vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

// ---------------------------------------------------------------------------
// tRPC mock state (mutated per test).
// ---------------------------------------------------------------------------

const MOCK_PNL = {
  currency_code: 'INR',
  net_revenue_mu: 48_200_000n,
  cogs_mu: 12_000_000n,
  variable_costs_mu: 3_000_000n,
  cm1_mu: 33_200_000n,
  total_ad_spend_mu: 8_000_000n,
  cm2_mu: 25_200_000n,
  misc_expenses_prorated_mu: 2_000_000n,
  cm3_mu: 23_200_000n,
  order_count: 120n,
};

const MOCK_RTO = {
  currency_code: 'INR',
  rto_count: 18n,
  rto_rate_bp: 1500,
  total_rto_cost_mu: 5_000_000n,
  revenue_lost_to_rto_mu: 8_000_000n,
};

const MOCK_COD = {
  currency_code: 'INR',
  cod_orders: 75n,
  prepaid_orders: 45n,
  effective_revenue_cod_mu: 30_000_000n,
  effective_revenue_prepaid_mu: 18_200_000n,
  prepaid_rto_rate_bp: null,
};

const MOCK_MKT = {
  currency_code: 'INR',
  meta_spend_mu: 5_000_000n,
  google_spend_mu: 3_000_000n,
  total_ad_spend_mu: 8_000_000n,
  mer_bp: 60250,
  amer_bp: 45000,
  acos_bp: 1660,
};

const MOCK_STORE_SUMMARY = {
  currency_code: 'INR',
  gross_sales_mu: 55_000_000n,
  total_discount_mu: 4_000_000n,
  net_sales_mu: 50_000_000n,
  total_tax_mu: 1_800_000n,
  order_count: 120n,
  aov_mu: 416_666n,
  net_revenue_mu: 48_200_000n,
  realized_revenue_mu: 45_000_000n,
};

const MOCK_DAILY_ROWS = [
  { date: '2026-04-01', net_sales_mu: 2_000_000n },
  { date: '2026-04-02', net_sales_mu: 2_500_000n },
];

const MOCK_WORKSPACES = [
  { workspaceId: 'ws-test', slug: 'sugandh-lok', name: 'Sugandh Lok', role: 'owner' },
];

// Shared mutable state — tests mutate then re-render.
const mockState = {
  pnl: MOCK_PNL as typeof MOCK_PNL | null,
  rto: MOCK_RTO as typeof MOCK_RTO | null,
  cod: MOCK_COD as typeof MOCK_COD | null,
  mkt: MOCK_MKT as typeof MOCK_MKT | null,
  store: MOCK_STORE_SUMMARY as typeof MOCK_STORE_SUMMARY | null,
  daily: MOCK_DAILY_ROWS as typeof MOCK_DAILY_ROWS | null,
  dailyLoading: false,
  dailyError: null as { message: string; data?: { requestId?: string } } | null,
  hasSeedData: true as boolean | undefined,
  isAuthenticated: true,
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    workspace: {
      list: {
        useQuery: () => ({
          data: { workspaces: MOCK_WORKSPACES },
          isLoading: false,
        }),
      },
      dataAvailability: {
        useQuery: () => ({
          data:
            mockState.hasSeedData !== undefined
              ? { hasSeedData: mockState.hasSeedData }
              : undefined,
          isLoading: false,
          error: null,
        }),
      },
    },
    pnl: {
      statement: {
        useQuery: () => ({
          data: mockState.pnl ? { statement: mockState.pnl } : undefined,
          isLoading: false,
          error: null,
        }),
      },
    },
    logistics: {
      rto: {
        useQuery: () => ({
          data: mockState.rto ? { analytics: mockState.rto } : undefined,
          isLoading: false,
          error: null,
        }),
      },
      codPrepaid: {
        useQuery: () => ({
          data: mockState.cod ? { result: mockState.cod } : undefined,
          isLoading: false,
          error: null,
        }),
      },
    },
    marketing: {
      efficiency: {
        useQuery: () => ({
          data: mockState.mkt ? { result: mockState.mkt } : undefined,
          isLoading: false,
          error: null,
        }),
      },
    },
    store: {
      summary: {
        useQuery: () => ({
          data: mockState.store ? { summary: mockState.store } : undefined,
          isLoading: false,
          error: null,
          data_epoch: new Date().toISOString(),
        }),
      },
      dailySales: {
        useQuery: () => ({
          data: mockState.daily ? { rows: mockState.daily } : undefined,
          isLoading: mockState.dailyLoading,
          error: mockState.dailyError,
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

// AnalyticsContent dynamically imports DashboardMetricsGrid which has its own
// localStorage effects. Provide a localStorage stub.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// Import the component under test AFTER mocks.
import { AnalyticsContent } from '@/interfaces/components/store/analytics-content.js';

function renderAnalytics() {
  return render(
    <ReduxProvider store={makeStore()}>
      <AnalyticsContent />
    </ReduxProvider>,
  );
}

beforeEach(() => {
  localStorageMock.clear();
  // Reset state to happy path.
  mockState.pnl = MOCK_PNL;
  mockState.rto = MOCK_RTO;
  mockState.cod = MOCK_COD;
  mockState.mkt = MOCK_MKT;
  mockState.store = MOCK_STORE_SUMMARY;
  mockState.daily = MOCK_DAILY_ROWS;
  mockState.dailyLoading = false;
  mockState.dailyError = null;
  mockState.hasSeedData = true;
  mockState.isAuthenticated = true;
  sessionState.workspaceId = 'ws-test';
  sessionState.isAuthenticated = true;
});

// ---------------------------------------------------------------------------
// POSITIVE: Page chrome
// ---------------------------------------------------------------------------

describe('AnalyticsContent — page chrome', () => {
  it('renders "Store Analytics" heading', () => {
    renderAnalytics();
    expect(screen.getByRole('heading', { name: /Store Analytics/i })).toBeInTheDocument();
  });

  it('renders workspace name in subtitle', () => {
    renderAnalytics();
    expect(screen.getByText(/Sugandh Lok/)).toBeInTheDocument();
  });

  it('renders AI Insight honest placeholder', () => {
    renderAnalytics();
    expect(screen.getByTestId('ai-insight-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('ai-insight-placeholder').textContent).toMatch(/AI Insights/i);
  });

  it('renders Goal RAG hint text', () => {
    renderAnalytics();
    expect(screen.getByText(/Goal RAG/i)).toBeInTheDocument();
  });

  it('renders storefront engagement honest-empty section', () => {
    renderAnalytics();
    expect(screen.getByTestId('analytics-storefront-section')).toBeInTheDocument();
    expect(screen.getByText(/Sessions and Conversion Rate/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Date presets
// ---------------------------------------------------------------------------

describe('AnalyticsContent — date presets', () => {
  it('renders all 5 preset buttons (Yesterday / 7D / 30D / 90D / 1Y)', () => {
    renderAnalytics();
    const presets = screen.getByTestId('analytics-presets');
    expect(presets).toBeInTheDocument();
    expect(screen.getByTestId('analytics-preset-yesterday')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-preset-7d')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-preset-30d')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-preset-90d')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-preset-1y')).toBeInTheDocument();
  });

  it('30D preset has aria-pressed=true by default (default 30-day range)', () => {
    renderAnalytics();
    // The default range is last 30 days — 30D preset should be "pressed".
    const btn = screen.getByTestId('analytics-preset-30d');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('other presets have aria-pressed=false by default', () => {
    renderAnalytics();
    const notActive = ['analytics-preset-yesterday', 'analytics-preset-7d', 'analytics-preset-90d', 'analytics-preset-1y'];
    for (const id of notActive) {
      expect(screen.getByTestId(id).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('renders From and To date inputs', () => {
    renderAnalytics();
    expect(screen.getByTestId('analytics-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-date-to')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: KPI card grid (via DashboardMetricsGrid)
// ---------------------------------------------------------------------------

describe('AnalyticsContent — KPI card grid', () => {
  it('renders the DashboardMetricsGrid inside the analytics page', () => {
    renderAnalytics();
    // DashboardMetricsGrid renders with data-testid="dashboard-metrics-grid"
    expect(screen.getByTestId('dashboard-metrics-grid')).toBeInTheDocument();
  });

  it('renders CM1 card from the metrics grid', () => {
    renderAnalytics();
    expect(screen.getByTestId('metric-card-cm1')).toBeInTheDocument();
  });

  it('renders CM2 card', () => {
    renderAnalytics();
    expect(screen.getByTestId('metric-card-cm2')).toBeInTheDocument();
  });

  it('renders CM3 card', () => {
    renderAnalytics();
    expect(screen.getByTestId('metric-card-cm3')).toBeInTheDocument();
  });

  it('sessions card always shows "—" (no local data source)', () => {
    localStorageMock.setItem(
      'brain_dashboard_cards_sugandh-lok',
      JSON.stringify(['sessions']),
    );
    renderAnalytics();
    const card = screen.getByTestId('metric-card-sessions');
    expect(card.textContent).toContain('—');
  });

  it('conversionRate card always shows "—" (no local data source)', () => {
    localStorageMock.setItem(
      'brain_dashboard_cards_sugandh-lok',
      JSON.stringify(['conversionRate']),
    );
    renderAnalytics();
    const card = screen.getByTestId('metric-card-conversionRate');
    expect(card.textContent).toContain('—');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Customize panel toggle
// ---------------------------------------------------------------------------

describe('AnalyticsContent — customize panel', () => {
  it('customize button starts collapsed', () => {
    renderAnalytics();
    const btn = screen.getByTestId('analytics-customize-btn');
    expect(btn.textContent).toContain('Customize');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking customize button toggles aria-expanded', async () => {
    renderAnalytics();
    const btn = screen.getByTestId('analytics-customize-btn');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: Daily AreaChart
// ---------------------------------------------------------------------------

describe('AnalyticsContent — daily AreaChart', () => {
  it('renders the daily chart section when dailySales data is present', () => {
    renderAnalytics();
    expect(screen.getByTestId('analytics-daily-chart')).toBeInTheDocument();
  });

  it('chart section has the correct accessible label', () => {
    renderAnalytics();
    const section = screen.getByTestId('analytics-daily-chart');
    expect(section.getAttribute('aria-label')).toBe('Net sales over time');
  });

  it('chart skeleton shown when dailySales is loading and no rows', () => {
    mockState.daily = null;
    mockState.dailyLoading = true;
    renderAnalytics();
    expect(screen.getByTestId('analytics-chart-skeleton')).toBeInTheDocument();
  });

  it('does not render chart or skeleton when daily rows are empty and not loading', () => {
    mockState.daily = [];
    mockState.dailyLoading = false;
    renderAnalytics();
    expect(screen.queryByTestId('analytics-daily-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-chart-skeleton')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: empty state when no seed data
// ---------------------------------------------------------------------------

describe('AnalyticsContent — empty state', () => {
  it('renders EmptyWorkspaceState when hasSeedData = false', () => {
    mockState.hasSeedData = false;
    renderAnalytics();
    // EmptyWorkspaceState renders "No data yet" heading.
    expect(screen.getByRole('heading', { name: /No data yet/i })).toBeInTheDocument();
    // The metrics grid should NOT be shown.
    expect(screen.queryByTestId('dashboard-metrics-grid')).not.toBeInTheDocument();
  });

  it('renders the full metrics grid when hasSeedData = true', () => {
    mockState.hasSeedData = true;
    renderAnalytics();
    expect(screen.getByTestId('dashboard-metrics-grid')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /No data yet/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: not signed in
// ---------------------------------------------------------------------------

describe('AnalyticsContent — not signed in', () => {
  it('renders sign-in prompt when not authenticated', () => {
    sessionState.isAuthenticated = false;
    sessionState.workspaceId = null as unknown as string;
    render(<AnalyticsContent />);
    expect(screen.getByRole('heading', { name: /Not signed in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: dailySales error renders ErrorDisplay
// ---------------------------------------------------------------------------

describe('AnalyticsContent — error states', () => {
  it('renders ErrorDisplay when dailySales query errors', () => {
    mockState.daily = null;
    mockState.dailyLoading = false;
    mockState.dailyError = {
      message: 'Failed to load daily sales',
      data: { requestId: 'req-xyz' },
    };
    renderAnalytics();
    // ErrorDisplay renders the request ID and message.
    expect(screen.getByText(/Failed to load daily sales chart/i)).toBeInTheDocument();
  });
});
