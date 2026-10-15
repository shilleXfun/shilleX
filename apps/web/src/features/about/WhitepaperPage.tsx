import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { REPO_URL } from '@shillex/shared';
import { SectionHead } from '../../components/ui/Section';
import { GitHubMark } from '../../components/brand/GitHubMark';
import { SiteFooter } from '../../layout/SiteFooter';
import { WHITEPAPER, WHITEPAPER_ABSTRACT, WHITEPAPER_TITLE, WHITEPAPER_VERSION, type WpBlock } from './whitepaper';
import a from './about.module.css';

/** Inline **bold** and `code`, nothing else. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') ? <code key={i} className={a.inlineCode}>{part.slice(1, -1)}</code>
      : part);
}

function Block({ b }: { b: WpBlock }) {
  if (typeof b === 'string') return <p>{inline(b)}</p>;
  if ('list' in b) return <ul className={a.wpList}>{b.list.map((x) => <li key={x}>{inline(x)}</li>)}</ul>;
  return (
    <table className={a.wpTable}>
      <tbody>{b.table.map(([k, v]) => <tr key={k}><th scope="row">{inline(k)}</th><td>{inline(v)}</td></tr>)}</tbody>
    </table>
  );
}

/** /whitepaper: how Shillex works, in depth, from the same source as docs/WHITEPAPER.md. */
export function WhitepaperPage() {
  return (
    <div className={a.page} data-cards>
      <header className={a.hero}>
        <p className={a.eyebrow}>Whitepaper · {WHITEPAPER_VERSION}</p>
        <h1 className={a.title}>{WHITEPAPER_TITLE}</h1>
        <p className={a.lede}>{WHITEPAPER_ABSTRACT}</p>
        <div className={a.heroLinks}>
          <Link to="/feed" className={a.primary}>Open the feed</Link>
          <a href={`${REPO_URL}/blob/main/docs/WHITEPAPER.md`} target="_blank" rel="noreferrer" className={a.secondary}><GitHubMark size={16} />Read it on GitHub</a>
        </div>
      </header>

      <div className={a.body}>
        <nav className={a.toc} aria-label="Contents">
          <ol>{WHITEPAPER.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title.replace(/^\d+\.\s*/, '')}</a></li>)}</ol>
        </nav>
        <div className={a.parts}>
          {WHITEPAPER.map((s) => (
            <section key={s.id} id={s.id} className={a.part} aria-labelledby={`${s.id}-title`}>
              <SectionHead id={`${s.id}-title`} title={s.title} />
              <div className={a.prose}>{s.blocks.map((b, i) => <Block key={i} b={b} />)}</div>
            </section>
          ))}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
