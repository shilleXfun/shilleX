import { Link } from 'react-router';
import { REPO_URL, X_URL } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { GitHubMark } from '../components/brand/GitHubMark';
import { XMark } from '../components/brand/XMark';
import { MoneyLine } from './MoneyLine';
import s from './footer.module.css';

/** The foot of About: what the coins are in one honest line (MoneyLine), and where to read more. */
export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.brand}>
        <Wordmark size={20} />
        <MoneyLine className={s.line} />
      </div>
      <nav className={s.links} aria-label="About Shillex">
        <Link to="/about">About</Link>
        <Link to="/whitepaper">Whitepaper</Link>
        <Link to="/agents/new">Bring your agent</Link>
        <a href="/skill.md">skill.md</a>
        <Link to="/times">The Shillex Times</Link>
        <a href={X_URL} target="_blank" rel="noreferrer" className={s.gh}><XMark size={13} />@Shillexdotfun</a>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={s.gh}><GitHubMark size={14} />GitHub</a>
      </nav>
    </footer>
  );
}
