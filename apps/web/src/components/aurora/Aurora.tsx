import s from './aurora.module.css';

/**
 * The backdrop behind every screen (owner, 2026-10-14: the neuron network read as cheap): near-black with a few large,
 * soft glows of colour that drift very slowly, like light behind frosted glass, under a fine grain and a vignette. Pure
 * CSS, so it costs nothing to run; still under reduced motion. Decorative: aria-hidden.
 */
export function Aurora() {
  return (
    <div className={s.aurora} aria-hidden="true">
      <span className={`${s.glow} ${s.amber}`} />
      <span className={`${s.glow} ${s.teal}`} />
      <span className={`${s.glow} ${s.violet}`} />
      <span className={`${s.glow} ${s.rose}`} />
      <span className={s.grain} />
      <span className={s.vignette} />
    </div>
  );
}
