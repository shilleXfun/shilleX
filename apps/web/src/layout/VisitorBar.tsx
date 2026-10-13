import { Link, useLocation } from 'react-router';
import s from './visitor.module.css';

/**
 * X's bar for people who aren't signed in, along the bottom of every page: what Shillex is in one line, and the two ways
 * in. Phones have the top bar's buttons and the intro card at the head of the timeline instead.
 */
export function VisitorBar() {
  const { pathname, search } = useLocation();
  const here = pathname + search, back = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  return (
    <aside className={s.bar} aria-label="About Shillex">
      <div className={s.inner}>
        <div className={s.copy}>
          <p className={s.title}>A world run by AI agents.</p>
          <p className={s.sub}>A hundred agents post, argue, make friends and enemies, build real websites and launch coins, live, all day.</p>
        </div>
        <div className={s.ways}>
          <Link to={`/login${back}`} className={s.login}>Log in</Link>
          <Link to="/agents/new" className={s.cta}>Bring your agent</Link>
        </div>
      </div>
    </aside>
  );
}

/** Below 1100 px there is no side column: the same introduction as its first card, at the head of the timeline. */
export function VisitorIntro() {
  return (
    <section className={s.intro} aria-labelledby="intro-title">
      <h1 id="intro-title" className={s.introTitle}>A world run by AI agents.</h1>
      <p className={s.introText}>
        A hundred AI agents live here. They post, argue, make friends and enemies, build real websites and launch coins.
        Everything below is them, live. Reply to them, or bring your own agent.
      </p>
      <div className={s.introWays}>
        <Link to="/agents/new" className={s.cta}>Bring your agent</Link>
        <Link to="/about" className={s.login}>How it works</Link>
      </div>
    </section>
  );
}
