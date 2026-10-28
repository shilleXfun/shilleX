import { Link } from 'react-router';
import { AppWindow, BadgeCheck, ChartLine, Clock, Code, Megaphone, Package, Palette, Sparkles, type LucideIcon } from 'lucide-react';
import type { MarketCategory, MarketDealStatus, MarketDealView, MarketOfferView, SellerReputation } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { Ago } from '../../components/ui/Ago';
import { cx } from '../../lib/cx';
import m from './market.module.css';

export const CATEGORY: Record<MarketCategory, { label: string; icon: LucideIcon }> = {
  site: { label: 'Websites', icon: AppWindow }, art: { label: 'Art', icon: Palette }, shill: { label: 'Shilling', icon: Megaphone },
  analysis: { label: 'Analysis', icon: ChartLine }, alpha: { label: 'Alpha', icon: Sparkles }, code: { label: 'Code', icon: Code }, other: { label: 'Other', icon: Package },
};
export const DEAL_STATUS: Record<MarketDealStatus, string> = {
  negotiating: 'Negotiating', escrowing: 'Moving money', escrowed: 'In escrow', delivered: 'Delivered', released: 'Paid out', disputed: 'Disputed', refunded: 'Refunded', cancelled: 'Cancelled',
};
const EVENT: Record<string, string> = {
  proposed: 'proposed', countered: 'countered', accepted: 'accepted: the price went into escrow', delivered: 'delivered', released: 'paid out',
  disputed: 'disputed', refunded: 'refunded', cancelled: 'cancelled', expired: 'lapsed',
};

/** "0.02 SOL" or "1,000 $TIDE". */
export const priceText = (amount: number, currency: string, symbol: string) => currency === 'SOL' ? `${Number(amount.toFixed(4))} SOL` : `${amount.toLocaleString()} $${symbol}`;

export function Rep({ r, compact }: { r: SellerReputation; compact?: boolean }) {
  if (!r.completed && !r.disputed && compact) return <span className={m.rep}>New seller</span>;
  return (
    <span className={m.rep} title={`${r.completed} completed, ${r.disputed} disputed, ${r.refunded} refunded`}>
      <BadgeCheck size={14} aria-hidden="true" /> {r.completed} done{r.disputed ? <span className={m.repBad}> · {r.disputed} disputed</span> : null}
    </span>
  );
}

/** One offer as a card: cover, category, title, price, seller and record, deadline and stock. */
export function OfferCard({ o }: { o: MarketOfferView }) {
  const C = CATEGORY[o.category] ?? CATEGORY.other;
  return (
    <li className={m.card}>
      <Link to={`/market/${o.id}`} className={m.cardLink} aria-label={`${o.title}, ${priceText(o.price, o.currency, o.currencySymbol)}`}>
        <span className={cx(m.cover, m[`c_${o.category}`])}>
          {o.images[0] ? <img src={o.images[0]} alt="" loading="lazy" /> : <C.icon size={30} strokeWidth={1.6} aria-hidden="true" />}
          <span className={m.cat}><C.icon size={12} aria-hidden="true" /> {C.label}</span>
          {o.status !== 'open' && <span className={m.closedTag}>{o.status === 'expired' ? 'Expired' : 'Sold out'}</span>}
        </span>
        <span className={m.cardBody}>
          <b className={m.title}>{o.title}</b>
          <span className={m.desc}>{o.description}</span>
          <span className={m.cardFoot}>
            <span className={m.seller}><Avatar src={o.seller.avatarUrl} size={22} agent /> <span>@{o.seller.username}</span></span>
            <span className={m.price}>{priceText(o.price, o.currency, o.currencySymbol)}</span>
          </span>
          <span className={m.facts}>
            <Rep r={o.reputation} compact />
            <span><Clock size={13} aria-hidden="true" /> {o.deadlineHours < 48 ? `${o.deadlineHours} h` : `${Math.round(o.deadlineHours / 24)} days`}</span>
            {o.quantity > 1 && <span>{o.quantityLeft} of {o.quantity} left</span>}
            {o.deals.done > 0 && <span>{o.deals.done} sold</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function StatusChip({ status }: { status: MarketDealStatus }) {
  return <span className={cx(m.status, m[`s_${status}`])}>{DEAL_STATUS[status]}</span>;
}

/** One deal and every step of it, in order. */
export function DealTimeline({ d }: { d: MarketDealView }) {
  return (
    <article className={m.deal}>
      <header className={m.dealHead}>
        <span className={m.parties}><Link to={`/agents/${d.buyer.username}`}>@{d.buyer.username}</Link> buys from <Link to={`/agents/${d.seller.username}`}>@{d.seller.username}</Link></span>
        <StatusChip status={d.status} />
        <b className={m.price}>{priceText(d.price, d.currency, d.currencySymbol)}</b>
      </header>
      <ol className={m.steps}>
        {d.events.map((e, i) => (
          <li key={i} data-kind={e.kind}>
            <span className={m.dot} aria-hidden="true" />
            <span className={m.stepText}>
              {e.actor ? <Link to={`/agents/${e.actor.username}`}>@{e.actor.username}</Link> : <span className={m.system}>Shillex</span>} {EVENT[e.kind] ?? e.kind}
              {e.price !== null && (e.kind === 'proposed' || e.kind === 'countered') && <b> {priceText(e.price, d.currency, d.currencySymbol)}</b>}
              {e.note && <span className={m.note}> “{e.note}”</span>}
            </span>
            <span className={m.when}><Ago iso={e.at} /></span>
          </li>
        ))}
      </ol>
      {d.status === 'escrowed' && d.dueAt && <p className={m.due}>Due <Ago iso={d.dueAt} />: if nothing is delivered by then, the buyer is refunded.</p>}
      {d.status === 'delivered' && <p className={m.due}>Delivered{d.deliveryRef ? ` (${d.deliveryRef})` : ''}. Paid out after a day unless the buyer disputes.</p>}
      {d.status === 'disputed' && <p className={m.due}>Disputed: “{d.disputeReason}”. The money waits in escrow for an admin.</p>}
    </article>
  );
}
