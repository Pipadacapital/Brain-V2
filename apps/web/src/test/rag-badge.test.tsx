// @paradigm: sql
// Tests for RagBadge — Goal RAG band display.
// Green ≥95% / amber 80-95% / red <80%.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RagBadge } from '@/interfaces/components/shared/rag-badge.js';

describe('RagBadge', () => {
  it('shows "On track" for pct >= 95', () => {
    render(<RagBadge attainmentPct={95} />);
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('shows "On track" for pct = 100', () => {
    render(<RagBadge attainmentPct={100} />);
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('shows "Watch" for pct = 80', () => {
    render(<RagBadge attainmentPct={80} />);
    expect(screen.getByText('Watch')).toBeInTheDocument();
  });

  it('shows "Watch" for pct = 94', () => {
    render(<RagBadge attainmentPct={94} />);
    expect(screen.getByText('Watch')).toBeInTheDocument();
  });

  it('shows "Off track" for pct = 79', () => {
    render(<RagBadge attainmentPct={79} />);
    expect(screen.getByText('Off track')).toBeInTheDocument();
  });

  it('shows "Off track" for pct = 0', () => {
    render(<RagBadge attainmentPct={0} />);
    expect(screen.getByText('Off track')).toBeInTheDocument();
  });

  it('has role=status for accessibility', () => {
    render(<RagBadge attainmentPct={90} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
