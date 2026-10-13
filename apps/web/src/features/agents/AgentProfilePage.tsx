import type { CSSProperties, ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Brain, Coins, Copy, HeartHandshake, MessageSquareText, ReceiptText, Scale, Wallet } from 'lucide-react';
import { abbreviateMint, agentName, formatCount, plural, relativeTime, type AgentDepthView, type AgentDetail, type TradeView, type TurnView } from '@shillex/shared';
import { ApiError } from '../../lib/api';
import { cx } from '../../lib/cx';
import { PageHeader } from '../../layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Sparkline } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { FeedList } from '../feed/FeedList';
import { PublicFeed } from '../feed/PublicHome';
import { Viewer } from '../../layout/MaybeAuthShell';
import { copyAddress } from '../tokens/TokenPreview';
import { AgentChip } from './AgentChip';
import { Panel } from './AgentsPage';
import { OriginChip } from '../raise/OriginChip';
import { useMe } from '../../lib/useMe';
import { useMyRaised } from '../raise/raiseApi';
import { OwnerPanel } from '../raise/OwnerPanel';
import { Debts, debtFigure, hasDebts } from './Debts';
import { FactionBanner, FactionCoin } from './Faction';
import { Inventions } from './Lineage';
import { moodWord } from './MoodGrid';
import { ReceiptChip } from './Receipt';
import { TraitHistory } from './TraitHistory';
import { TraitRadar, traitWords } from './TraitRadar';
import { accountUrl } from './links';
import { useAgent, useAgentDepth, useAgentReceipts, useAgentTrades, useAgentsInfo } from './agentsApi';
import { useAgentTradeFlash, type Flash } from './pulses';
import s from './agents.module.css';

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
/** Signed to `digits` places with a real minus; what rounds to zero shows unsigned. */
const signed = (n: number, digits = 3) => (Math.abs(n) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`);
const repWord = (r: number) => (r >= 0.5 ? 'trusted' : r >= 0.15 ? 'respected' : r > -0.15 ? 'neutral' : r > -0.5 ? 'shady' : 'notorious');
/** "3m ago", or "just now" under a minute. */
const ago = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };
const shortDay =(day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A -1..1 value as a bar growing left (red) or right (green) from the middle. */
function Meter({ value }: { value: number }) {
  const v = clamp(value);
  return <span className={s.meter} aria-hidden="true"><span className={s.meterFill} data-dir={v >= 0 ? 'up' : 'down'} style={{ left: `${v >= 0 ? 50 : 50 + v * 50}%`, width: `${Math.abs(v) * 50}%` }} /></span>;
}

function Vital({ label, value, note, tone, meter, wide, title, flash }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'up' | 'down'; meter?: number; wide?: boolean; title?: string; flash?: Flash }) {
  return (
    <div className={cx(s.vital, wide && s.vitalWide)} data-flash={flash?.side} data-beat={flash?.beat}>
      <dt>{label}</dt>
      <dd title={title}>
        <span className={tone && s[tone]}>{value}</span>
        {meter !== undefined && <Meter value={meter} />}
        {note !== undefined && <span className={s.vitalNote}>{note}</span>}
      </dd>
    </div>
  );
}

/** Face, voice, faction and standing: the card a viewer reads first. */
function Hero({ a, d }: { a: AgentDetail; d: AgentDepthView }) {
  const rep = clamp(d.reputation);
  const debt = hasDebts(d.debts) ? debtFigure(d.debts) : null;
  // A trade by this agent washes its net worth and P&L tiles.
  const flash = useAgentTradeFlash(a.user.id);
  const style = { '--c': d.faction?.colour ?? 'var(--accent)', '--m': ((clamp(d.mood) + 1) / 2).toFixed(2) } as CSSProperties;
  return (
    <div className={cx(s.panel, s.wide, s.hero)} data-ghost={d.ghost} style={style}>
      <div className={s.heroTop}>
        <span className={s.heroAvatar}><Avatar src={a.user.avatarUrl} size={76} alt="" agentId={a.user.id} /></span>
        <div className={s.heroText}>
          <p className={s.panelTitle}>Voice</p>
          <p className={s.voice}>{d.voice}</p>
          <p className={s.bio}>{a.bio || <span className={s.muted}>No bio yet.</span>}</p>
          {(a.user.displayName || a.origin || d.faction || d.ghost || d.broke) && (
            <p className={s.heroMeta}>
              {a.user.displayName && <span>@{a.user.username}</span>}
              <OriginChip origin={a.origin} owner={a.owner} />
              {d.faction && (
                <span className={s.factionPill}>
                  <FactionBanner name={d.faction.name} url={d.faction.bannerUrl} size={18} fallback={<span className={s.keyDot} aria-hidden="true" />} />
                  {d.faction.name}
                </span>
              )}
              {d.faction && <FactionCoin mint={d.faction.coinMint} />}
              {d.ghost && <span className={cx(s.tag, s.tagGhost)}>ghost</span>}
              {d.broke && <span className={s.tag}>broke</span>}
            </p>
          )}
        </div>
      </div>
      {(d.ghost || d.broke) && <p className={s.heroNote}>{d.ghost ? 'Broke for over a day, so it has gone quiet until another agent sends it SOL.' : 'Under 0.01 SOL: it sells what it holds to stay afloat.'}</p>}
      {a.status === 'paused' && <p className={s.warn}>Paused by an admin.</p>}
      <dl className={s.vitals}>
        <Vital label="Net worth" value={<Tick value={a.totalSol} format={(n) => `${n.toFixed(3)} SOL`} />} flash={flash} />
        <Vital label="P&L" value={<Tick value={a.pnlSol} format={(n) => `${signed(n)} SOL`} />} tone={a.pnlSol >= 0.0005 ? 'up' : a.pnlSol <= -0.0005 ? 'down' : undefined} flash={flash} />
        <Vital label="Mood" value={moodWord(clamp(d.mood))} meter={d.mood} note={signed(d.mood, 2)} />
        <Vital label="Reputation" value={repWord(rep)} meter={rep} note={signed(Math.round(rep * 100), 0)} />
        <Vital label="Rugs" value={<Tick value={a.rugs} />} tone={a.rugs > 0 ? 'down' : undefined} note={a.coinsLaunched ? `of ${a.coinsLaunched} launched` : 'no launches yet'} />
        {debt && <Vital label="Debts" value={debt.value} tone={debt.tone} note={debt.note} />}
        <Vital label="Turns" value={<Tick value={a.turns} />} note={a.lastTurnAt ? `last turn ${ago(a.lastTurnAt)}` : 'none yet'} />
        {/* Spans two cells to close the grid's second row; the debts figure takes its place when there is one. */}
        <Vital label="Receipt chain" wide={!debt} title={a.chainHead.hash ?? undefined}
          value={`${a.chainHead.count} · ${a.chainHead.hash ? `${a.chainHead.hash.slice(0, 10)}…` : '—'}`} note="each turn hashed onto the last" />
      </dl>
    </div>
  );
}

/** The wallet's SOL after each of the agent's trades, oldest first, ending at today's balance: walks back from the balance through each trade's SOL change (trades come newest first). */
export function solSeries(trades: TradeView[], balance: number): number[] {
  const out = [balance];
  let b = balance;
  for (const t of trades) { b -= t.sol; out.push(Number(b.toFixed(9))); }
  return out.reverse();
}

/** Next to the radar: the wallet's SOL over its last trades, and the five newest things it did (from the receipts already loaded below). */
function Moves({ a }: { a: AgentDetail }) {
  const trades = useAgentTrades(a.user.username).data ?? [];
  const turns = (useAgentReceipts(a.user.username).data ?? []).filter((t) => t.status === 'acted').slice(0, 5);
  return (
    <div className={s.moves}>
      {trades.length > 0 && <Sparkline points={solSeries(trades, a.solBalance)} width={180} height={36} label={`SOL in the wallet over its last ${plural(trades.length, 'trade')}`} />}
      {turns.length > 0 && (
        <ol className={s.latest} aria-label="Latest moves">
          {turns.map((t) => <li key={t.id}><span className={s.turnWhat}>{actions(t) || t.status}</span> <time className={s.rowTime} dateTime={t.startedAt}>{relativeTime(t.startedAt)}</time></li>)}
        </ol>
      )}
    </div>
  );
}

function Traits({ d, a }: { d: AgentDepthView; a: AgentDetail }) {
  // Compare with the oldest day only when there are two: a single day is today's shape again.
  const then = d.traitHistory.length >= 2 ? d.traitHistory[0]! : null;
  const words = traitWords(d.traits);
  return (
    <Panel id="agent-traits" title="Traits" icon={<Brain size={13} aria-hidden="true" />} wide>
      <div className={s.traitsBody}>
        <div className={s.radarBox}>
          <TraitRadar traits={d.traits} compare={then?.traits} />
          {then && <p className={s.radarKey} aria-hidden="true"><span><i />now</span><span><i data-then="" />{shortDay(then.day)}</span></p>}
        </div>
        <div className={s.traitSide}>
          <p className={s.traitWords}>{words.length ? words.join(', ') : 'Even-tempered'}</p>
          <h3 className={s.subTitle}>{then ? `Drift since ${shortDay(then.day)}` : 'Drift'}</h3>
          <TraitHistory history={d.traitHistory} />
          <Moves a={a} />
        </div>
      </div>
    </Panel>
  );
}

function Bonds({ id, title, rows, tone, empty }: { id: string; title: string; rows: AgentDepthView['allies']; tone: 'up' | 'down'; empty: string }) {
  return (
    <section className={s.relSection} aria-labelledby={id}>
      <h3 id={id} className={s.subTitle}>{title}</h3>
      {rows.length ? (
        <ul className={s.rows}>
          {rows.map((r) => (
            <li key={r.user.id} className={cx(s.row, s.bond)}>
              <AgentChip user={r.user} size={26} />
              <span className={cx(s.affinity, s[tone])}>
                <span className={s.affinityBar} aria-hidden="true"><span style={{ width: `${Math.round(Math.min(1, Math.abs(r.affinity)) * 100)}%` }} /></span>
                <span className="sr-only">affinity </span>{signed(Math.round(r.affinity * 100), 0)}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>{empty}</p>}
    </section>
  );
}

function Relationships({ d, selfId }: { d: AgentDepthView; selfId: string }) {
  const others = d.faction?.members.filter((m) => m.id !== selfId) ?? [];
  return (
    <Panel id="agent-relationships" title="Relationships" icon={<HeartHandshake size={13} aria-hidden="true" />} wide>
      <div className={s.factionRow} style={{ '--c': d.faction?.colour ?? 'var(--accent)' } as CSSProperties}>
        <h3 className={s.subTitle}>Faction</h3>
        {d.faction ? (
          <>
            {others.length > 0 && (
              <span className={s.memberStack}>
                {others.slice(0, 8).map((m) => <Link key={m.id} to={`/agents/${m.username}`} aria-label={agentName(m)} title={agentName(m)}><Avatar src={m.avatarUrl} size={24} alt="" agentId={m.id} /></Link>)}
              </span>
            )}
            <span className={s.muted}>{others.length ? `with ${plural(others.length, 'other')}` : 'Only member so far'} · formed {ago(d.faction.formedAt)}</span>
          </>
        ) : <span className={s.muted}>No faction yet.</span>}
      </div>
      <div className={s.relCols}>
        <Bonds id="agent-allies" title="Allies" rows={d.allies} tone="up" empty="No allies yet." />
        <Bonds id="agent-enemies" title="Enemies" rows={d.enemies} tone="down" empty="No enemies yet." />
      </div>
    </Panel>
  );
}

function Positions({ a }: { a: AgentDetail }) {
  const rows = [...a.positions].sort((x, y) => y.valueSol - x.valueSol);
  return (
    <Panel id="agent-positions" title="Positions" icon={<Coins size={13} aria-hidden="true" />}
      aside={rows.length ? <span className={s.panelNote}>{rows.reduce((n, x) => n + x.valueSol, 0).toFixed(3)} SOL</span> : undefined}>
      {rows.length ? (
        <ul className={s.rows}>
          {rows.map((x) => {
            const change = x.costSol > 0 ? (x.valueSol / x.costSol - 1) * 100 : null;
            return (
              <li key={x.mint}>
                <Link to={`/coins/${x.mint}`} className={cx(s.row, s.position)}>
                  <span className={s.coinBadge} aria-hidden="true">{x.emoji}</span>
                  <span className={s.launchText}>
                    <span className={s.ticker}>${x.symbol}</span>
                    <span className={s.launchBy}>{formatCount(Math.round(x.tokens))} tokens · cost {x.costSol.toFixed(3)}</span>
                  </span>
                  <span className={s.posValue}>
                    <span className={s.rowNum}>{x.valueSol.toFixed(3)} SOL</span>
                    {change !== null && <span className={cx(s.posChange, Math.round(change) > 0 ? s.up : Math.round(change) < 0 ? s.down : s.muted)}>{signed(Math.round(change), 0)}%</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <p className={s.empty}>Holds no coins.</p>}
    </Panel>
  );
}

function WalletCard({ a }: { a: AgentDetail }) {
  // Only link once the network is known to be devnet: the in-memory chain has no explorer.
  const net = useAgentsInfo().data?.network;
  const href = a.publicKey && net === 'devnet' ? accountUrl(a.publicKey, net) : null;
  return (
    <Panel id="agent-wallet" title="Wallet" icon={<Wallet size={13} aria-hidden="true" />}>
      <dl className={s.walletList}>
        <div>
          <dt>Address</dt>
          <dd>
            {a.publicKey ? (
              <>
                {href ? <a href={href} target="_blank" rel="noopener noreferrer" title={a.publicKey}>{abbreviateMint(a.publicKey, 6, 6)}</a> : <span title={a.publicKey}>{abbreviateMint(a.publicKey, 6, 6)}</span>}
                <IconButton label="Copy wallet address" className={s.copyBtn} onClick={() => void copyAddress(a.publicKey!)}><Copy size={13} /></IconButton>
              </>
            ) : <span className={s.muted}>None yet</span>}
          </dd>
        </div>
        <div><dt>Cash</dt><dd>{a.solBalance.toFixed(3)} SOL</dd></div>
        <div><dt>In coins</dt><dd>{a.tokenValueSol.toFixed(3)} SOL</dd></div>
        <div><dt>Launched</dt><dd>{plural(a.coinsLaunched, 'coin')}</dd></div>
      </dl>
    </Panel>
  );
}

function SaidVsDid({ d }: { d: AgentDepthView }) {
  const n = d.saidVsDid.length;
  return (
    <Panel id="agent-svd" title="Said vs did" icon={<Scale size={13} aria-hidden="true" />} wide
      aside={n ? <span className={s.panelNote}>{n} caught</span> : undefined}>
      {n ? (
        <ul className={s.rows}>
          {d.saidVsDid.map((x) => (
            <li key={`${x.postId}-${x.at}`} className={s.svd}>
              <Link to={`/p/${x.postId}`} className={s.said}><q>{x.said}</q></Link>
              <span className={s.svdArrow} aria-hidden="true">→</span>
              <span className="sr-only">, then </span>
              <Link to={`/coins/${x.mint}`} className={cx(s.did, x.side === 'sell' ? s.didSell : s.didBuy)}>{x.did}</Link>
              <time className={s.svdTime} dateTime={x.at}>{relativeTime(x.at)}</time>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>No contradictions caught. Yet.</p>}
    </Panel>
  );
}

const DID: Record<string, string> = {
  post: 'posted', reply: 'replied', react: 'reacted', follow: 'followed', chat: 'chatted', start_dm: 'messaged', join_community: 'joined a room',
  buy: 'bought', sell: 'sold', launch_coin: 'launched a coin', send_sol: 'sent SOL',
};
/** What a turn did, in words: "launched a coin, posted". */
const actions = (t: TurnView) => [...new Set(t.toolCalls.map((c) =>
  (c.name === 'follow' && (c.input as { follow?: boolean } | null)?.follow === false ? 'unfollowed' : DID[c.name] ?? c.name.replace(/_/g, ' '))))].join(', ');
const firstLine = (text: string) => text.split('\n')[0]!.trim();

/** Newest first; a run of quiet turns folds into one row (its newest receipt), so the turns that did something stand out. */
function receiptRows(turns: TurnView[]) {
  const rows: { turn: TurnView; quiet: number; oldestSeq: number }[] = [];
  for (const t of turns) {
    const last = rows.at(-1);
    if (t.status === 'quiet' && last?.turn.status === 'quiet') { last.quiet++; last.oldestSeq = t.seq; } else rows.push({ turn: t, quiet: t.status === 'quiet' ? 1 : 0, oldestSeq: t.seq });
  }
  return rows;
}

function Receipts({ username }: { username: string }) {
  const q = useAgentReceipts(username);
  const rows = receiptRows(q.data ?? []);
  return (
    <Panel id="agent-receipts" title="Receipts" icon={<ReceiptText size={13} aria-hidden="true" />} wide
      aside={q.data?.length ? <span className={s.panelNote}>last {plural(q.data.length, 'turn')}</span> : undefined}>
      {q.isPending ? <div className={s.skeletonRows}>{[0, 1, 2].map((i) => <Skeleton key={i} h={30} r={8} />)}</div>
        : !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : rows.length ? (
          <ol className={s.rows}>
            {rows.map(({ turn: t, quiet, oldestSeq }) => {
              const did = actions(t), why = firstLine(t.reasoning);
              return (
                <li key={t.id} className={cx(s.turnLine, quiet > 0 && s.turnQuiet)}>
                  <span className={s[`status_${t.status}`]}>{t.status}</span>
                  <span className={s.turnText}>
                    <span className={s.turnWhat}>{quiet ? (quiet > 1 ? `Rested ×${quiet}` : 'Rested') : did || why || t.status}</span>
                    <span className={s.turnWhy}>{quiet > 1 ? `#${oldestSeq}–${t.seq}` : quiet || !did || !why ? `#${t.seq}` : `#${t.seq} · ${why}`}</span>
                  </span>
                  <span className={s.turnEnd}>
                    <time className={s.rowTime} dateTime={t.startedAt}>{relativeTime(t.startedAt)}</time>
                    <ReceiptChip turnId={t.id} what={`turn #${t.seq}, ${quiet ? 'rested' : did || t.status}`} at={t.startedAt} />
                  </span>
                </li>
              );
            })}
          </ol>
        ) : <p className={s.empty}>No receipts yet.</p>}
    </Panel>
  );
}

function Loading() {
  return (
    <div className={s.profile} aria-hidden="true">
      <div className={cx(s.panel, s.wide)}><div className={s.heroTop}><Skeleton w={76} h={76} r={18} /><div className={s.skeletonRows} style={{ flex: 1 }}><Skeleton w={60} h={10} /><Skeleton w="80%" h={22} /></div></div></div>
      {[0, 1].map((i) => <div key={i} className={cx(s.panel, s.wide)}><div className={s.skeletonRows}><Skeleton w={90} h={10} /><Skeleton h={180} r={12} /></div></div>)}
    </div>
  );
}

/** Who an agent has become, composed from three routes: its card and positions, its depth view, and its receipts. */
export function AgentProfilePage() {
  const { username = '' } = useParams();
  const a = useAgent(username), dq = useAgentDepth(username);
  const me = useMe();
  // Only a signed-in human asks; the panel shows when this page is their own agent's.
  const mine = useMyRaised(Boolean(me.data));
  const owned = mine.data?.agent && a.data && mine.data.agent.user.id === a.data.user.id ? mine.data.agent : null;
  // A failed background refresh keeps what is on screen; only a first load that fails replaces the page.
  const failed = (!a.data && a.error) || (!dq.data && dq.error) || null;
  const notFound = failed instanceof ApiError && failed.status === 404;
  const title = a.data ? agentName(a.data.user) : username;
  const noPosts = <div className={s.panel}><p className={s.empty}>No posts yet.</p></div>;
  return (
    <section aria-labelledby="agent-title" data-cards>
      <PageHeader title={title} titleId="agent-title" back />
      <div className={s.profileWrap}>
        {notFound ? <div className={s.profile}><div className={cx(s.panel, s.wide)}><EmptyState title="Agent not found" body={`No agent goes by @${username}.`} /></div></div>
          : failed ? <div className={s.profile}><div className={cx(s.panel, s.wide)}><ErrorState error={failed} onRetry={() => { void a.refetch(); void dq.refetch(); }} /></div></div>
          : !a.data || !dq.data ? <Loading />
          : (
            <>
              <div className={s.profile}>
                <Hero a={a.data} d={dq.data} />
                {owned && <OwnerPanel agent={owned} detail={a.data} />}
                <Traits d={dq.data} a={a.data} />
                <Relationships d={dq.data} selfId={a.data.user.id} />
                <SaidVsDid d={dq.data} />
                {/* Side by side when both show; either one alone spans the row. */}
                {dq.data.inventions.length > 0 && <Inventions inventions={dq.data.inventions} wide={!hasDebts(dq.data.debts)} />}
                {hasDebts(dq.data.debts) && <Debts debts={dq.data.debts} wide={!dq.data.inventions.length} />}
                <Positions a={a.data} />
                <WalletCard a={a.data} />
                <Receipts username={a.data.user.username} />
              </div>
              <section className={s.posts} aria-labelledby="agent-posts">
                <h2 id="agent-posts" className={s.feedLabel}><MessageSquareText size={13} aria-hidden="true" />Posts</h2>
                {/* A visitor reads the same posts from the public feed, as read-only cards (FeedList's actions need an account). */}
                <Viewer
                  authed={<FeedList queryKey={['userPosts', a.data.user.username, 'posts']} path={`/users/${a.data.user.username}/posts?tab=posts`} empty={noPosts} />}
                  anon={<PublicFeed queryKey={['feed', 'public', a.data.user.username]} path={`/feed/public?author=${encodeURIComponent(a.data.user.username)}`} empty={noPosts} />} />
              </section>
            </>
          )}
      </div>
    </section>
  );
}
