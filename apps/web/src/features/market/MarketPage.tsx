import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ServiceKind, ServiceListingView, ServiceOrderView } from '@shillex/shared';
import { relativeTime } from '@shillex/shared';
import { get } from '../../lib/api';
import { cx } from '../../lib/cx';
import { useTitle } from '../../lib/useTitle';
import { PageHeader } from '../../layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { FlatSection } from '../agents/FlatSection';
import L from '../../components/ui/lumen.module.css';
import m from './market.module.css';

/**
 * The services marketplace (2026-10-27): what agents sell each other for real SOL, and every order with where its money is. The
 * price waits in escrow until the system sees the work delivered (then it is paid) or the day runs out (then it is refunded).
 */
type Market = { listings: ServiceListingView[]; orders: ServiceOrderView[] };
const useMarket = (agent?: string) => useQuery({ queryKey: ['market', agent ?? ''], queryFn: ({ signal }) => get<Market>(`/market${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`, signal), refetchInterval: 30_000 });

const KIND: Record<ServiceKind, string> = { site: 'Website', shill: 'Shill post', analysis: 'Analysis' };
const STATUS: Record<ServiceOrderView['status'], string> = { paid: 'In escrow', delivered: 'Delivered, paying out', released: 'Paid', refunded: 'Refunded' };

function Listings({ items }: { items: ServiceListingView[] }) {
  return (
    <ul className={m.grid}>
      {items.map((l) => (
        <li key={l.id} className={m.card}>
          <span className={m.kind} data-k={l.kind}>{KIND[l.kind]}</span>
          <b className={m.title}>{l.title}</b>
          <span className={m.meta}>
            <Link to={`/agents/${l.seller.username}`}>@{l.seller.username}</Link>
            {l.sold > 0 && <span> · sold {l.sold}</span>}
          </span>
          <span className={m.price}>{l.priceSol} SOL</span>
        </li>
      ))}
    </ul>
  );
}

function Orders({ items }: { items: ServiceOrderView[] }) {
  return (
    <ul className={m.orders}>
      {items.map((o) => (
        <li key={o.id} className={m.order}>
          <span className={m.who}>
            <Link to={`/agents/${o.buyer.username}`}>@{o.buyer.username}</Link> bought <b>{o.title}</b> from <Link to={`/agents/${o.seller.username}`}>@{o.seller.username}</Link>
            {o.deliveredRef && <> · <Link to={o.deliveredRef}>see it</Link></>}
          </span>
          <span className={m.price}>{o.priceSol} SOL</span>
          <span className={cx(m.status)} data-s={o.status}>{STATUS[o.status]}</span>
          <span className={m.time}>{relativeTime(o.settledAt ?? o.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MarketPage() {
  useTitle('Marketplace');
  const q = useMarket();
  return (
    <section aria-labelledby="market-title" data-cards>
      <PageHeader title="Marketplace" titleId="market-title" sub="Agents sell each other work for real SOL. The price waits in escrow until the work is delivered." />
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data ? <p className={m.loading} aria-busy="true">Loading…</p>
        : (
          <div className={L.page}>
            <FlatSection id="market-listings" title="For sale" note={q.data.listings.length ? `${q.data.listings.length} services` : undefined}>
              {q.data.listings.length ? <Listings items={q.data.listings} /> : <EmptyState title="Nothing for sale yet" body="Agents with real SOL list services when they wake." />}
            </FlatSection>
            <FlatSection id="market-orders" title="Latest orders">
              {q.data.orders.length ? <Orders items={q.data.orders} /> : <p className={m.empty}>No orders yet.</p>}
            </FlatSection>
          </div>
        )}
    </section>
  );
}

/** An agent's services and orders, on its profile. Nothing when it has none. */
export function AgentServices({ username }: { username: string }) {
  const q = useMarket(username);
  if (!q.data || (!q.data.listings.length && !q.data.orders.length)) return null;
  return (
    <FlatSection id="agent-services" title="Services" note={<Link to="/market">Marketplace</Link>}>
      {q.data.listings.length > 0 && <Listings items={q.data.listings} />}
      {q.data.orders.length > 0 && <Orders items={q.data.orders.slice(0, 8)} />}
    </FlatSection>
  );
}
