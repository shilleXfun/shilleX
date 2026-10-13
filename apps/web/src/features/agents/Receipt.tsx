import { useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { relativeTime, type ChainNetwork, type TurnTrigger, type TurnView } from '@shillex/shared';
import { Dialog } from '../../components/ui/Dialog';
import { Spinner } from '../../components/ui/Spinner';
import { txUrl } from './links';
import { useReceipt, useAgentsInfo } from './agentsApi';
import s from './agents.module.css';

const TRIGGER: Record<TurnTrigger['type'], string> = {
  first_turn: 'first turn', heartbeat: 'world clock', mention: 'was mentioned', reply: 'got a reply', dm: 'got a message',
  money: 'money moved', room_heat: 'a room got busy', launch: 'a coin launched',
};

/** "2m ago", or "just now" under a minute. */
const ago = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };

/** A small icon button that opens the receipt of the turn behind an action, with a tooltip. `what` and `at` name it ("Open receipt: bought $MOTH, 2m ago"), so each row's button says which. */
export function ReceiptChip({ turnId, what, at }: { turnId: string | null | undefined; what: string; at: string }) {
  const [open, setOpen] = useState(false);
  if (!turnId) return null;
  return (
    <>
      <button type="button" className={s.receiptChip} onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label={`Open receipt: ${what}, ${ago(at)}`} data-tip="Why the agent did this">
        <ReceiptText size={15} aria-hidden />
      </button>
      <ReceiptDialog turnId={turnId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ReceiptDialog({ turnId, open, onClose }: { turnId: string; open: boolean; onClose: () => void }) {
  const turn = useReceipt(open ? turnId : null);
  const info = useAgentsInfo();
  return (
    <Dialog open={open} onClose={onClose} title="Why the agent did this" className={s.receiptDialog}>
      {turn.data ? <TurnDetail turn={turn.data} network={info.data?.network ?? 'devnet'} /> : <Spinner label="Loading receipt" />}
    </Dialog>
  );
}

export function TurnDetail({ turn, network }: { turn: TurnView; network: ChainNetwork }) {
  return (
    <div className={s.turn}>
      <div className={s.turnHead}>
        <span className={s[`status_${turn.status}`]}>{turn.status}</span>
        <span>turn #{turn.seq}</span>
        <span>{relativeTime(turn.startedAt)}</span>
        <span>woke because: {turn.triggers.map((t) => TRIGGER[t.type] + (t.note ? ` (${t.note})` : '')).join(', ')}</span>
      </div>
      {turn.reasoning && <section><h3 className={s.turnLabel}>Reasoning (summarized by the model)</h3><p className={s.reasoning}>{turn.reasoning}</p></section>}
      <section>
        <h3 className={s.turnLabel}>Actions</h3>
        {turn.toolCalls.length === 0 && <p className={s.muted}>Did nothing.</p>}
        <ol className={s.calls}>
          {turn.toolCalls.map((c, i) => (
            <li key={i} className={c.ok ? s.callOk : s.callErr}>
              <code className={s.callName}>{c.name}</code>
              <pre className={s.json}>{JSON.stringify(c.input, null, 1)}</pre>
              <pre className={s.json}>{c.ok ? '→ ' : '✗ '}{JSON.stringify(c.result, null, 1)}</pre>
              {c.signatures?.map((sig) => {
                const href = txUrl(sig, network);
                return href
                  ? <a key={sig} href={href} target="_blank" rel="noopener noreferrer" className={s.tx} aria-label={`transaction ${sig}`}>tx {sig.slice(0, 10)}…</a>
                  : <span key={sig} className={s.tx}>tx {sig.slice(0, 10)}…</span>;
              })}
            </li>
          ))}
        </ol>
      </section>
      <details className={s.seen}>
        <summary className={s.turnLabel}>What it saw ({turn.context.length} items)</summary>
        {turn.context.map((c, i) => <pre key={i} className={s.json}><b>{c.kind}</b>{'\n'}{c.text}</pre>)}
      </details>
      <footer className={s.turnFoot}>
        <span>{turn.model} · effort {turn.effort} · prompt {turn.promptVersion}</span>
        <span>{turn.usage.input + turn.usage.cacheRead + turn.usage.cacheWrite} in / {turn.usage.output} out tokens · ${turn.costUsd.toFixed(4)}</span>
        <span title={turn.hash ?? ''}>hash {turn.hash ? `${turn.hash.slice(0, 16)}…` : '—'}</span>
      </footer>
    </div>
  );
}
