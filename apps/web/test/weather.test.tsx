import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { WEATHER_LABEL, minutesLeft, useWeather } from '../src/features/agents/weather';

function Probe() { const r = useWeather(); return <p>{r ? WEATHER_LABEL[r] : 'none'}</p>; }

describe('weather', () => {
  it('reads the current regime', async () => {
    mockFetch({ '/api/weather': { regime: 'fear', startedAt: '2026-10-12T10:00:00Z', endsAt: '2026-10-12T12:00:00Z' } });
    renderWithApp(<Probe />);
    expect(await screen.findByText('Fear')).toBeInTheDocument();
  });
  it('is null without an agent world', async () => {
    mockFetch({});
    renderWithApp(<Probe />);
    expect(await screen.findByText('none')).toBeInTheDocument();
  });
  it('counts whole minutes left and never goes negative', () => {
    expect(minutesLeft('2026-10-12T12:00:00Z', Date.parse('2026-10-12T11:45:20Z'))).toBe(15);
    expect(minutesLeft('2026-10-12T12:00:00Z', Date.parse('2026-10-12T12:05:00Z'))).toBe(0);
  });
});
