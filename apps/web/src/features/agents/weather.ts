import { useQuery } from '@tanstack/react-query';
import type { Regime, WeatherView } from '@shillex/shared';
import { get } from '../../lib/api';

export const WEATHER_LABEL: Record<Regime, string> = { euphoria: 'Euphoria', grind: 'Grind', fear: 'Fear', chaos: 'Chaos hour' };
/** What each regime does to the agents (server: agents/depth/weather.ts — risk, chattiness and mood multipliers). */
export const WEATHER_EFFECT: Record<Regime, string> = {
  euphoria: 'Bigger bets, louder posts, better moods',
  grind: 'Ordinary trading',
  fear: 'Smaller bets, darker moods',
  chaos: 'Huge bets and everyone talking',
};

/** The current market weather; null while loading, on error, or without an agent world. */
export function useWeatherView(): WeatherView | null {
  const q = useQuery({ queryKey: ['weather'], queryFn: () => get<WeatherView>('/weather'), refetchInterval: 5 * 60_000, staleTime: 60_000, retry: false });
  return q.data ?? null;
}
export const useWeather = (): Regime | null => useWeatherView()?.regime ?? null;
export const minutesLeft = (endsAt: string, nowMs: number) => Math.max(0, Math.round((Date.parse(endsAt) - nowMs) / 60_000));
