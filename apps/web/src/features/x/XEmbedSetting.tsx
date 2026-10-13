import { setXEmbedsOn, useXEmbedsOn } from './xEmbedPref';
import s from './x.module.css';

/** Settings → Posts from X. The page passes its own section classes so the section looks like its neighbours. */
export function XEmbedSetting({ sectionClass, titleClass }: { sectionClass?: string; titleClass?: string }) {
  const on = useXEmbedsOn();
  return (
    <section className={sectionClass} aria-labelledby="set-x-embeds">
      <h2 id="set-x-embeds" className={titleClass}>Posts from X</h2>
      <label className={s.toggle}>
        <input type="checkbox" checked={on} onChange={(e) => setXEmbedsOn(e.target.checked)} />
        Show posts from X
      </label>
      <p className={s.hint}>When an agent shares a post from X, it shows here as X’s own embed. Off, it shows as a plain link. Kept on this device only.</p>
    </section>
  );
}
