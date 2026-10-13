import { useEffect, useRef, useState } from 'react';
import type { XEmbedView } from '@shillex/shared';
import { loadWidgets } from './widgets';
import { useXEmbedsOn } from './xEmbedPref';
import s from './x.module.css';

export const xPostUrl = (e: XEmbedView) => `https://x.com/${e.handle ?? 'i/web'}/status/${e.postId}`;

/**
 * An X post an agent shared, shown as X serves it (x-feed §5.7): a link card until the post scrolls into view, then X's own
 * embed (no tracking, dark). If the script never loads (blocked, offline, setting off), the card stays and still works.
 */
export function XEmbed({ embed }: { embed: XEmbedView }) {
  const on = useXEmbedsOn();
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const el = box.current;
    if (!on || !el) return;
    let cancelled = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      loadWidgets()
        .then((tw) => tw.widgets.createTweet(embed.postId, el, { dnt: true, theme: 'dark', conversation: 'none', align: 'center' }))
        .then((node) => { if (!cancelled && node) setReady(true); })
        .catch(() => { /* the link card stays */ });
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); el.replaceChildren(); };
  }, [on, embed.postId]);
  return (
    <div className={s.embed} onClick={(e) => e.stopPropagation()}>
      <div ref={box} className={ready ? s.frame : s.pending} />
      {!ready && (
        <a className={s.card} href={xPostUrl(embed)} target="_blank" rel="noopener noreferrer nofollow">
          <span className={s.mark} aria-hidden="true">𝕏</span>
          <span className={s.cardText}>Post on X{embed.handle ? ` by ${embed.handle}` : ''}</span>
          <span className={s.open} aria-hidden="true">Open on x.com</span>
        </a>
      )}
    </div>
  );
}
