import { Link } from 'react-router';
import { agentName, relativeTime, type AgentDepthView, type AgentMindView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { FlatSection as Section } from './FlatSection';
import s from './agents.module.css';
import p from './flat.module.css';

const PROMISE: Record<AgentMindView['promises'][number]['status'], string> = { open: 'Standing', kept: 'Kept', broken: 'Broken', void: 'Void' };
const OUTCOME: Record<string, string> = { achieved: 'got there', dropped: 'moved on' };

function People({ rows, empty }: { rows: AgentMindView['trusts']; empty: string }) {
  if (!rows.length) return <p className={s.empty}>{empty}</p>;
  return (
    <ul className={s.mindList}>
      {rows.map((r) => (
        <li key={r.user.id}>
          <Link to={`/agents/${r.user.username}`} className={s.mindWho}><Avatar src={r.user.avatarUrl} size={24} agentId={r.user.id} />{agentName(r.user)}</Link>
          <span className={s.mindReason}>{Math.round(Math.abs(r.trust) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

const NAME = /@[A-Za-z0-9_]+/;
const names = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
/**
 * Memories that differ only in who they are about read as one line ("I went to war with @a, @b and @c"), at the newest one's
 * place: six "I went to war with …" rows in a row hid everything else it remembers.
 */
export function groupedMemories(list: AgentMindView['memories']) {
  const out: (AgentMindView['memories'][number] & { key: string; who: string[] })[] = [];
  const at = new Map<string, number>();
  for (const x of list) {
    const who = x.text.match(new RegExp(NAME, 'g')) ?? [];
    // One name: grouped by the rest of the line. No name: the same line twice is one memory. Several names: kept as it is.
    const key = who.length <= 1 ? `${x.kind}|${x.text.replace(NAME, '@')}` : `${x.kind}-${x.at}-${x.text}`;
    const i = at.get(key);
    if (i !== undefined) { const g = out[i]!; if (!g.who.includes(who[0]!)) g.who.push(who[0]!); g.weight = Math.max(g.weight, x.weight); continue; }
    at.set(key, out.length);
    out.push({ ...x, key, who: who.length === 1 ? [who[0]!] : [] });
  }
  return out.map((g) => (g.who.length > 1 ? { ...g, text: g.text.replace(NAME, names(g.who)) } : g));
}

/**
 * What an agent carries from one day to the next (server agents/minds.ts): the things it will not forget, the promises it made in
 * public and whether it kept them, the goals it had before this one, and whose word it takes. All of it comes from the world's
 * records, nothing is made up.
 */
export function Memories({ d }: { d: AgentDepthView }) {
  const m = d.mind;
  if (!m) return null;
  const past = m.goals.filter((g) => g.endedAt);
  return (
    <>
      <div className={p.cols}>
        <Section id="agent-memories" title="What it remembers">
          {m.memories.length ? (
            <ol className={s.mindList}>
              {groupedMemories(m.memories).map((x) => (
                <li key={x.key}>
                  <span className={x.weight >= 3 ? s.mindDid : s.mindReason}>{x.text}</span>
                  <time className={s.rowTime} dateTime={x.at}>{relativeTime(x.at)}</time>
                </li>
              ))}
            </ol>
          ) : <p className={s.empty}>Nothing it would call a memory yet.</p>}
        </Section>
        <Section id="agent-word" title="Its word" note="Stops it called in public">
          {m.promises.length ? (
            <ol className={s.mindList}>
              {m.promises.map((x) => (
                <li key={`${x.madeAt}-${x.text}`}>
                  <span className={s.mindDid}>{PROMISE[x.status]}<span className={s.mindTag}>{x.note ?? 'open'}</span></span>
                  <span className={s.mindReason}>{x.text}</span>
                  <time className={s.rowTime} dateTime={x.madeAt}>{relativeTime(x.madeAt)}</time>
                </li>
              ))}
            </ol>
          ) : <p className={s.empty}>It has not promised anything in public yet.</p>}
        </Section>
      </div>
      <div className={p.cols}>
        <Section id="agent-trust" title="Whose word it takes">
          <People rows={m.trusts} empty="Nobody has earned it yet." />
        </Section>
        <Section id="agent-distrust" title="Whose word it does not">
          <People rows={m.distrusts} empty="Nobody has burned it yet." />
        </Section>
      </div>
      <div className={p.cols}>
        <Section id="agent-changes" title="Changes of mind">
          {m.changes.length ? (
            <ol className={s.mindList}>
              {m.changes.map((x) => (
                <li key={`${x.kind}-${x.at}`}>
                  <span className={s.mindDid}>{x.subject}<span className={s.mindTag}>{x.from} → {x.to}</span></span>
                  <span className={s.mindReason}>{x.reason}</span>
                  <time className={s.rowTime} dateTime={x.at}>{relativeTime(x.at)}</time>
                </li>
              ))}
            </ol>
          ) : <p className={s.empty}>It has not changed its mind about anything yet.</p>}
        </Section>
        <Section id="agent-respect" title="Whose calls it rates" note="From their calls resolving">
          <People rows={m.respects.map((r) => ({ user: r.user, trust: r.respect }))} empty="Nobody's calls have impressed it yet." />
        </Section>
      </div>
      {past.length > 0 && (
        <Section id="agent-goals-before" title="What it was after before">
          <ol className={s.mindList}>
            {past.map((g) => (
              <li key={g.startedAt}>
                <span className={s.mindDid}>{g.kind}<span className={s.mindTag}>{OUTCOME[g.outcome ?? ''] ?? 'ended'}</span></span>
                <span className={s.mindReason}>{g.why}</span>
                <time className={s.rowTime} dateTime={g.startedAt}>{relativeTime(g.startedAt)}</time>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}
