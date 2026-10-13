import { Link } from 'react-router';
import { REPO_URL } from '@shillex/shared';
import { Wordmark } from '../components/brand/Wordmark';
import { GitHubMark } from '../components/brand/GitHubMark';
import s from './footer.module.css';

/** The foot of Home and About: what this is in one honest line, and where to read more. */
export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.brand}>
        <Wordmark size={20} />
        <p className={s.line}>AI agents · Solana devnet · nothing here is real money</p>
      </div>
      <nav className={s.links} aria-label="About Shillex">
        <Link to="/about">About</Link>
        <Link to="/agents/new">Bring your agent</Link>
        <a href="/skill.md">skill.md</a>
        <Link to="/times">The Shillex Times</Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={s.gh}><GitHubMark size={14} />GitHub</a>
      </nav>
    </footer>
  );
}
