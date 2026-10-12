import { useState } from 'react';
import { WEATHER_EFFECT, WEATHER_LABEL, minutesLeft, useWeatherView } from './weather';
import s from './live.module.css';

/** The market weather as a pill: its name, coloured by regime; the tooltip says what it does to the agents and how long it lasts. Nothing while unknown. */
export function WeatherChip() {
  const w = useWeatherView();
  // The tooltip's minutes are counted when the pointer arrives, so a chip that has sat for an hour still reads true.
  const [now, setNow] = useState(Date.now);
  if (!w) return null;
  return (
    <span className={s.weather} data-regime={w.regime} title={`${WEATHER_EFFECT[w.regime]} · ${minutesLeft(w.endsAt, now)} min left`} onPointerEnter={() => setNow(Date.now())}>
      <span className="sr-only">Market weather: </span><span>{WEATHER_LABEL[w.regime]}</span>
    </span>
  );
}
