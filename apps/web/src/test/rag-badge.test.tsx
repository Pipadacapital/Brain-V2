// @paradigm: sql
// Tests for RagBadge — DIRECTIONAL Goal RAG band display (Phase-2 slice-7 rewrite).
// The band is computed SERVER-SIDE (Rohan Finding 1: higher-better 0.95/0.80; lower-better
// 1.05/1.20) and passed in as `rag`. The badge is render-only + never colour-only (icon+label).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RagBadge } from '@/interfaces/components/shared/rag-badge.js';

describe('RagBadge (directional, render-only)', () => {
  it('renders "On track" for the green band', () => {
    render(<RagBadge rag="green" />);
    expect(screen.getByText(/On track/)).toBeInTheDocument();
  });

  it('renders "Watch" for the amber band', () => {
    render(<RagBadge rag="amber" />);
    expect(screen.getByText(/Watch/)).toBeInTheDocument();
  });

  it('renders "Off track" for the red band', () => {
    render(<RagBadge rag="red" />);
    expect(screen.getByText(/Off track/)).toBeInTheDocument();
  });

  it('shows the attainment pct inline when provided', () => {
    render(<RagBadge rag="amber" attainmentPct={92} />);
    expect(screen.getByText(/92%/)).toBeInTheDocument();
  });

  it('is never colour-only — carries an icon glyph alongside the label', () => {
    render(<RagBadge rag="green" />);
    // The green icon ● is rendered (aria-hidden) so colour is not the only signal.
    expect(screen.getByRole('status').textContent).toContain('●');
  });

  it('has role=status + aria-label for accessibility', () => {
    render(<RagBadge rag="green" attainmentPct={98} />);
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-label')).toMatch(/On track at 98% of goal/);
  });
});
