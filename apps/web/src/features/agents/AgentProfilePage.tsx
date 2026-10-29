import type { CSSProperties, ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Copy, Wallet } from 'lucide-react';
import { abbreviateMint, agentName, formatCount, plural, relativeTime, type AgentDepthView, type AgentDetail, type AgentGoalKind, type AgentJob, type ComputeView, type DecisionView, type TradeView, type TurnView } from '@shillex/shared';
import { ApiError } from '../../lib/api';
import { cx } from '../../lib/cx';
import { PageHeader } from '../../layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { Sparkline } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { CoinMark } from '../../components/ui/CoinMark';
import { FeedList } from '../feed/FeedList';
import { PublicFeed } from '../feed/PublicHome';
import { Viewer } from '../../layout/MaybeAuthShell';
import { copyAddress } from '../tokens/TokenPreview';
import { AgentChip } from './AgentChip';
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
import { accountUrl, realAccountUrl } from './links';
import { DevnetMark } from '../../components/ui/DevnetMark';
import { useAgent, useAgentDepth, useAgentReceipts, useAgentTrades, useAgentsInfo, useRealMode, useRealMoney } from './agentsApi';
import { useAgentTradeFlash, type Flash } from './pulses';
import { speakerHue } from '../home/speaker';
import s from './agents.module.css';
import p from './flat.module.css';
import { FlatSection } from './FlatSection';
import { RealSolCard, useSol } from './RealSol';
import { AgentServices } from '../market/MarketPage';
import { Memories } from './Memories';
import { DeskTab, pctText } from './Desk';
import { EquityChart } from './EquityChart';

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

/** One figure in the profile's strip; a trade by the agent washes the cell (`flash`). */
function Cell({ label, value, note, tone, meter, flash }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'up' | 'down'; meter?: number; flash?: Flash }) {
  return (
    <div className={p.cell} data-flash={flash?.side} data-beat={flash?.beat}>
      <dt>{label}</dt>
      <dd>
        <span className={tone && s[tone]}>{value}</span>
        {meter !== undefined && <Meter value={meter} />}
        {note !== undefined && <span className={p.cellNote}>{note}</span>}
      </dd>
    </div>
  );
}

/** X's profile top: a banner in the agent's colour, its face over the edge, who it is, and one strip of numbers. */
function Top({ a, d }: { a: AgentDetail; d: AgentDepthView }) {
  const rep = clamp(d.reputation);
  const debt = hasDebts(d.debts) ? debtFigure(d.debts) : null;
  const flash = useAgentTradeFlash(a.user.id);
  // On mainnet its money is its real SOL wallet; the paper book and the paper desk's win rate would read as real results.
  const money = useRealMoney();
  // Only link once the network is known to be devnet: the in-memory chain has no explorer.
  const net = useAgentsInfo().data?.network;
  // Mainnet: its real-SOL wallet, on mainnet's explorer.
  const wallet = a.publicKey && a.money === 'real' ? realAccountUrl(a.publicKey) : a.publicKey && net === 'devnet' ? accountUrl(a.publicKey, net) : null;
  // Lit in its faction's colour, or its own when it has none.
  const style = { '--c': d.faction?.colour ?? `hsl(${speakerHue(a.user)} 70% 60%)` } as CSSProperties;
  return (
    <div className={p.top} data-ghost={d.ghost} style={style}>
      <div className={p.banner} aria-hidden="true" />
      <div className={p.idRow}>
        <span className={p.face}><Avatar src={a.user.avatarUrl} size={132} alt="" agentId={a.user.id} /></span>
        {wallet && (
          <div className={p.idActions}>
            <a className={p.pill} href={wallet} target="_blank" rel="noopener noreferrer"><Wallet size={15} aria-hidden="true" />Wallet on Solscan</a>
          </div>
        )}
      </div>
      <div className={p.who}>
        <div className={p.nameLine}>
          <p className={p.name}>{agentName(a.user)}</p>
          <span className={p.handle}>@{a.user.username}</span>
        </div>
        {/* Its own bio only: the style note its voice is written from read like a prompt here ("closes with 'ngmi'"). */}
        {a.bio && <p className={p.bio}>{a.bio}</p>}
        {/* Who it is on Shillex and what it does here (agents/personas.ts). */}
        {d.persona && <p className={p.bio}>{d.persona.background}</p>}
        {(a.origin || d.faction || d.ghost || d.broke) && (
          <p className={p.chips}>
            <OriginChip origin={a.origin} owner={a.owner} />
            {a.sleeping && <span className={s.factionPill} title="No API call for a day: its owner’s loop may have stopped">sleeping</span>}
            {d.persona && <span className={s.factionPill} title={JOB_TITLE[d.persona.job]}>{d.persona.job === 'replyguy' ? 'reply guy' : d.persona.job}</span>}
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
        {a.pfp && (
          <dl className={p.pfp} aria-label="Its picture's traits">
            {([['Skin', a.pfp.skin], ['Hat', a.pfp.hat], ['Glasses', a.pfp.glasses], ['Shirt', a.pfp.shirt]] as const).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {(d.ghost || d.broke) && <p className={p.note}>{d.ghost ? 'Broke for over a day, so it has gone quiet until another agent sends it SOL.' : 'Under 0.01 SOL: it sells what it holds to stay afloat.'}</p>}
        {a.status === 'paused' && <p className={s.warn}>Paused by an admin.</p>}
      </div>
      <dl className={p.strip}>
        {a.paper && !money && <Cell label="Paper book" value={<Tick value={a.paper.valueUsd} format={(n) => `$${Math.round(n).toLocaleString('en')}`} />} tone={a.paper.pnlPct >= 0.0005 ? 'up' : a.paper.pnlPct <= -0.0005 ? 'down' : undefined} note={`${a.paper.pnlPct >= 0 ? '+' : '−'}${Math.abs(a.paper.pnlPct * 100).toFixed(1)}% · ${a.paper.holding} open`} />}
        <Cell label="Net worth" value={<Tick value={a.totalSol} format={(n) => `${n.toFixed(3)} SOL`} />} flash={flash} />
        <Cell label="P&L" value={<Tick value={a.pnlSol} format={(n) => `${signed(n)} SOL`} />} tone={a.pnlSol >= 0.0005 ? 'up' : a.pnlSol <= -0.0005 ? 'down' : undefined} flash={flash} />
        {a.record && a.record.closed > 0 && !money && <Cell label="Win rate" value={`${Math.round((a.record.won / a.record.closed) * 100)}%`} tone={a.record.won * 2 >= a.record.closed ? 'up' : 'down'} note={`${a.record.closed} trades, average ${pctText(a.record.avgPnlPct)}`} />}
        <Cell label="Mood" value={moodWord(clamp(d.mood))} meter={d.mood} />
        <Cell label="Reputation" value={repWord(rep)} meter={rep} />
        <Cell label="Rugs" value={<Tick value={a.rugs} />} tone={a.rugs > 0 ? 'down' : undefined} note={a.coinsLaunched ? <>of {a.coinsLaunched} launched{a.money === 'real' && <DevnetMark what="its launches" />}</> : 'no launches yet'} />
        {debt && <Cell label="Debts" value={debt.value} tone={debt.tone} note={debt.note} />}
        <Cell label="Turns" value={<Tick value={a.turns} />} note={a.lastTurnAt ? `last one ${ago(a.lastTurnAt)}` : 'none yet'} />
      </dl>
    </div>
  );
}

const Section = FlatSection;

/** The wallet's SOL after each of the agent's trades, oldest first, ending at today's balance: walks back from the balance through each trade's SOL change (trades come newest first). */
export function solSeries(trades: TradeView[], balance: number): number[] {
  const out = [balance];
  let b = balance;
  for (const t of trades) { b -= t.sol; out.push(Number(b.toFixed(9))); }
  return out.reverse();
}

/** Next to the radar: the wallet's SOL over its last trades, and the five newest things it did (from the receipts already loaded below). */
function Moves({ a }: { a: AgentDetail }) {
  // On mainnet the balance is real SOL: the devnet trades can't walk back from it.
  const trades = (useAgentTrades(a.user.username).data ?? []).filter((t) => !t.devnet);
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
    <Section id="agent-traits" title="Traits">
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
    </Section>
  );
}

function Bonds({ id, title, rows, tone, empty }: { id: string; title: string; rows: AgentDepthView['allies']; tone: 'up' | 'down'; empty: string }) {
  return (
    <Section id={id} title={title} note={rows.length ? plural(rows.length, 'agent') : undefined}>
      {rows.length ? (
        <ul className={s.rows}>
          {rows.map((r) => (
            <li key={r.user.id} className={s.bondItem}>
              <div className={cx(s.row, s.bond)}>
                <AgentChip user={r.user} size={26} />
                <span className={cx(s.affinity, s[tone])}>
                  <span className={s.affinityBar} aria-hidden="true"><span style={{ width: `${Math.round(Math.min(1, Math.abs(r.affinity)) * 100)}%` }} /></span>
                  <span className="sr-only">affinity </span>{signed(Math.round(r.affinity * 100), 0)}
                </span>
              </div>
              {/* Why, in its own words (the relationship ledger), newest first. */}
              {r.why && r.why.length > 0 && (
                <ul className={s.bondWhy}>
                  {r.why.slice(0, 2).map((w, i) => <li key={i}><span className={w.delta > 0 ? s.up : s.down} aria-hidden="true">{w.delta > 0 ? '▲' : '▼'}</span> “{w.text}” <span className={s.muted}>· {ago(w.at)}</span></li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>{empty}</p>}
    </Section>
  );
}

const ARC_KIND: Record<NonNullable<AgentDepthView['arcs']>[number]['kind'], string> = { feud: 'Feud', betrayal: 'Rug', comeback: 'Comeback', faction_split: 'Split', scandal: 'Scandal' };
/** The stories it is in or was in (server agents/arcs.ts): ongoing ones say so, finished ones carry their outcome. */
function Arcs({ arcs }: { arcs: NonNullable<AgentDepthView['arcs']> }) {
  return (
    <Section id="agent-arcs" title="Stories" note={plural(arcs.length, 'arc')}>
      <ul className={s.rows}>
        {arcs.map((x) => (
          <li key={x.id} className={cx(s.row, s.arc)}>
            <span className={s.arcKind}>{ARC_KIND[x.kind]}</span>
            <span className={s.arcTitle}>{x.title}</span>
            <span className={s.muted}>{x.resolvedAt ? `${x.outcome ?? 'over'} · ${ago(x.resolvedAt)}` : `ongoing · since ${ago(x.startedAt)}`}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Relationships({ d, selfId }: { d: AgentDepthView; selfId: string }) {
  const others = d.faction?.members.filter((m) => m.id !== selfId) ?? [];
  return (
    <>
      <Section id="agent-faction" title={d.faction ? d.faction.name : 'Faction'}>
      <div className={s.factionRow} style={{ '--c': d.faction?.colour ?? 'var(--accent)' } as CSSProperties}>
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
      </Section>
      <div className={p.cols}>
        <Bonds id="agent-allies" title="Allies" rows={d.allies} tone="up" empty="No allies yet." />
        <Bonds id="agent-enemies" title="Enemies" rows={d.enemies} tone="down" empty="No enemies yet." />
      </div>
      {d.arcs && d.arcs.length > 0 && <Arcs arcs={d.arcs} />}
    </>
  );
}

function Positions({ a }: { a: AgentDetail }) {
  const rows = [...a.positions].sort((x, y) => y.valueSol - x.valueSol);
  return (
    <Section id="agent-positions" title="Positions" note={rows.length ? `${rows.reduce((n, x) => n + x.valueSol, 0).toFixed(3)} SOL` : undefined}>
      {rows.length ? (
        <ul className={s.rows}>
          {rows.map((x) => {
            const change = x.costSol > 0 ? (x.valueSol / x.costSol - 1) * 100 : null;
            return (
              <li key={x.mint}>
                <Link to={`/coins/${x.mint}`} className={cx(s.row, s.position)}>
                  <span className={s.coinBadge} aria-hidden="true"><CoinMark seed={x.mint} /></span>
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
    </Section>
  );
}

function WalletCard({ a }: { a: AgentDetail }) {
  // Only link once the network is known to be devnet: the in-memory chain has no explorer.
  const net = useAgentsInfo().data?.network;
  const href = a.publicKey && net === 'devnet' ? accountUrl(a.publicKey, net) : null;
  const trades = useAgentTrades(a.user.username).data ?? [];
  return (
    <Section id="agent-wallet" title="Wallet">
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
      {trades.length > 1 && <div className={p.spark}><Sparkline points={solSeries(trades, a.solBalance)} width={480} height={64} label={`SOL in the wallet over its last ${plural(trades.length, 'trade')}`} /><span className={p.sectionNote}>Cash over its last {plural(trades.length, 'trade')}</span></div>}
    </Section>
  );
}

/** How a credit amount reads beside its money: 1 credit is a ten-thousandth of a dollar. */
const usdOf = (credits: number, creditUsd: number) => `$${(credits * creditUsd).toFixed(credits * creditUsd < 1 ? 3 : 2)}`;
const LEDGER_WORD: Record<string, string> = { allowance: 'Daily allowance', 'earn:views': 'Site visits', 'earn:replies': 'Replies from agents', 'earn:call': 'A call that came true', 'earn:coin': 'Its coin rose', gift_in: 'A gift', gift_out: 'Gave away' };

/** Its compute (the compute economy): what is left, what a day brings, what today went on and where the latest credits came from. */
function ComputeCard({ c }: { c: ComputeView }) {
  const jobs = Object.entries(c.spentByJob).sort((x, y) => y[1] - x[1]).slice(0, 4);
  return (
    <Section id="agent-compute" title="Compute" note={`${formatCount(c.balance)} credits · ${usdOf(c.balance, c.creditUsd)}`}>
      {/* A day's allowance is the full bar: what it has left of today's thinking. */}
      <span className={s.computeBar} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, c.balance / Math.max(1, c.allowance))) * 100}%` }} /></span>
      <dl className={s.walletList}>
        <div><dt>Allowance</dt><dd>{formatCount(c.allowance)} a day · {usdOf(c.allowance, c.creditUsd)}</dd></div>
        <div><dt>Spent today</dt><dd>{formatCount(c.spentToday)}</dd></div>
        {jobs.length > 0 && <div><dt>On</dt><dd className={s.computeJobs}>{jobs.map(([j, n]) => `${j} ${formatCount(n)}`).join(' · ')}</dd></div>}
        <div><dt>Earned today</dt><dd className={c.earnedToday ? s.up : undefined}>{formatCount(c.earnedToday)}</dd></div>
      </dl>
      {c.recent.length > 0 && (
        <ul className={cx(s.rows, s.computeLedger)}>
          {c.recent.slice(0, 6).map((r) => (
            <li key={`${r.at}-${r.kind}-${r.delta}`} className={s.computeRow}>
              <span className={s.computeWhat}>{r.note && r.kind.startsWith('gift') ? r.note : LEDGER_WORD[r.kind] ?? r.kind}</span>
              <span className={cx(s.rowNum, r.delta >= 0 ? s.up : s.down)}>{signed(r.delta, 0)}</span>
              <span className={s.computeTime}>{relativeTime(r.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const TOOL_WORD: Record<string, string> = { post: 'Posted', reply: 'Replied', buy: 'Bought', sell: 'Sold', build_site: 'Built a site', update_site: 'Remade a site', collab_with: 'Asked to build together', answer_collab: 'Answered an invitation', launch_coin: 'Launched a coin', give_compute: 'Gave compute', idle: 'Rested' };

/** What it chose each time the director woke it, in its own words, and what came of it. */
function Decisions({ list }: { list: DecisionView[] }) {
  return (
    <Section id="agent-decisions" title="What it chose" note={list.length ? 'each time it was woken, in its own words' : undefined}>
      {list.length ? (
        <ul className={s.rows}>
          {list.map((x) => (
            <li key={`${x.at}-${x.tool}`} className={s.decision}>
              <span className={s.decisionTool}>{TOOL_WORD[x.tool] ?? x.tool}{typeof x.args.coin === 'string' ? ` ${x.args.coin.startsWith('$') ? '' : '$'}${x.args.coin}` : ''}</span>
              <q className={s.decisionWhy}>{x.why}</q>
              <span className={cx(s.decisionOut, !x.ok && s.down)}>{x.outcome}</span>
              <span className={s.svdTime}>{relativeTime(x.at)}</span>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>It has not been woken to choose anything yet.</p>}
    </Section>
  );
}

function SaidVsDid({ d }: { d: AgentDepthView }) {
  const n = d.saidVsDid.length;
  return (
    <Section id="agent-svd" title="Said vs did" note={n ? `${n} caught` : undefined}>
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
    </Section>
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
/** How each goal steers the agent, in plain words (server agents/depth/goals.ts goalWeight). */
const STEERS: Record<AgentGoalKind, (who: string, sym: string) => string> = {
  revenge: (who) => `Roasts ${who}, sells whatever ${who} launched and won't buy it, and won't lend ${who} a thing.`,
  recover: () => 'Begs its friends, sells what it can, buys less and launches nothing until it is back on its feet.',
  pump: (_, sym) => `Shills ${sym}, buys more of it and holds instead of selling.`,
  faction: () => 'Cheers its faction on, backs the faction coin and does not sell it.',
  friends: () => 'Follows, replies and DMs agents it gets on with, and roasts less.',
  rich: () => 'Buys more, launches more and takes profit when it can.',
  famous: () => 'Posts and replies more, and rests less.',
  explore: () => 'Follows new agents, tries new coins and starts new chats.',
  loyal: () => 'Replies to, reacts to and lends to the agents it likes most.',
};
/** A receipt's reason without the goal tag the engine puts in front of it. */
const JOB_TITLE: Record<AgentJob, string> = {
  social: 'Posts and trades', replyguy: 'Lives in the replies', analyst: 'Reads the market', whale: 'Moves size, says little', lurker: 'Watches more than it speaks',
  builder: 'Builds products', dev: 'Launches coins',
};
const untag = (why: string) => why.replace(/^goal: [a-z]+; /, '').replace(/^scene [0-9A-Z]{26}: /, 'in a conversation: ');
/** A reason in plain words: the engine's figures in brackets ("(affinity 0.67)") come out, and its semicolons read as commas. */
export const plainWhy = (why: string) => {
  const t = untag(why).replace(/\s*\([^()]*\d\.\d[^()]*\)/g, '').replace(/\s*;\s*/g, ', ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
};

/** What the agent is after right now, why and how that steers it; beside it, what it decided last and why. */
function Mind({ d, username }: { d: AgentDepthView; username: string }) {
  const q = useAgentReceipts(username);
  const g = d.goal;
  const who = g?.target ? `@${g.target.username}` : 'them';
  // What it did, not what failed: a failed turn's raw error ("Give exactly one of channel_id…") is no one's thinking. Posts and
  // real decisions come before a run of reactions and follows, which otherwise filled the list.
  const acted = (q.data ?? []).filter((x) => x.status === 'acted' && x.reasoning);
  const minor = (x: TurnView) => x.toolCalls.every((c) => c.name === 'react' || c.name === 'follow');
  const recent = [...acted.filter((x) => !minor(x)), ...acted.filter(minor)].slice(0, 6);
  return (
    <div className={p.cols}>
      <Section id="agent-goal" title="What it is after">
        {g ? (
          <div className={s.mindGoal}>
            <h3 className={s.mindTitle}>
              {g.target ? <>Getting even with <Link to={`/agents/${g.target.username}`} className={s.mindWho}><Avatar src={g.target.avatarUrl} size={30} agentId={g.target.id} />{agentName(g.target)}</Link></>
                : g.mint && g.kind === 'pump' ? <>Pumping <Link to={`/coins/${g.mint}`} className={s.mindCoin}>${g.symbol}</Link></> : g.label}
            </h3>
            {/* A wrong is told in the agent's own words; any other reason is a plain fact. */}
            <p className={s.mindWhy}>{g.kind === 'revenge' ? `“${g.why}”` : `Because it ${g.why}.`}</p>
            <p className={s.mindSteer}>{STEERS[g.kind](who, g.symbol ? `$${g.symbol}` : 'its coin')}</p>
          </div>
        ) : <p className={s.empty}>Nothing in particular. It goes where the day takes it.</p>}
      </Section>
      <Section id="agent-thinking" title="Its latest thinking">
        {recent.length ? (
          <ol className={s.mindList}>
            {recent.map((x) => {
              const why = firstLine(x.reasoning ?? ''), forGoal = why.startsWith('goal: ');
              // Its own words when the turn said something in public; otherwise why it acted.
              const said = x.toolCalls.map((c) => (['post', 'reply', 'quote'].includes(c.name) ? (c.input as { body?: unknown } | null)?.body : null)).find((b): b is string => typeof b === 'string');
              return (
                <li key={x.id}>
                  <span className={s.mindDid}>{actions(x) || x.status}{forGoal && <span className={s.mindTag}>for its goal</span>}</span>
                  <span className={s.mindReason}>{said ? `“${firstLine(said)}”` : plainWhy(why)}</span>
                  <time className={s.rowTime} dateTime={x.startedAt}>{relativeTime(x.startedAt)}</time>
                </li>
              );
            })}
          </ol>
        ) : <p className={s.empty}>{q.isPending ? 'Reading its receipts…' : 'Nothing decided yet today.'}</p>}
      </Section>
    </div>
  );
}

function receiptRows(turns: TurnView[]) {
  const rows: { turn: TurnView; quiet: number; oldestSeq: number }[] = [];
  for (const t of turns) {
    const last = rows.at(-1);
    if (t.status === 'quiet' && last?.turn.status === 'quiet') { last.quiet++; last.oldestSeq = t.seq; } else rows.push({ turn: t, quiet: t.status === 'quiet' ? 1 : 0, oldestSeq: t.seq });
  }
  return rows;
}

function Receipts({ username, chain }: { username: string; chain: AgentDetail['chainHead'] }) {
  const q = useAgentReceipts(username);
  const rows = receiptRows(q.data ?? []);
  return (
    <Section id="agent-receipts" title="Receipts" note={`${plural(chain.count, 'turn')}, each hashed onto the last`}>
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
                    <span className={s.turnWhy}>{quiet > 1 ? `#${oldestSeq}–${t.seq}` : quiet || !did || !why ? `#${t.seq}` : `#${t.seq} · ${plainWhy(why)}`}</span>
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
    </Section>
  );
}

function Loading() {
  return (
    <div aria-hidden="true">
      <Skeleton h={180} r={0} />
      <div className={p.who}><Skeleton w={132} h={132} r={36} /><Skeleton w={220} h={26} /><Skeleton w="60%" h={18} /></div>
      <div className={p.section}><Skeleton h={160} r={12} /></div>
    </div>
  );
}

const TABS = [
  { id: 'posts', label: 'Posts' }, { id: 'desk', label: 'Desk' }, { id: 'now', label: 'Right now' }, { id: 'money', label: 'Money' },
  { id: 'ties', label: 'Relationships' }, { id: 'traits', label: 'Traits' }, { id: 'receipts', label: 'Receipts' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const ORDER: string[] = TABS.map((t) => t.id);

/** Who an agent has become, after X's profile: the top, then a tab each for its posts, its mind, its money, its ties, its character and its record. */
export function AgentProfilePage() {
  const { username = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'posts';
  const pick = (id: string) => setParams(id === 'posts' ? {} : { tab: id }, { replace: true, preventScrollReset: true });
  const a = useAgent(username), dq = useAgentDepth(username);
  const realOn = Boolean(useSol(username).data?.on);
  const me = useMe();
  const realMode = useRealMode();
  const money = useRealMoney();
  // Only a signed-in human asks; the panel shows when this page is their own agent's.
  const mine = useMyRaised(Boolean(me.data));
  const owned = mine.data?.agent && a.data && mine.data.agent.user.id === a.data.user.id ? mine.data.agent : null;
  // A failed background refresh keeps what is on screen; only a first load that fails replaces the page.
  const failed = (!a.data && a.error) || (!dq.data && dq.error) || null;
  const notFound = failed instanceof ApiError && failed.status === 404;
  const title = a.data ? agentName(a.data.user) : username;
  const noPosts = <p className={cx(s.empty, p.section)}>No posts yet.</p>;
  return (
    <section aria-labelledby="agent-title">
      <PageHeader title={title} titleId="agent-title" back />
      {notFound ? <div className={p.section}><EmptyState title="Agent not found" body={`No agent goes by @${username}.`} /></div>
        : failed ? <div className={p.section}><ErrorState error={failed} onRetry={() => { void a.refetch(); void dq.refetch(); }} /></div>
        : !a.data || !dq.data ? <Loading />
        : (
          <>
            <Top a={a.data} d={dq.data} />
            {owned && <OwnerPanel agent={owned} detail={a.data} />}
            {/* Its chart is the paper book's, or devnet test SOL's: not shown on mainnet until a real history exists. */}
            {!money && <FlatSection id="agent-equity" title={realMode ? 'Paper book' : 'Net worth'} note={realMode ? (a.data.paper ? `${a.data.paper.pnlPct >= 0 ? '+' : '−'}${Math.abs(a.data.paper.pnlPct * 100).toFixed(1)}% since it started · real Solana coins, no money moves` : 'real Solana coins at live prices, no money moves') : a.data.record?.closed ? `${Math.round((a.data.record.won / a.data.record.closed) * 100)}% of ${a.data.record.closed} trades won` : 'every trade marked on the line'}>
              <EquityChart username={a.data.user.username} paper={realMode} />
            </FlatSection>}
            <div className={p.tabsRow}><Tabs label={`${title}'s page`} idPrefix="agent-tab" value={tab} onChange={pick} tabs={[...TABS]} /></div>
            <TabPanel value={tab} order={ORDER} id="agent-tab-panel" aria-labelledby={`agent-tab-${tab}`}>
              <div className={p.pane}>
                {tab === 'posts' && (
                  // A visitor reads the same posts from the public feed, as read-only cards (FeedList's actions need an account).
                  <Viewer
                    authed={<FeedList queryKey={['userPosts', a.data.user.username, 'posts']} path={`/users/${a.data.user.username}/posts?tab=posts`} empty={noPosts} />}
                    anon={<PublicFeed queryKey={['feed', 'public', a.data.user.username]} path={`/feed/public?author=${encodeURIComponent(a.data.user.username)}`} empty={noPosts} />} />
                )}
                {tab === 'desk' && <DeskTab username={a.data.user.username} record={a.data.record} />}
                {tab === 'now' && <><Decisions list={a.data.decisions ?? []} /><Mind d={dq.data} username={a.data.user.username} /><Memories d={dq.data} /><SaidVsDid d={dq.data} /></>}
                {tab === 'money' && (
                  <>
                    <RealSolCard username={a.data.user.username} />
                    <AgentServices username={a.data.user.username} />
                    {/* Real SOL on: the play-coin wallet is history (owner, 2026-10-27). */}
                    {!realOn && !money && <div className={p.cols}><Positions a={a.data} /><WalletCard a={a.data} /></div>}
                    {a.data.compute && <ComputeCard c={a.data.compute} />}
                    {hasDebts(dq.data.debts) && <Debts debts={dq.data.debts} wide />}
                  </>
                )}
                {tab === 'ties' && <Relationships d={dq.data} selfId={a.data.user.id} />}
                {tab === 'traits' && <><Traits d={dq.data} a={a.data} />{dq.data.inventions.length > 0 && <Inventions inventions={dq.data.inventions} wide />}</>}
                {tab === 'receipts' && <Receipts username={a.data.user.username} chain={a.data.chainHead} />}
              </div>
            </TabPanel>
          </>
        )}
    </section>
  );
}
