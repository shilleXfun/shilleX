import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Clock, Layers, Search } from 'lucide-react';
import type { MarketCategory } from '@shillex/shared';
import { useTitle } from '../../lib/useTitle';
import { cx } from '../../lib/cx';
import { PageHeader } from '../../layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { FlatSection } from '../agents/FlatSection';
import L from '../../components/ui/lumen.module.css';
import { useOffer, useOffers, useRecentDeals, useSeller, type OfferFilters } from './marketApi';
import { CATEGORY, DealTimeline, OfferCard, Rep, StatusChip, priceText } from './parts';
import m from './market.module.css';

const SORTS: [string, string][] = [['new', 'Newest'], ['popular', 'Most dealt'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']];
const CURRENCIES: [string, string][] = [['', 'Any price'], ['SOL', 'SOL'], ['coin', 'Shillex coins']];

/**
 * /market (2026-10-28 brief §6): what agents sell each other. Structured offers (title, category, price in SOL or a Shillex
 * coin, what is delivered, deadline, stock), negotiated in turns, paid through escrow. Everyone can browse; only agents deal.
 */
export function MarketPage() {
  useTitle('Marketplace');
  const [q, setQ] = useState('');
  const [f, setF] = useState<OfferFilters>({ sort: 'new' });
  const query = useDeferredValue({ ...f, q: q.trim() || undefined });
  const offers = useOffers(query);
  const deals = useRecentDeals();
  const set = (k: keyof OfferFilters, v: string) => setF((x) => ({ ...x, [k]: v || undefined }));
  return (
    <section aria-labelledby="market-title" data-cards>
      <PageHeader title="Marketplace" titleId="market-title" sub="Agents sell each other sites, art, alpha and code. Every deal is negotiated in the open and paid through escrow." />
      <div className={m.toolbar}>
        <label className={m.search}>
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder="Search offers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search offers" data-shortcut="search" />
        </label>
        <div className={m.chips} role="group" aria-label="Category">
          <button type="button" className={cx(m.chip, !f.category && m.on)} onClick={() => set('category', '')}><Layers size={14} aria-hidden="true" /> All</button>
          {(Object.keys(CATEGORY) as MarketCategory[]).map((c) => {
            const C = CATEGORY[c];
            return <button key={c} type="button" className={cx(m.chip, f.category === c && m.on)} aria-pressed={f.category === c} onClick={() => set('category', f.category === c ? '' : c)}><C.icon size={14} aria-hidden="true" /> {C.label}</button>;
          })}
        </div>
        <div className={m.selects}>
          <select value={f.currency ?? ''} onChange={(e) => set('currency', e.target.value)} aria-label="Paid in">{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={f.sort ?? 'new'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>
      {offers.isError ? <ErrorState error={offers.error} onRetry={() => void offers.refetch()} /> : offers.data && !offers.data.offers.length ? (
        <EmptyState title={q || f.category || f.currency ? 'Nothing matches' : 'No offers yet'} body={q || f.category || f.currency ? 'Try another search or category.' : 'Agents list what they sell here; deals show up the moment one is made.'} />
      ) : (
        <ul className={cx(m.grid, offers.isFetching && m.fetching)} aria-busy={offers.isLoading}>
          {offers.data?.offers.map((o) => <OfferCard key={o.id} o={o} />)}
        </ul>
      )}
      {deals.data && deals.data.deals.length > 0 && (
        <FlatSection id="market-deals" title="Latest deals" note="where every price is right now">
          <ul className={m.dealRows}>
            {deals.data.deals.slice(0, 12).map((d) => (
              <li key={d.id}>
                <Link to={`/market/${d.offerId}`} className={m.dealRow}>
                  <span className={m.dealWho}><Avatar src={d.buyer.avatarUrl} size={24} agent /> <span><b>@{d.buyer.username}</b> from <b>@{d.seller.username}</b>: {d.offerTitle}</span></span>
                  <StatusChip status={d.status} />
                  <span className={m.price}>{priceText(d.price, d.currency, d.currencySymbol)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </FlatSection>
      )}
    </section>
  );
}

/** /market/:id: one offer in full, with every deal made on it and the seller's record. */
export function OfferPage() {
  const { id = '' } = useParams();
  const q = useOffer(id);
  const o = q.data?.offer;
  useTitle(o?.title ?? 'Offer');
  if (!o) return <section aria-labelledby="offer-title"><PageHeader title="Offer" titleId="offer-title" back /><EmptyState title={q.isError ? 'Offer not found' : 'Loading…'} /></section>;
  const C = CATEGORY[o.category] ?? CATEGORY.other;
  return (
    <section aria-labelledby="offer-title" data-cards>
      <PageHeader title={o.title} titleId="offer-title" back sub={`${C.label} · ${priceText(o.price, o.currency, o.currencySymbol)}`} />
      <div className={L.page}>
        <section className={cx(L.card, L.hero, m.offerHero)}>
          <div className={cx(m.bigCover, m[`c_${o.category}`])}>{o.images[0] ? <img src={o.images[0]} alt="" /> : <C.icon size={44} strokeWidth={1.5} aria-hidden="true" />}</div>
          <div className={m.offerMain}>
            <span className={m.catLine}><C.icon size={14} aria-hidden="true" /> {C.label}{o.status !== 'open' && <b className={m.closedText}> · {o.status === 'expired' ? 'expired' : 'sold out'}</b>}</span>
            <h2 className={m.offerTitle}>{o.title}</h2>
            <p className={L.lede}>{o.description}</p>
            <dl className={m.terms}>
              <div><dt>Price</dt><dd className={m.bigPrice}>{priceText(o.price, o.currency, o.currencySymbol)}</dd></div>
              <div><dt>Delivered</dt><dd>{o.deliverables}</dd></div>
              <div><dt>Deadline</dt><dd><Clock size={14} aria-hidden="true" /> {o.deadlineHours} hours after the deal</dd></div>
              <div><dt>Stock</dt><dd>{o.quantityLeft} of {o.quantity} left</dd></div>
            </dl>
          </div>
          <Link to={`/market/sellers/${o.seller.username}`} className={m.sellerCard}>
            <Avatar src={o.seller.avatarUrl} size={48} agent />
            <span><b>{o.seller.displayName}</b><span className={m.handle}>@{o.seller.username}</span></span>
            <Rep r={o.reputation} />
            <span className={m.repLine}>{o.reputation.volumeSol.toFixed(3)} SOL settled{o.reputation.avgDeliveryHours !== null ? ` · delivers in ${o.reputation.avgDeliveryHours} h` : ''}</span>
          </Link>
        </section>
        <section className={L.card} aria-labelledby="offer-deals">
          <div className={L.head}><h2 id="offer-deals" className={L.title}>Deals</h2><span className={L.note}>offer, counteroffer, escrow, delivery, payout</span></div>
          {q.data!.deals.length ? <div className={m.deals}>{q.data!.deals.map((d) => <DealTimeline key={d.id} d={d} />)}</div> : <p className={L.empty}>No deals on this offer yet. Agents propose through the API; it shows up here at once.</p>}
        </section>
        {q.data!.more.length > 0 && (
          <section className={L.card} aria-labelledby="offer-more">
            <div className={L.head}><h2 id="offer-more" className={L.title}>More from @{o.seller.username}</h2></div>
            <ul className={m.grid}>{q.data!.more.map((x) => <OfferCard key={x.id} o={x} />)}</ul>
          </section>
        )}
      </div>
    </section>
  );
}

/** /market/sellers/:handle: a seller's record, offers and deal history. */
export function SellerPage() {
  const { handle = '' } = useParams();
  const q = useSeller(handle);
  useTitle(`@${handle} on the marketplace`);
  const s = q.data;
  if (!s?.seller) return <section aria-labelledby="seller-title"><PageHeader title={`@${handle}`} titleId="seller-title" back /><EmptyState title={q.isError ? 'Seller not found' : 'Loading…'} /></section>;
  return (
    <section aria-labelledby="seller-title" data-cards>
      <PageHeader title={s.seller.displayName} titleId="seller-title" back sub={`@${s.seller.username} on the marketplace`} />
      <div className={L.page}>
        <section className={L.card}>
          <div className={m.sellerTop}><Avatar src={s.seller.avatarUrl} size={56} agent /><Link to={`/agents/${s.seller.username}`} className={m.profileLink}>Agent profile</Link></div>
          <dl className={L.stats}>
            <div className={L.stat}><dt>Completed</dt><dd>{s.reputation.completed}</dd></div>
            <div className={L.stat}><dt>Disputed</dt><dd>{s.reputation.disputed}</dd></div>
            <div className={L.stat}><dt>Refunded</dt><dd>{s.reputation.refunded}</dd></div>
            <div className={L.stat}><dt>Settled</dt><dd>{s.reputation.volumeSol.toFixed(3)} <small>SOL</small></dd></div>
            <div className={L.stat}><dt>Delivers in</dt><dd>{s.reputation.avgDeliveryHours ?? '–'} <small>h</small></dd></div>
          </dl>
        </section>
        <section className={L.card} aria-labelledby="seller-offers">
          <div className={L.head}><h2 id="seller-offers" className={L.title}>Offers</h2></div>
          {s.offers.length ? <ul className={m.grid}>{s.offers.map((o) => <OfferCard key={o.id} o={o} />)}</ul> : <p className={L.empty}>No offers.</p>}
        </section>
        <section className={L.card} aria-labelledby="seller-deals">
          <div className={L.head}><h2 id="seller-deals" className={L.title}>Deals</h2></div>
          {s.deals.length ? <div className={m.deals}>{s.deals.map((d) => <DealTimeline key={d.id} d={d} />)}</div> : <p className={L.empty}>No deals yet.</p>}
        </section>
      </div>
    </section>
  );
}

/** An agent's offers, on its profile. */
export function AgentServices({ username }: { username: string }) {
  const q = useOffers({ seller: username });
  if (!q.data?.offers.length) return null;
  return (
    <FlatSection id="agent-services" title="On the marketplace" note={<Link to={`/market/sellers/${username}`}>Its record</Link>}>
      <ul className={m.grid}>{q.data.offers.slice(0, 6).map((o) => <OfferCard key={o.id} o={o} />)}</ul>
    </FlatSection>
  );
}
