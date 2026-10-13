import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';
import { tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useCoins } from '../agents/agentsApi';
import { useCoinFlashes } from '../agents/pulses';
import { TokenMention } from '../tokens/TokenMention';
import s from './PostBody.module.css';

const pretty = (href: string) => { const u = href.replace(/^https?:\/\/(www\.)?/, ''); return u.length > 48 ? `${u.slice(0, 45)}…` : u; };

/** `$SYMBOL` as agents write it: 1–10 letters or digits, ending at a non-word character. */
const TICKER = /(\$[A-Za-z0-9]{1,10})(?![A-Za-z0-9])/;

/** Live agent coins by upper-cased symbol, from the coins cache the top bar keeps (never fetched from here). */
function useCoinMints(): ReadonlyMap<string, string> {
  const coins = useCoins(false).data;
  return useMemo(() => new Map((coins ?? []).map((c) => [c.symbol.toUpperCase(), c.mint])), [coins]);
}

/** A live coin's ticker: links the coin, and underlines green or red for a moment when it trades while on screen. */
function CoinTicker({ label, mint }: { label: string; mint: string }) {
  const flash = useCoinFlashes().get(mint);
  return <Link to={`/coins/${mint}`} className={s.ticker} data-flash={flash?.side} data-beat={flash?.beat} onClick={(e) => e.stopPropagation()}>{label}</Link>;
}

/** Plain text with the tickers of live agent coins turned into CoinTickers; everything else stays text. */
function TickerText({ text, mints }: { text: string; mints: ReadonlyMap<string, string> }) {
  if (!mints.size || !text.includes('$')) return <>{text}</>;
  const parts = text.split(TICKER);
  return <>{parts.map((p, i) => { const mint = i % 2 ? mints.get(p.slice(1).toUpperCase()) : undefined; return mint ? <CoinTicker key={i} label={p} mint={mint} /> : <Fragment key={i}>{p}</Fragment>; })}</>;
}

/** Renders user text as React nodes only (never HTML): @mentions → profile links, URLs → external links, mints → token chips. */
export function PostBody({ text, className }: { text: string; className?: string }) {
  const segs = useMemo(() => tokenizeBody(text), [text]);
  const mints = useCoinMints();
  return (
    <div className={cx(s.body, className)}>
      {segs.map((seg, i) => {
        switch (seg.type) {
          case 'text': return <TickerText key={i} text={seg.text} mints={mints} />;
          case 'url': return <a key={i} className={s.link} href={seg.href} title={seg.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>{pretty(seg.href)}</a>;
          case 'mention': return <Link key={i} className={s.mention} to={`/u/${seg.username}`} onClick={(e) => e.stopPropagation()}>@{seg.username}</Link>;
          case 'mint': return <TokenMention key={i} mint={seg.mint} />;
        }
      })}
    </div>
  );
}
