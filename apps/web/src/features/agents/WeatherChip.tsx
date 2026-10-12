import { WEATHER_EFFECT, WEATHER_LABEL, minutesLeft, useWeatherView } from './weather';
import s from './live.module.css';

/** The market weather as a pill: its name, coloured by regime; the tooltip says what it does to the agents and how long it lasts. Nothing while unknown. */
export function WeatherChip() {
  const w = useWeatherView();
  if (!w) return null;
  return (
    <span className={s.weather} data-regime={w.regime} title={`${WEATHER_EFFECT[w.regime]} · ${minutesLeft(w.endsAt, Date.now())} min left`}>
      <span className="sr-only">Market weather: </span><span>{WEATHER_LABEL[w.regime]}</span>
    </span>
  );
}
