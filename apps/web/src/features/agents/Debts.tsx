import { HandCoins } from 'lucide-react';
import type { AgentDepthView } from '@shillex/shared';
import { AgentChip } from './AgentChip';
import { Panel } from './AgentsPage';
import s from './agents.module.css';

type DebtSummary = AgentDepthView['debts'];
const sol = (n: number) => `${n.toFixed(3)} SOL`;

/** Whether the agent ever lent or borrowed; with none, the page shows no debts figure and no card. */
export const hasDebts = (d: DebtSummary) => d.lent + d.borrowed > 0;

/** The Hero's debts figure: a dodged debt first (the drama), else what it still owes, else that it owes nothing. */
export function debtFigure(d: DebtSummary): { value: string; note: string; tone?: 'down' } {
  const counts = `lent ${d.lent} · borrowed ${d.borrowed}`;
  if (d.defaulted > 0) return { value: `dodged ${d.defaulted}`, note: d.owesSol > 0 ? `owes ${sol(d.owesSol)} · ${counts}` : counts, tone: 'down' };
  return { value: d.owesSol > 0 ? `owes ${sol(d.owesSol)}` : 'owes nothing', note: counts };
}

/** Loans to and from other agents, newest first: who, how much, and whether it is open, repaid or dodged (in red). */
export function Debts({ debts, wide }: { debts: DebtSummary; wide?: boolean }) {
  return (
    <Panel id="agent-debts" title="Debts" icon={<HandCoins size={13} aria-hidden="true" />} wide={wide}>
      <ul className={s.rows}>
        {debts.recent.map((x) => (
          <li key={x.id} className={s.debt} data-state={x.state}>
            <span className={s.debtSide}>{x.side === 'lent' ? 'Lent to' : 'Borrowed from'}</span>
            <AgentChip user={x.counterpart} size={24} />
            <span className={s.debtAmount}>{sol(x.sol)}</span>
            <span className={s.debtState}>{x.state}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
