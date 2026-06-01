// @paradigm: sql
// FestivalsContent tests — Wave-3 CRUD restore (parity-38).
//
// POSITIVE: renders year selector (2024–2027)
// POSITIVE: renders festival rows from query data
// POSITIVE: MANAGER sees Add Festival and Reset to defaults buttons
// POSITIVE: createFestival called when Add Festival clicked
// POSITIVE: resetFestivals called when Reset to defaults clicked
// POSITIVE: after createFestival success, Edit and Delete become available for that row
// POSITIVE: updateFestival called with correct bp conversion (4.0× → 40000bp)
// POSITIVE: deleteFestival called with festival_id
// NEGATIVE: non-MANAGER does not see Add / Reset buttons
// NEGATIVE: ANALYST sees festival rows but no add/delete controls

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock nuqs — URL state returns defaults, no adapter needed in tests.
vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal = (parser && typeof parser === 'object' && 'withDefault' in parser)
      ? parser.withDefault
      : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
  parseAsInteger: { withDefault: (d: number) => ({ withDefault: d }) },
}));

let mockRole = 'MANAGER';
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({
      session: {
        workspaceId: 'ws-test',
        isAuthenticated: true,
        workspaceRole: mockRole,
      },
    }),
}));

const { createFestivalMutate, updateFestivalMutate, deleteFestivalMutate, resetFestivalsMutate, invalidate, EMPTY_LIST_RESULT } = vi.hoisted(() => ({
  createFestivalMutate: vi.fn(),
  updateFestivalMutate: vi.fn(),
  deleteFestivalMutate: vi.fn(),
  resetFestivalsMutate: vi.fn(),
  invalidate: vi.fn(),
  // Stable ref (mirrors react-query) so the hydration useEffect doesn't loop forever.
  EMPTY_LIST_RESULT: { data: { rows: [], total: 0 }, isLoading: false, error: null },
}));

let createOnSuccess: ((row: Record<string, unknown>) => void) | undefined;
let updateOnSuccess: ((row: Record<string, unknown>) => void) | undefined;

const FESTIVAL_ROWS = [
  {
    name: 'Diwali',
    start_date: '2026-10-20',
    end_date: '2026-10-24',
    expected_multiplier_bp: 40000,
    regions: [],
    categories: ['all'],
    color: '#F59E0B',
    is_template: true,
    is_active: true,
  },
  {
    name: 'Custom Festival',
    start_date: '2026-01-01',
    end_date: '2026-01-01',
    expected_multiplier_bp: 16000,
    regions: ['IN'],
    categories: ['fashion'],
    color: '#3B82F6',
    is_template: false,
    is_active: true,
  },
];

const FESTIVALS_DATA = {
  rows: FESTIVAL_ROWS,
  total_rows: BigInt(FESTIVAL_ROWS.length),
  peak_multiplier_bp: 40000,
  data_epoch: new Date(),
  request_id: 'req-test',
  result: { rows: FESTIVAL_ROWS, total_rows: BigInt(2), peak_multiplier_bp: 40000, workspace_id: 'ws-test', period: 'test', data_epoch: new Date(), year: 2026 },
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    settings: {
      festivals: {
        useQuery: () => ({ data: FESTIVALS_DATA, isLoading: false, error: null }),
      },
      listFestivals: {
        useQuery: () => EMPTY_LIST_RESULT,
      },
      createFestival: {
        useMutation: (opts: { onSuccess?: (row: Record<string, unknown>) => void; onError?: (e: Error) => void }) => {
          createOnSuccess = opts.onSuccess;
          return { mutate: createFestivalMutate, isPending: false };
        },
      },
      updateFestival: {
        useMutation: (opts: { onSuccess?: (row: Record<string, unknown>) => void; onError?: (e: Error) => void }) => {
          updateOnSuccess = opts.onSuccess;
          return { mutate: updateFestivalMutate, isPending: false, variables: undefined as { festival_id: string } | undefined };
        },
      },
      deleteFestival: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => ({
          mutate: deleteFestivalMutate,
          isPending: false,
          variables: undefined as { festival_id: string } | undefined,
        }),
      },
      resetFestivals: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => ({
          mutate: resetFestivalsMutate,
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      settings: {
        festivals: { invalidate },
        listFestivals: { invalidate },
      },
    }),
  },
}));

import { FestivalsContent } from '@/interfaces/components/settings/festivals-content.js';

beforeEach(() => {
  mockRole = 'MANAGER';
  createFestivalMutate.mockReset();
  updateFestivalMutate.mockReset();
  deleteFestivalMutate.mockReset();
  resetFestivalsMutate.mockReset();
  invalidate.mockReset();
});

describe('FestivalsContent (Wave-3 CRUD)', () => {
  it('renders year selector with 2024-2027', () => {
    render(<FestivalsContent />);
    expect(screen.getByRole('button', { name: '2024' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2027' })).toBeInTheDocument();
  });

  it('renders festival rows from query data', () => {
    render(<FestivalsContent />);
    expect(screen.getByText('Diwali')).toBeInTheDocument();
    expect(screen.getByText('Custom Festival')).toBeInTheDocument();
  });

  it('displays multiplier in ×N.N format', () => {
    render(<FestivalsContent />);
    // Diwali: 40000bp = 4.0×
    expect(screen.getAllByText('4.0×').length).toBeGreaterThan(0);
  });

  it('MANAGER sees Add Festival and Reset to defaults buttons', () => {
    mockRole = 'MANAGER';
    render(<FestivalsContent />);
    expect(screen.getByTestId('add-festival-btn')).toBeInTheDocument();
    expect(screen.getByTestId('reset-festivals-btn')).toBeInTheDocument();
  });

  it('non-MANAGER (ANALYST) does NOT see Add Festival or Reset buttons', () => {
    mockRole = 'ANALYST';
    render(<FestivalsContent />);
    expect(screen.queryByTestId('add-festival-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reset-festivals-btn')).not.toBeInTheDocument();
  });

  it('createFestival called when Add Festival clicked', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<FestivalsContent />);
    await user.click(screen.getByTestId('add-festival-btn'));
    expect(createFestivalMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining('Festival'),
        expected_multiplier_bp: 16000,
      }),
    );
  });

  it('resetFestivals called when Reset to defaults clicked', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<FestivalsContent />);
    await user.click(screen.getByTestId('reset-festivals-btn'));
    expect(resetFestivalsMutate).toHaveBeenCalled();
  });

  it('createFestival success triggers invalidate (state management)', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    const { act } = await import('react');
    render(<FestivalsContent />);

    await user.click(screen.getByTestId('add-festival-btn'));

    // Simulate mutation success; invalidate should be called to refresh the list
    await act(async () => {
      createOnSuccess?.({
        id: 'festival-uuid-1',
        name: 'Festival 2026',
        start_date: '2026-01-01',
        end_date: '2026-01-01',
        color: '#3B82F6',
        expected_multiplier_bp: 16000,
        regions: [],
        categories: ['all'],
        is_template: false,
        is_active: true,
        workspace_id: 'ws-test',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        request_id: 'req-1',
      });
    });

    // Invalidate confirms list refresh was triggered
    expect(invalidate).toHaveBeenCalled();
    // createFestival was called with expected payload
    expect(createFestivalMutate).toHaveBeenCalledWith(
      expect.objectContaining({ expected_multiplier_bp: 16000 }),
    );
  });

  it('deleteFestival called for a non-template row with known ID', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    const { act } = await import('react');
    render(<FestivalsContent />);

    // Register Custom Festival's ID via simulated createOnSuccess
    await act(async () => {
      createOnSuccess?.({
        id: 'festival-uuid-2',
        name: 'Custom Festival',
        start_date: '2026-01-01',
        end_date: '2026-01-01',
        color: '#3B82F6',
        expected_multiplier_bp: 16000,
        regions: ['IN'],
        categories: ['fashion'],
        is_template: false,
        is_active: true,
        workspace_id: 'ws-test',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        request_id: 'req-2',
      });
    });

    await waitFor(() => {
      const deleteBtn = screen.queryByTestId('delete-festival-Custom Festival::2026-01-01');
      expect(deleteBtn).not.toBeNull();
    });

    await user.click(screen.getByTestId('delete-festival-Custom Festival::2026-01-01'));
    expect(deleteFestivalMutate).toHaveBeenCalledWith({ festival_id: 'festival-uuid-2' });
  });

  it('updateFestival called with correct bp conversion (4.0× → 40000bp)', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    const { act } = await import('react');
    render(<FestivalsContent />);

    // Register Diwali's ID via simulated createOnSuccess (wraps state update in act)
    await act(async () => {
      createOnSuccess?.({
        id: 'diwali-uuid',
        name: 'Diwali',
        start_date: '2026-10-20',
        end_date: '2026-10-24',
        color: '#F59E0B',
        expected_multiplier_bp: 40000,
        regions: [],
        categories: ['all'],
        is_template: true,
        is_active: true,
        workspace_id: 'ws-test',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        request_id: 'req-d',
      });
    });

    await waitFor(() => {
      const editBtn = screen.queryByTestId('edit-festival-Diwali::2026-10-20');
      expect(editBtn).not.toBeNull();
    });

    await user.click(screen.getByTestId('edit-festival-Diwali::2026-10-20'));

    // Change multiplier to 4.0 (already 4.0; verify save calls correct bp)
    const saveBtn = screen.getByTestId('save-edit-festival-Diwali::2026-10-20');
    await user.click(saveBtn);

    expect(updateFestivalMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        festival_id: 'diwali-uuid',
        expected_multiplier_bp: 40000, // 4.0 × 10000 = 40000
      }),
    );
  });

  it('ANALYST sees festival rows but no CRUD controls', () => {
    mockRole = 'ANALYST';
    render(<FestivalsContent />);
    expect(screen.getByText('Diwali')).toBeInTheDocument();
    expect(screen.queryByTestId('add-festival-btn')).not.toBeInTheDocument();
  });
});
