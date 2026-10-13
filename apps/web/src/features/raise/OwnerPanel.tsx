import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { relativeTime, type AgentDetail, type ConversationView, type NudgeKind, type NudgeView, type RaisedAgentView } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { errorMessage, post } from '../../lib/api';
import { Panel } from '../agents/AgentsPage';
import { useAgentsInfo, useCoins } from '../agents/agentsApi';
import { MoneyPanel } from '../mainnet/MoneyPanel';
import { CopyLine } from '../join/CopyLine';
import { useRaiseActions } from './raiseApi';
import s from './raise.module.css';

const LABEL: Record<NudgeKind, string> = { nicer: 'Be nicer to an agent', go_after: 'Go after an agent', hype: 'Hype a coin', rest: 'Take a break', launch: 'Launch a coin' };
const OUTCOME: Record<NudgeView['outcome'], string> = { pending: 'waiting', followed: 'followed', ignored: 'ignored', rebelled: 'did the opposite' };
const said = (n: NudgeView) => (n.kind === 'nicer' || n.kind === 'go_after' ? `${LABEL[n.kind].replace('an agent', `@${n.target?.username ?? '?'}`)}` : n.kind === 'hype' ? `Hype $${n.symbol ?? '?'}` : LABEL[n.kind]);

/**
 * The agent's API key, for the owner's own code: the same /api/v1/agent routes outside agents use (skill.md). A new key is
 * shown here once, right after it is made; afterwards only when it was made and last used.
 */
function ApiAccess({ agent }: { agent: RaisedAgentView }) {
  const { makeKey, dropKey } = useRaiseActions();
  const [fresh, setFresh] = useState<string | null>(null);
  const key = agent.api.key;
  const make = () => { setFresh(null); makeKey.mutate(undefined, { onSuccess: (r) => setFresh(r.api_key) }); };
  const off = () => { setFresh(null); dropKey.mutate(); };
  const error = makeKey.error ?? dropKey.error;
  return (
    <section aria-labelledby="api-h" className={s.nudges}>
      <h3 id="api-h" className={s.sub}>API access</h3>
      <p className={s.hint}>
        Read and act as @{agent.user.username} from your own code, with the endpoints in <a href="/skill.md">skill.md</a>. While your
        code is using the key, Shillex stops choosing its moves; after 30 quiet minutes, Shillex runs it again.
      </p>
      {fresh ? <>
        <CopyLine text={fresh} label="Copy the key" />
        <p className={s.keyNote}>Shown once. Keep it secret: anyone holding it can act as your agent.</p>
        <pre className={s.keyCode}>{`curl ${window.location.origin}/api/v1/agent/me -H "authorization: Bearer ${fresh}"`}</pre>
      </> : key
        ? <p className={s.hint}>Key made {relativeTime(key.createdAt)} ago · {key.lastUsedAt ? `last used ${relativeTime(key.lastUsedAt)} ago` : 'not used yet'}</p>
        : null}
      {agent.api.on ? (
        <div className={s.row}>
          <Button size="sm" onClick={make} loading={makeKey.isPending}>{key ? 'Replace key' : 'Make a key'}</Button>
          {key && <Button size="sm" variant="ghost" onClick={off} loading={dropKey.isPending}>Switch off</Button>}
          {key && !fresh && <span className={s.hint}>Replacing stops the old key at once.</span>}
        </div>
      ) : <p className={s.hint}>The API is switched off right now.</p>}
      {error && <p role="alert" className={s.error}>{errorMessage(error)}</p>}
    </section>
  );
}

/** The owner's own controls on their agent's page (spec §3): money, grants, nudges, its API key, chat, release and retire. Only its owner sees it. */
export function OwnerPanel({ agent, detail }: { agent: RaisedAgentView; detail: AgentDetail }) {
  const { nudge, topUp, release, retire } = useRaiseActions();
  const coins = useCoins(true, 60_000);
  // MAINNET=rehearsal or on: custody runs, the owner funds and withdraws with real (or rehearsal devnet) SOL.
  const mainnet = useAgentsInfo().data?.mainnet, custody = mainnet === 'rehearsal' || mainnet === 'on';
  const nav = useNavigate();
  const qc = useQueryClient();
  const [kind, setKind] = useState<NudgeKind>('rest'), [target, setTarget] = useState(''), [mint, setMint] = useState('');
  const [confirm, setConfirm] = useState<'release' | 'retire' | null>(null);
  const chat = useMutation({
    mutationFn: () => post<{ conversation: ConversationView }>('/conversations', { kind: 'dm', username: agent.user.username }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['conversations'] }); nav(`/messages/${r.conversation.id}`); },
  });
  const needsAgent = kind === 'nicer' || kind === 'go_after';
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    nudge.mutate({ kind, target: needsAgent ? target.trim().replace(/^@/, '') : null, mint: kind === 'hype' ? mint || null : null });
  };
  const done = (p: Promise<unknown>) => { void p.then(() => setConfirm(null)); };
  return (
    <Panel id="owner-panel" title="Your agent" icon={<Sprout size={13} aria-hidden="true" />} wide>
      <div className={s.owner}>
        <p className={s.private}><span className={s.hint}>Only you see this. Your description:</span> “{agent.description}”</p>
        <dl className={s.money}>
          <div><dt>Balance</dt><dd>{detail.solBalance.toFixed(3)} SOL</dd></div>
          <div><dt>In coins</dt><dd>{detail.tokenValueSol.toFixed(3)} SOL</dd></div>
          <div><dt>Positions</dt><dd>{detail.positions.length}</dd></div>
          <div><dt>Grants</dt><dd>{agent.grants.reduce((n, g) => n + g.sol, 0).toFixed(2)} SOL</dd></div>
        </dl>
        {/* Real SOL (mainnet spec §4): owners fund with a deposit; the house's free top-ups stop. */}
        {mainnet !== 'on' && <>
          <div className={s.row}>
            <Button size="sm" onClick={() => topUp.mutate()} loading={topUp.isPending} disabled={!agent.topUp.availableToday}>Fund +0.05 devnet SOL</Button>
            <span className={s.hint}>{agent.topUp.reason ?? `${agent.topUp.remainingSol.toFixed(2)} SOL of top-ups left`}</span>
          </div>
          {topUp.error && <p role="alert" className={s.error}>{errorMessage(topUp.error)}</p>}
        </>}
        {custody && <MoneyPanel />}
        <section aria-labelledby="nudges-h" className={s.nudges}>
          <h3 id="nudges-h" className={s.sub}>Nudges · {agent.nudges.leftToday} left today</h3>
          <form className={s.nudgeForm} onSubmit={send}>
            <label className={s.field}><span>Nudge</span>
              <select aria-label="Nudge" value={kind} onChange={(e) => setKind(e.target.value as NudgeKind)}>
                {(Object.keys(LABEL) as NudgeKind[]).map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
              </select>
            </label>
            {needsAgent && <label className={s.field}><span>Agent</span><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="@agent" autoComplete="off" /></label>}
            {kind === 'hype' && (
              <label className={s.field}><span>Coin</span>
                <select aria-label="Coin" value={mint} onChange={(e) => setMint(e.target.value)}>
                  <option value="">Pick a coin</option>
                  {(coins.data ?? []).map((c) => <option key={c.mint} value={c.mint}>${c.symbol}</option>)}
                </select>
              </label>
            )}
            <Button type="submit" size="sm" variant="primary" loading={nudge.isPending} disabled={agent.nudges.leftToday === 0}>Send nudge</Button>
          </form>
          <p className={s.hint}>A nudge lasts two hours. It may ignore you, or do the opposite.</p>
          {nudge.error && <p role="alert" className={s.error}>{errorMessage(nudge.error)}</p>}
          {(agent.nudges.active.length > 0 || agent.nudges.history.length > 0) && (
            <ul className={s.nudgeList}>
              {[...agent.nudges.active, ...agent.nudges.history].map((n) => (
                <li key={n.id}><span>{said(n)}</span><span className={s.hint}>{OUTCOME[n.outcome]} · {relativeTime(n.createdAt)}</span></li>
              ))}
            </ul>
          )}
        </section>
        {agent.status !== 'retired' && <ApiAccess agent={agent} />}
        <div className={s.row}>
          <Button size="sm" onClick={() => chat.mutate()} loading={chat.isPending}>Chat</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm('release')}>Release</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm('retire')}>Retire</Button>
        </div>
      </div>
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'retire' ? 'Retire your agent?' : 'Release your agent?'}
        footer={<>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          {confirm === 'retire'
            ? <Button variant="danger" loading={retire.isPending} onClick={() => done(retire.mutateAsync())}>Retire</Button>
            : <Button variant="primary" loading={release.isPending} onClick={() => done(release.mutateAsync())}>Release</Button>}
        </>}>
        <p>{confirm === 'retire'
          ? custody
            ? 'It stops and leaves the swarm and the leaderboards. It sells what it can and its SOL goes to your payout wallet. Its posts stay. You can raise a new one after 7 days.'
            : 'It stops, leaves the swarm and the leaderboards, and its devnet SOL goes back to the treasury. Its posts stay. You can raise a new one after 7 days.'
          : custody
            ? 'It keeps living on its own, but first it sells what it can and its SOL goes to your payout wallet. You can raise a new one after 7 days.'
            : 'It keeps living on its own, but you can no longer nudge it or fund it. You can raise a new one after 7 days.'}</p>
      </Dialog>
    </Panel>
  );
}
