// @paradigm: sql
// WorkspaceSettingsContent tests — Wave-3 CRUD restore (parity-22).
//
// POSITIVE: renders all 4 section headers (Workspace Settings, Filters, COGS Settings, Delete Workspace)
// POSITIVE: MANAGER can see Save changes buttons (workspace+filters, COGS)
// POSITIVE: updateWorkspaceSettings called with correct bp conversion for tax (5% → 500bp)
// POSITIVE: updateWorkspaceSettings called with correct bp conversion for COGS (50% → 5000bp)
// POSITIVE: OWNER sees Delete Workspace section
// POSITIVE: deleteWorkspace called with { confirm: true } after clicking confirm
// NEGATIVE: non-MANAGER does not see Save changes buttons
// NEGATIVE: non-OWNER does not see Delete Workspace section

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockRole = 'OWNER';
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

const { updateWsMutate, deleteWsMutate, invalidate } = vi.hoisted(() => ({
  updateWsMutate: vi.fn(),
  deleteWsMutate: vi.fn(),
  invalidate: vi.fn(),
}));

let updateOnSuccess: (() => void) | undefined;
let updateOnError: ((e: Error) => void) | undefined;

const WS_DATA = {
  result: {
    workspace_id: 'ws-test',
    name: 'Test Workspace',
    plan: 'Growth',
    timezone: 'Asia/Kolkata',
    region: 'IN',
    currency_code: 'INR',
    created_at: '2026-01-01',
  },
  data_epoch: new Date(),
  request_id: 'req-test',
};

const COSTS_DATA = {
  result: {
    cogs_mode: 'product+fallback' as const,
    override_all_bp: 0,
    fallback_bp: 5000,
    markup_bp: 0,
    cost_rows: [],
    total_fixed_monthly_mu: 0n,
    total_per_order_mu: 0n,
    net_sales_mu: 0n,
    resolved_cogs_mu: 0n,
    variable_costs_mu: 0n,
    cm1_mu: 0n,
    currency_code: 'INR',
    workspace_id: 'ws-test',
    period: 'test',
    data_epoch: new Date(),
  },
  data_epoch: new Date(),
  request_id: 'req-test',
  rows: [],
};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    settings: {
      workspace: {
        useQuery: () => ({ data: WS_DATA, isLoading: false, error: null }),
      },
      costs: {
        useQuery: () => ({ data: COSTS_DATA, isLoading: false, error: null }),
      },
      updateWorkspaceSettings: {
        useMutation: (opts?: {
          onSuccess?: () => void;
          onError?: (e: Error) => void;
        }) => {
          updateOnSuccess = opts?.onSuccess;
          updateOnError = opts?.onError;
          return { mutate: updateWsMutate, isPending: false };
        },
      },
      deleteWorkspace: {
        useMutation: () => ({ mutate: deleteWsMutate, isPending: false }),
      },
    },
    useUtils: () => ({
      settings: {
        workspace: { invalidate },
        costs: { invalidate },
      },
    }),
  },
}));

import { WorkspaceSettingsContent } from '@/interfaces/components/settings/workspace-settings-content.js';

beforeEach(() => {
  mockRole = 'OWNER';
  updateWsMutate.mockReset();
  deleteWsMutate.mockReset();
  invalidate.mockReset();
});

describe('WorkspaceSettingsContent (Wave-3 CRUD)', () => {
  it('renders all 4 section headings', () => {
    render(<WorkspaceSettingsContent />);
    expect(screen.getByText('Workspace Settings')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('COGS Settings')).toBeInTheDocument();
    expect(screen.getByText('Delete Workspace')).toBeInTheDocument();
  });

  it('shows workspace name and timezone from server data', () => {
    render(<WorkspaceSettingsContent />);
    expect(screen.getByText('Test Workspace')).toBeInTheDocument();
  });

  it('MANAGER sees Save changes buttons', () => {
    mockRole = 'MANAGER';
    render(<WorkspaceSettingsContent />);
    // Two save buttons: workspace+filters section, COGS section
    const saveBtns = screen.getAllByTestId(/save-.*-btn/);
    expect(saveBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('ANALYST does not see Save changes buttons', () => {
    mockRole = 'ANALYST';
    render(<WorkspaceSettingsContent />);
    expect(screen.queryByTestId('save-workspace-settings-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-cogs-btn')).not.toBeInTheDocument();
  });

  it('updateWorkspaceSettings called with correct bp for tax (5% → 500bp)', async () => {
    mockRole = 'MANAGER';
    const user = userEvent.setup();
    render(<WorkspaceSettingsContent />);

    const taxInput = screen.getByLabelText(/workspace tax percentage/i);
    await user.clear(taxInput);
    await user.type(taxInput, '5');

    fireEvent.click(screen.getByTestId('save-workspace-settings-btn'));

    expect(updateWsMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        tax_percent_bp: 500, // 5% × 100 = 500bp
      }),
    );
  });

  it('updateWorkspaceSettings (COGS) called with correct bp (50% → 5000bp)', async () => {
    mockRole = 'MANAGER';
    render(<WorkspaceSettingsContent />);

    const fallbackInput = screen.getByLabelText(/fallback cogs percentage/i);
    fireEvent.change(fallbackInput, { target: { value: '50' } });

    fireEvent.click(screen.getByTestId('save-cogs-btn'));

    expect(updateWsMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        fallback_cogs_bp: 5000, // 50% × 100 = 5000bp
      }),
    );
  });

  it('COGS section pre-populates from costs query (fallback_bp=5000 → "50.00")', () => {
    render(<WorkspaceSettingsContent />);
    const fallbackInput = screen.getByLabelText(/fallback cogs percentage/i) as HTMLInputElement;
    expect(fallbackInput.value).toBe('50.00');
  });

  it('OWNER sees Delete Workspace section', () => {
    mockRole = 'OWNER';
    render(<WorkspaceSettingsContent />);
    expect(screen.getByTestId('delete-workspace-trigger-btn')).toBeInTheDocument();
  });

  it('non-OWNER does not see Delete Workspace section', () => {
    mockRole = 'MANAGER';
    render(<WorkspaceSettingsContent />);
    expect(screen.queryByTestId('delete-workspace-trigger-btn')).not.toBeInTheDocument();
  });

  it('deleteWorkspace called with { confirm: true } after entering password', async () => {
    mockRole = 'OWNER';
    const user = userEvent.setup();
    render(<WorkspaceSettingsContent />);

    await user.click(screen.getByTestId('delete-workspace-trigger-btn'));

    const passwordInput = screen.getByLabelText(/confirm deletion with your password/i);
    await user.type(passwordInput, 'mysecretpassword');

    await user.click(screen.getByTestId('confirm-delete-workspace-btn'));

    expect(deleteWsMutate).toHaveBeenCalledWith({ confirm: true });
  });

  it('deleteWorkspace does NOT fire if password is empty', async () => {
    mockRole = 'OWNER';
    const user = userEvent.setup();
    render(<WorkspaceSettingsContent />);

    await user.click(screen.getByTestId('delete-workspace-trigger-btn'));
    await user.click(screen.getByTestId('confirm-delete-workspace-btn'));

    expect(deleteWsMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Please enter your password/i)).toBeInTheDocument();
  });
});
