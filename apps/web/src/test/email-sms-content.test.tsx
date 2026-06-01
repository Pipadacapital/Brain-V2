// @paradigm: sql
// EmailSmsContent tests — parity-38 feat-parity-w6b.
//
// POSITIVE: renders heading + methodology note
// POSITIVE: shows group-by options with legacy 'By ...' prefix and '(daily)' qualifier on flow
// POSITIVE: shows preset buttons (Yesterday/7D/30D/90D/1Y)
// POSITIVE: renders 13 legacy columns + Channel (enhancement)
// POSITIVE: shows Opens count (raw bigint) and Open % separately
// POSITIVE: shows Unsub count, Unsub %, Spam count, Spam % columns
// POSITIVE: shows $/unique-open column
// POSITIVE: honest empty row when rows=[]
// NEGATIVE: unauthenticated shows sign-in
// NEGATIVE: error renders ErrorDisplay

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal = (parser && typeof parser === 'object' && 'withDefault' in parser)
      ? parser.withDefault : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

let mockIsAuthenticated = true;
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { isAuthenticated: mockIsAuthenticated, workspaceId: 'ws-test-email' } }),
}));

let mockQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    lifecycle: {
      emailSms: {
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

import React from 'react';
import { EmailSmsContent } from '@/interfaces/components/lifecycle/email-sms-content.js';

const makeRow = () => ({
  key: 'c:diwali',
  label: 'Diwali Dhamaka',
  channel: 'email',
  delivered: 12000n,
  unique_opens: 5400n,
  unique_clicks: 1440n,
  orders: 320n,
  revenue_mu: 96_00_000n,
  unsubscribes: 36n,
  spam_complaints: 6n,
  open_rate_bp: 4500,
  click_rate_bp: 1200,
  revenue_per_recipient_mu: 800n,
  revenue_per_unique_open_mu: 1778n,
  unsubscribe_rate_bp: 30,
  spam_rate_bp: 5,
});

const makeData = () => ({
  result: { currency_code: 'INR', group_by: 'campaign' as const, workspace_id: 'ws', period: 'synced', data_epoch: new Date() },
  rows: [makeRow()],
  total_delivered: 12000n,
  total_revenue_mu: 96_00_000n,
  data_epoch: new Date(),
  request_id: 'req-test',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = true;
  mockQuery = { data: makeData(), isLoading: false };
});

describe('EmailSmsContent (positive)', () => {
  it('renders page heading', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText(/Email & SMS/)).toBeDefined();
  });

  it('shows Klaviyo methodology note', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText(/Klaviyo/)).toBeDefined();
    expect(screen.getByText(/delivered as denominator/)).toBeDefined();
  });

  it('shows preset buttons', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('7D')).toBeDefined();
    expect(screen.getByText('30D')).toBeDefined();
    expect(screen.getByText('90D')).toBeDefined();
  });

  it('shows legacy "By campaign" group-by option', () => {
    render(<EmailSmsContent />);
    // Native <select> renders <option> elements
    expect(screen.getAllByText(/By campaign/).length).toBeGreaterThan(0);
  });

  it('shows "By flow (daily)" option with qualifier', () => {
    render(<EmailSmsContent />);
    expect(screen.getAllByText(/By flow \(daily\)/).length).toBeGreaterThan(0);
  });

  it('renders Opens (raw count) column header', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Opens')).toBeDefined();
  });

  it('renders Open % column header separately', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Open %')).toBeDefined();
  });

  it('renders $/unique-open column header', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('$/unique-open')).toBeDefined();
  });

  it('renders Unsub column header', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Unsub')).toBeDefined();
  });

  it('renders Unsub % column header', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Unsub %')).toBeDefined();
  });

  it('renders Spam column header', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Spam')).toBeDefined();
  });

  it('renders Spam % column header', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Spam %')).toBeDefined();
  });

  it('renders campaign row label', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('Diwali Dhamaka')).toBeDefined();
  });

  it('renders raw opens count (5400)', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('5,400')).toBeDefined();
  });

  it('renders unsubscribes count (36)', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('36')).toBeDefined();
  });

  it('renders spam complaints count (6)', () => {
    render(<EmailSmsContent />);
    expect(screen.getByText('6')).toBeDefined();
  });

  it('shows empty state row when no data', () => {
    mockQuery = {
      data: {
        result: { currency_code: 'INR', group_by: 'campaign', workspace_id: 'ws', period: 'synced', data_epoch: new Date() },
        rows: [],
        total_delivered: 0n,
        total_revenue_mu: 0n,
        data_epoch: new Date(),
        request_id: 'req',
      },
      isLoading: false,
    };
    render(<EmailSmsContent />);
    expect(screen.getByText(/No email\/SMS data/i)).toBeDefined();
  });
});

describe('EmailSmsContent (negative)', () => {
  it('shows sign-in when unauthenticated', () => {
    mockIsAuthenticated = false;
    render(<EmailSmsContent />);
    expect(screen.getByText(/Not signed in/i)).toBeDefined();
  });

  it('shows error display on query error', () => {
    mockQuery = { error: { message: 'timeout', data: {} }, isLoading: false };
    render(<EmailSmsContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });
});
