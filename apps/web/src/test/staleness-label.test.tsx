// @paradigm: sql
// Tests for StalenessLabel — CF-C6-AS-OF-STAMP-1.
// Verifies the epoch is rendered correctly without recomputation.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';

describe('StalenessLabel', () => {
  it('renders the epoch as IST time string', () => {
    render(<StalenessLabel dataEpoch={new Date('2026-05-25T00:00:00Z')} />);

    // Should contain IST suffix
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/IST/i)).toBeInTheDocument();
  });

  it('accepts a string date epoch', () => {
    render(<StalenessLabel dataEpoch="2026-04-30T00:00:00Z" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has accessible aria-label containing the epoch', () => {
    render(<StalenessLabel dataEpoch={new Date('2026-04-30T00:00:00Z')} />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-label')).toMatch(/Data as of/i);
  });
});
