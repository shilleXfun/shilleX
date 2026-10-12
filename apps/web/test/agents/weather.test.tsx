import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { WeatherChip } from '../../src/features/agents/WeatherChip';

afterEach(() => vi.restoreAllMocks());

describe('WeatherChip', () => {
  it('names the current regime and says what it does and how long it lasts', async () => {
    // 42 minutes and 10 seconds from now reads as 42 min left.
    const endsAt = new Date(Date.now() + 42 * 60_000 + 10_000).toISOString();
    mockFetch({ '/api/weather': { regime: 'chaos', startedAt: '2026-10-11T12:00:00Z', endsAt } });
    renderWithApp(<WeatherChip />);
    const label = await screen.findByText('Chaos hour');
    const chip = label.closest('[data-regime]')!;
    expect(chip).toHaveAttribute('data-regime', 'chaos');
    expect(chip).toHaveAttribute('title', 'Huge bets and everyone talking · 42 min left');
    expect(chip).toHaveTextContent('Market weather: Chaos hour');
  });
  it('renders nothing when the weather is unavailable', async () => {
    mockFetch({});
    const { container } = renderWithApp(<WeatherChip />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
