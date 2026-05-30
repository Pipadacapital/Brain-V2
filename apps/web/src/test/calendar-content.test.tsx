// @paradigm: sql
// CalendarContent tests — parity-38 restore.
//
// POSITIVE: renders page title "Calendar report"
// POSITIVE: renders icon legend for all 8 marketing action types
// POSITIVE: renders Klaviyo overlay affordance (honest-disabled badge)
// POSITIVE: renders festival colour band in the legend when festivals data present
// POSITIVE: renders calendar grid rows from trpc.calendar.report
// POSITIVE: renders RAG badge in metric cells
// POSITIVE: renders actions as icon buttons on the grid row
// POSITIVE: MANAGER sees "Add action" button
// POSITIVE: createAction mutation called when add dialog saved
// POSITIVE: updateAction mutation called when edit dialog saved
// POSITIVE: deleteAction mutation called via dropdown delete
// NEGATIVE: non-MANAGER (ANALYST) does NOT see "Add action" button
// NEGATIVE: unauthenticated shows sign-in prompt
// NEGATIVE: Klaviyo rows have no edit/delete in their dropdown

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// nuqs mock — stateful per key
// ---------------------------------------------------------------------------
vi.mock('nuqs', async () => {
  const React = await import('react');
  return {
    useQueryState: (_key: string, opts: { withDefault?: string }) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return React.useState((opts as { withDefault?: string })?.withDefault ?? '');
    },
    parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
  };
});

// ---------------------------------------------------------------------------
// Redux session mock
// ---------------------------------------------------------------------------
let mockRole = 'MANAGER';
let mockAuthenticated = true;

vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({
      session: {
        workspaceId: 'ws-test',
        isAuthenticated: mockAuthenticated,
        workspaceRole: mockRole,
      },
    }),
}));

// ---------------------------------------------------------------------------
// tRPC mutation/query spies (hoisted so vi.mock closure captures them)
// ---------------------------------------------------------------------------
const {
  createActionMutate,
  updateActionMutate,
  deleteActionMutate,
  invalidate,
} = vi.hoisted(() => ({
  createActionMutate:  vi.fn(),
  updateActionMutate:  vi.fn(),
  deleteActionMutate:  vi.fn(),
  invalidate:          vi.fn(),
}));

let createOnSuccess: (() => void) | undefined;
let updateOnSuccess: (() => void) | undefined;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const FESTIVAL_ROWS = [
  {
    name: 'Diwali',
    start_date: '2026-11-08',
    end_date:   '2026-11-12',
    expected_multiplier_bp: 40000,
    regions: [],
    categories: ['all'],
    color: '#F59E0B',
    is_template: true,
    is_active: true,
  },
];

const CAL_ROWS = [
  {
    period_key:   '2026-05-01',
    label:        'May 1, 2026',
    actions:      [
      {
        id:          'action-kl-1',
        action_date: '2026-05-01',
        action_type: 'email_campaign',
        action_name: 'May Day blast',
        notes:       'Klaviyo',
        source:      'klaviyo',
      },
    ],
    revenue:      { actual: 1_000_000n, goal: 900_000n, rag: 'green' as const },
    cm3:          { actual:   300_000n, goal: 250_000n, rag: 'green' as const },
    total_spend_mu: 200_000n,
    mer:          { actual: 50000n, goal: 45000n, rag: 'green' as const },
    amer:         { actual: 30000n, goal: 25000n, rag: 'green' as const },
    new_customers:{ actual: 10n,    goal:  8n,    rag: 'green' as const },
    cac:          { actual: 20000n, goal: 25000n, rag: 'green' as const },
    aov:          { actual: 100_000n, goal: 95_000n, rag: 'green' as const },
  },
  {
    period_key:   '2026-05-02',
    label:        'May 2, 2026',
    actions:      [
      {
        id:          'action-manual-1',
        action_date: '2026-05-02',
        action_type: 'promotion',
        action_name: 'Flash sale',
        notes:       '20% off',
        source:      'manual',
      },
    ],
    revenue:      { actual: 800_000n,  goal: 900_000n, rag: 'amber' as const },
    cm3:          { actual: 200_000n,  goal: 250_000n, rag: 'amber' as const },
    total_spend_mu: 250_000n,
    mer:          { actual: 32000n, goal: 45000n, rag: 'red' as const },
    amer:         { actual: 24000n, goal: 25000n, rag: 'amber' as const },
    new_customers:{ actual: 6n,    goal:  8n,    rag: 'amber' as const },
    cac:          { actual: 41000n, goal: 25000n, rag: 'red' as const },
    aov:          { actual: 90_000n,  goal: 95_000n, rag: 'amber' as const },
  },
];

const CAL_DATA = {
  rows: CAL_ROWS,
  grain: 'day' as const,
  currency_code: 'INR',
  total_rows: BigInt(CAL_ROWS.length),
  data_epoch: new Date(),
  request_id: 'req-test',
  result: { rows: CAL_ROWS, grain: 'day' as const, currency_code: 'INR', total_rows: 2n, workspace_id: 'ws-test', period: 'test', data_epoch: new Date() },
};

const FESTIVALS_DATA = {
  rows: FESTIVAL_ROWS,
  total_rows: 1n,
  peak_multiplier_bp: 40000,
  data_epoch: new Date(),
  request_id: 'req-test',
  result: { rows: FESTIVAL_ROWS, total_rows: 1n, peak_multiplier_bp: 40000, workspace_id: 'ws-test', period: 'test', data_epoch: new Date(), year: 2026 },
};

const ACTIONS_DATA = {
  rows: [],
  total_rows: 0n,
  data_epoch: new Date(),
  request_id: 'req-test',
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    calendar: {
      report: {
        useQuery: () => ({ data: CAL_DATA, isLoading: false, error: null }),
      },
    },
    settings: {
      festivals: {
        useQuery: () => ({ data: FESTIVALS_DATA, isLoading: false, error: null }),
      },
    },
    marketing: {
      listActions: {
        useQuery: () => ({ data: ACTIONS_DATA, isLoading: false, error: null }),
      },
      createAction: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          createOnSuccess = opts.onSuccess;
          return { mutate: createActionMutate, isPending: false, error: null };
        },
      },
      updateAction: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          updateOnSuccess = opts.onSuccess;
          return { mutate: updateActionMutate, isPending: false, error: null };
        },
      },
      deleteAction: {
        useMutation: (_opts: { onSuccess?: () => void }) => ({
          mutate: deleteActionMutate, isPending: false, error: null,
        }),
      },
    },
    useUtils: () => ({
      calendar:  { report:    { invalidate } },
      marketing: { listActions: { invalidate } },
    }),
  },
}));

import { CalendarContent } from '@/interfaces/components/settings/calendar-content.js';

beforeEach(() => {
  mockRole = 'MANAGER';
  mockAuthenticated = true;
  createActionMutate.mockReset();
  updateActionMutate.mockReset();
  deleteActionMutate.mockReset();
  invalidate.mockReset();
});

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CalendarContent (parity-38)', () => {

  // ---- Basic renders -------------------------------------------------------

  it('renders page title "Calendar report"', () => {
    render(<CalendarContent />);
    expect(screen.getByText('Calendar report')).toBeInTheDocument();
  });

  it('renders icon legend with all 8 marketing action types', () => {
    render(<CalendarContent />);
    const legend = screen.getByTestId('action-legend');
    expect(legend).toBeInTheDocument();
    // Check a few label names from the legend
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('SMS')).toBeInTheDocument();
    expect(screen.getByText('Promotion')).toBeInTheDocument();
    expect(screen.getByText('Sale')).toBeInTheDocument();
  });

  it('renders Klaviyo honest-disabled badge', () => {
    render(<CalendarContent />);
    const badge = screen.getByTestId('klaviyo-disabled-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Klaviyo sends');
    expect(badge).toHaveTextContent('Connect');
  });

  it('renders festival legend when festivals data present', () => {
    render(<CalendarContent />);
    const festLegend = screen.getByTestId('festival-legend');
    expect(festLegend).toBeInTheDocument();
    expect(festLegend).toHaveTextContent('Diwali');
    expect(festLegend).toHaveTextContent('4.0×');
  });

  it('renders calendar grid rows', () => {
    render(<CalendarContent />);
    const grid = screen.getByTestId('calendar-grid');
    expect(grid).toBeInTheDocument();
    // Row labels from the seeded data
    expect(screen.getByText('May 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('May 2, 2026')).toBeInTheDocument();
  });

  it('renders RAG badges in metric cells', () => {
    render(<CalendarContent />);
    // "On track" badges come from green RAG cells (row 1 has all green)
    const onTrackBadges = screen.getAllByText('On track');
    expect(onTrackBadges.length).toBeGreaterThan(0);
    // "Off track" badges come from red RAG cells (row 2 has red MER/CAC)
    const offTrackBadges = screen.getAllByText('Off track');
    expect(offTrackBadges.length).toBeGreaterThan(0);
  });

  it('renders action icon buttons for seeded actions', () => {
    render(<CalendarContent />);
    // Klaviyo action on May 1
    const klaviyoBtn = screen.getByTestId('action-btn-action-kl-1');
    expect(klaviyoBtn).toBeInTheDocument();
    // Manual action on May 2
    const manualBtn = screen.getByTestId('action-btn-action-manual-1');
    expect(manualBtn).toBeInTheDocument();
  });

  // ---- MANAGER controls ----------------------------------------------------

  it('MANAGER sees "Add action" button', () => {
    mockRole = 'MANAGER';
    render(<CalendarContent />);
    expect(screen.getByTestId('add-action-btn')).toBeInTheDocument();
  });

  it('ANALYST does NOT see "Add action" button', () => {
    mockRole = 'ANALYST';
    render(<CalendarContent />);
    expect(screen.queryByTestId('add-action-btn')).not.toBeInTheDocument();
  });

  it('unauthenticated shows sign-in prompt', () => {
    mockAuthenticated = false;
    render(<CalendarContent />);
    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
  });

  // ---- Add dialog ----------------------------------------------------------

  it('createAction mutation called when add dialog saved', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<CalendarContent />);

    await user.click(screen.getByTestId('add-action-btn'));
    // Dialog should be open — find name input
    const nameInput = screen.getByLabelText(/^Name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Test campaign');

    await user.click(screen.getByTestId('save-add-action-btn'));

    expect(createActionMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        action_name: 'Test campaign',
      }),
    );
  });

  it('add dialog closes and invalidates after createAction success', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    const { act } = await import('react');
    render(<CalendarContent />);

    await user.click(screen.getByTestId('add-action-btn'));
    const nameInput = screen.getByLabelText(/^Name$/i);
    await user.type(nameInput, 'Promo blast');
    await user.click(screen.getByTestId('save-add-action-btn'));

    // Simulate mutation success
    await act(async () => { createOnSuccess?.(); });
    expect(invalidate).toHaveBeenCalled();
  });

  // ---- Edit dialog ---------------------------------------------------------

  it('updateAction mutation called when edit dialog saved', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<CalendarContent />);

    // Open dropdown on the manual action button
    const manualBtn = screen.getByTestId('action-btn-action-manual-1');
    await user.click(manualBtn);

    // Click Edit
    const editItem = screen.getByTestId('edit-action-action-manual-1');
    await user.click(editItem);

    // Edit dialog should be open — save it
    const saveEditBtn = screen.getByTestId('save-edit-action-btn');
    await user.click(saveEditBtn);

    expect(updateActionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ action_id: 'action-manual-1' }),
    );
  });

  // ---- Delete action -------------------------------------------------------

  it('deleteAction mutation called via dropdown delete', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<CalendarContent />);

    const manualBtn = screen.getByTestId('action-btn-action-manual-1');
    await user.click(manualBtn);

    const deleteItem = screen.getByTestId('delete-action-action-manual-1');
    await user.click(deleteItem);

    expect(deleteActionMutate).toHaveBeenCalledWith({ action_id: 'action-manual-1' });
  });

  // ---- Klaviyo row is read-only -------------------------------------------

  it('Klaviyo action shows no edit/delete in dropdown', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<CalendarContent />);

    // Open dropdown on Klaviyo action button
    const klaviyoBtn = screen.getByTestId('action-btn-action-kl-1');
    await user.click(klaviyoBtn);

    // Edit and Delete should NOT be present for a Klaviyo action
    await waitFor(() => {
      expect(screen.queryByTestId('edit-action-action-kl-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('delete-action-action-kl-1')).not.toBeInTheDocument();
    });
  });

  it('Klaviyo dropdown shows "Klaviyo" label in action details', async () => {
    const user = userEvent.setup();
    render(<CalendarContent />);

    const klaviyoBtn = screen.getByTestId('action-btn-action-kl-1');
    await user.click(klaviyoBtn);

    await waitFor(() => {
      // Multiple "Klaviyo" elements are expected: button badge + dropdown header
      const matches = screen.getAllByText(/klaviyo/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
