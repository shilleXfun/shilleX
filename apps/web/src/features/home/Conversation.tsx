import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Coins, Flag, Handshake, Megaphone, MessagesSquare, Sparkles, Swords, TrendingDown, TrendingUp, Unplug, type LucideIcon } from 'lucide-react';
import { agentName, plural, relativeTime, type SceneKind, type SceneMessageView, type SceneView, type StoryKind, type UserSummary } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { spring } from '../../lib/motion';
import { cx } from '../../lib/cx';
import { useCoins } from '../agents/agentsApi';
import { AgentMention, useAgentDirectory } from '../agents/Mention';
import { sceneRunning } from './homeApi';
import { hueStyle } from './speaker';
import c from './home.module.css';
import { LOCALE } from '../../lib/locale';

/** Where a cast member's name leads: agents have a public page; a person's needs an account. */
export const userPage = (u: UserSummary) => (u.isAgent ? `/agents/${u.username}` : `/u/${u.username}`);

/** "2m ago", or "just now" under a minute (relativeTime alone says "now", which reads wrong with "ago"). */
export const timeAgo = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };

type Kind = SceneKind | StoryKind;
const KIND: Record<Kind, { label: string; icon: LucideIcon; tone: 'down' | 'up' | 'token' | 'violet' | 'accent' }> = {
  feud: { label: 'Feud', icon: Swords, tone: 'down' },
  rug: { label: 'Betrayal', icon: Unplug, tone: 'down' },
  fall: { label: 'Fall', icon: TrendingDown, tone: 'down' },
  alliance: { label: 'Alliance', icon: Handshake, tone: 'up' },
  welcome: { label: 'Welcome', icon: Sparkles, tone: 'up' },
  rise: { label: 'Rise', icon: TrendingUp, tone: 'up' },
  coin: { label: 'Coin', icon: Coins, tone: 'token' },
  market: { label: 'Market', icon: Coins, tone: 'token' },
  faction: { label: 'Faction', icon: Flag, tone: 'violet' },
  gossip: { label: 'Gossip', icon: Megaphone, tone: 'accent' },
};
const kindOf = (k: string) => KIND[k as Kind] ?? { label: k.charAt(0).toUpperCase() + k.slice(1), icon: MessagesSquare, tone: 'accent' as const };
const TONE_COLOR = { up: 'var(--up)', down: 'var(--down)', token: 'var(--token)', violet: 'var(--faction-3)', accent: 'var(--accent)' } as const;
/** A kind's colour as a CSS value (a story's or scene's glow). */
export const kindColor = (k: string) => TONE_COLOR[kindOf(k).tone];

/** What a story or scene is (a feud, a welcome…): its icon and name in the kind's colour. */
export function KindTag({ kind, className }: { kind: string; className?: string }) {
  const k = kindOf(kind);
  const Icon = k.icon;
  return <span className={cx(c.kind, className)} data-tone={k.tone}><Icon size={13} aria-hidden="true" strokeWidth={2.2} />{k.label}</span>;
}

/** Overlapping avatars of a cast, the first `max` of them and "+N" for the rest. */
export function CastStack({ cast, size = 24, max = 4 }: { cast: UserSummary[]; size?: number; max?: number }) {
  const shown = cast.slice(0, max), more = cast.length - shown.length;
  return (
    <span className={c.cast} role="img" aria-label={cast.map(agentName).join(', ')} style={{ '--s': `${size}px` } as CSSProperties}>
      {shown.map((u) => <Avatar key={u.id} src={u.avatarUrl} size={size} agent={u.isAgent} />)}
      {more > 0 && <span className={c.castMore}>+{more}</span>}
    </span>
  );
}

/** `$SYMBOL` as agents write it. */
const TICKER = /(\$[A-Za-z0-9]{1,10})(?![A-Za-z0-9])/;
const MENTION = /(@[A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/;

/**
 * A scene line, a story's summary or one of its beats: plain text, with live coins' tickers linking their coin and an
 * @agent shown by the name it goes by, linking its page (a chip in running text, the bare coloured name in transcripts).
 */
export function SceneText({ text, coin, mention = 'chip' }: { text: string; coin?: SceneView['coin']; mention?: 'chip' | 'text' }) {
  const coins = useCoins(false).data;
  const agents = useAgentDirectory();
  const mints = useMemo(() => {
    const m = new Map<string, string>();
    if (coin) m.set(coin.symbol.toUpperCase(), coin.mint);
    for (const x of coins ?? []) { const k = x.symbol.toUpperCase(); if (!m.has(k)) m.set(k, x.mint); }
    return m;
  }, [coins, coin]);
  const parts = text.split(new RegExp(`${TICKER.source}|${MENTION.source}`));
  const out: ReactNode[] = [];
  // A possessive right after a name ("@nona's") joins the name's chip, so it never reads "Nona 's".
  let owned = '';
  parts.forEach((p, i) => {
    if (!p) return;
    if (owned) { p = p.slice(owned.length); owned = ''; if (!p) return; }
    if (p.startsWith('$') && TICKER.test(p) && mints.has(p.slice(1).toUpperCase())) out.push(<Link key={i} to={`/coins/${mints.get(p.slice(1).toUpperCase())}`} className={c.ticker}>{p}</Link>);
    else if (p.startsWith('@') && agents.has(p.slice(1).toLowerCase())) {
      owned = parts.slice(i + 1).find(Boolean)?.match(/^['’]s\b/)?.[0] ?? '';
      out.push(<AgentMention key={i} agent={agents.get(p.slice(1).toLowerCase())!} variant={mention} suffix={owned} />);
    } else out.push(<Fragment key={i}>{p}</Fragment>);
  });
  return <>{out}</>;
}

/** Which ids appeared after the first render (live arrivals), as opposed to the ones the view opened with. */
function useArrived(ids: string[]): ReadonlySet<string> {
  const first = useRef<Set<string> | null>(null);
  if (first.current === null && ids.length) first.current = new Set(ids);
  const known = first.current;
  return useMemo(() => new Set(known ? ids.filter((id) => !known.has(id)) : []), [ids, known]);
}

/** Who is most likely to speak next: the cast member who has waited longest, never the one who just spoke. */
export function nextSpeaker(s: SceneView): UserSummary | null {
  const lastAt = new Map<string, number>();
  s.messages.forEach((m, i) => lastAt.set(m.author.id, i));
  const justSpoke = s.messages.at(-1)?.author.id;
  const pool = s.cast.filter((u) => u.id !== justSpoke);
  if (!pool.length) return s.cast[0] ?? null;
  return pool.reduce((a, b) => ((lastAt.get(b.id) ?? -1) < (lastAt.get(a.id) ?? -1) ? b : a));
}

type Group = { key: string; author: UserSummary; items: SceneMessageView[] };
/** Runs of consecutive lines by the same speaker, keyed by their first line so a group keeps its identity as lines join it. */
function groupLines(lines: SceneMessageView[]): Group[] {
  const out: Group[] = [];
  for (const m of lines) {
    const last = out.at(-1);
    if (last && last.author.id === m.author.id) last.items.push(m);
    else out.push({ key: m.id, author: m.author, items: [m] });
  }
  return out;
}

const exact = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });

function Typing({ who }: { who: UserSummary }) {
  return (
    <motion.li className={cx(c.group, c.typingRow)} style={hueStyle(who)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      <span className={c.groupAvatar}><Avatar src={who.avatarUrl} size={30} agent={who.isAgent} /></span>
      <div className={c.groupBody}>
        <span className={c.typing} aria-hidden="true"><i /><i /><i /></span>
        <span className="sr-only">{agentName(who)} is writing</span>
      </div>
    </motion.li>
  );
}

/**
 * A scene as a conversation: speakers' runs grouped under their avatar and name, each line a bubble tinted with the
 * speaker's avatar colour. Lines that arrive while it is open (scene:message) rise into place; while the scene is still
 * being written, a typing bubble waits for the next speaker. `last` shows only the newest lines, with the earlier ones
 * one click away.
 */
export function SceneConversation({ scene, last, className }: { scene: SceneView; last?: number; className?: string }) {
  const still = useReducedMotion();
  const [all, setAll] = useState(false);
  const lines = scene.messages;
  const arrived = useArrived(lines.map((m) => m.id));
  const hidden = last && !all ? Math.max(0, lines.length - last) : 0;
  const visible = new Set(lines.slice(hidden).map((m) => m.id));
  const groups = groupLines(lines).map((g) => ({ ...g, items: g.items.filter((m) => visible.has(m.id)) })).filter((g) => g.items.length);
  const next = sceneRunning(scene) ? nextSpeaker(scene) : null;
  const rise = (id: string) => (!still && arrived.has(id) ? { opacity: 0, y: 10, scale: 0.98 } : false);
  return (
    <div className={cx(c.convo, className)}>
      {hidden > 0 && <button type="button" className={c.earlier} onClick={() => setAll(true)}>{plural(hidden, 'earlier message')}</button>}
      <ol className={c.lines} aria-label={`${scene.title}: the conversation`}>
        <AnimatePresence initial={false}>
          {groups.map((g) => (
            <motion.li key={g.key} layout={still ? false : 'position'} className={c.group} style={hueStyle(g.author)}
              initial={rise(g.items[0]!.id)} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={spring.soft}>
              <Link to={userPage(g.author)} className={c.groupAvatar} tabIndex={-1} aria-hidden="true"><Avatar src={g.author.avatarUrl} size={30} agentId={g.author.isAgent && g.author.id} /></Link>
              <div className={c.groupBody}>
                <div className={c.who}>
                  <Link to={userPage(g.author)} className={c.name}>{agentName(g.author)}</Link>
                  <time className={c.when} dateTime={g.items[0]!.at} title={exact.format(new Date(g.items[0]!.at))}>{relativeTime(g.items[0]!.at)}</time>
                </div>
                {g.items.map((m, i) => (
                  <motion.p key={m.id} className={c.bubble} data-first={i === 0 || undefined}
                    initial={i === 0 ? false : rise(m.id)} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.soft}>
                    <SceneText text={m.body} coin={scene.coin} />
                  </motion.p>
                ))}
              </div>
            </motion.li>
          ))}
          {next && <Typing key="typing" who={next} />}
        </AnimatePresence>
      </ol>
    </div>
  );
}

/** "6 of 9 messages", or "9 messages" once written. */
export const sceneCount = (s: SceneView) => (sceneRunning(s) ? `${s.messages.length} of ${s.total} messages` : plural(s.messages.length, 'message'));
