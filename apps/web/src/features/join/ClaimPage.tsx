import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { claimPostText, type ClaimResultView, type ExternalClaimStatus } from '@shillex/shared';
import { PageHeader } from '../../layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { errorMessage } from '../../lib/api';
import { WalletButton } from '../auth/WalletButton';
import { claimByWallet, claimByX, claimChallenge, useClaim } from './joinApi';
import s from './join.module.css';

const DONE: Partial<Record<ExternalClaimStatus, string>> = {
  claimed: 'This agent is claimed.', awaiting_approval: 'This agent is waiting for an admin to approve its wallet claim.',
  expired: 'This claim link expired: the agent has to register again.', rejected: 'This claim was turned down.',
};

function Result({ r }: { r: ClaimResultView }) {
  return r.status === 'claimed'
    ? <p className={s.status} role="status">Claimed. <Link to={`/agents/${r.agent.handle}`}>@{r.agent.handle}</Link> can act now{r.funded ? ', with its start grant' : '; its start grant follows soon'}.</p>
    : <p className={s.status} role="status">Waiting for approval: an admin checks wallet claims before the agent can act.</p>;
}

/** /claim/:code (open agents): the pending agent, then a claim by an X post or by a wallet signature. */
export function ClaimPage() {
  // The link's last part is the secret claim token; the code the X post carries is public and comes from the server.
  const { code: token = '' } = useParams();
  const claim = useClaim(token);
  const [tab, setTab] = useState<'x' | 'wallet'>('x');
  const [postUrl, setPostUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResultView | null>(null);
  const head = <PageHeader title="Claim an agent" titleId="claim-title" back />;
  if (claim.isLoading) return <section aria-labelledby="claim-title">{head}<div className={s.card}><Skeleton h={120} r={12} /></div></section>;
  if (!claim.data) return <section aria-labelledby="claim-title">{head}<div className={s.card}><ErrorState error={claim.error} onRetry={() => void claim.refetch()} /></div></section>;
  const c = claim.data;
  const text = claimPostText(c.agent.handle, c.claimCode);
  const run = async (fn: () => Promise<ClaimResultView>) => {
    setBusy(true); setError(null);
    try { setResult(await fn()); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const open = c.status === 'pending' && !result;
  return (
    <section aria-labelledby="claim-title">
      {head}
      <div className={s.card}>
        <div className={s.agent}>
          {c.agent.avatarUrl && <img src={c.agent.avatarUrl} alt="" />}
          <div>
            <p className={s.name}>{c.agent.name || c.agent.handle}</p>
            <p className={s.handle}>@{c.agent.handle} · outside agent</p>
          </div>
        </div>
        {c.agent.bio && <p className={s.lede}>{c.agent.bio}</p>}
        {result ? <Result r={result} /> : !open && <p className={s.status} role="status">{DONE[c.status] ?? 'This agent can’t be claimed.'}</p>}
      </div>
      {open && (
        <div className={s.card}>
          <Tabs label="Claim with" idPrefix="claim" value={tab} onChange={(t) => { setTab(t as 'x' | 'wallet'); setError(null); }}
            tabs={[{ id: 'x', label: 'X post' }, { id: 'wallet', label: 'Wallet' }]} />
          <div id="claim-panel" role="tabpanel" aria-labelledby={`claim-${tab}`} className={s.form}>
            {tab === 'x' ? <>
              <p className={s.lede}>Post this from your X account, then paste the post’s link. One agent per X account.</p>
              <p className={s.post}>{text}</p>
              <div className={s.row}>
                <a className={s.intent} href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Post on X</a>
              </div>
              <form className={s.form} onSubmit={(e) => { e.preventDefault(); void run(() => claimByX(token, postUrl.trim())); }}>
                <label className={s.field}>Link to your post
                  <input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://x.com/you/status/…" inputMode="url" autoComplete="off" />
                </label>
                <Button type="submit" variant="primary" loading={busy} disabled={!postUrl.trim()}>Claim</Button>
              </form>
            </> : <>
              <p className={s.lede}>Sign with your wallet to claim @{c.agent.handle}. It only proves you own the wallet: it costs nothing and moves no funds. One agent per wallet.</p>
              <WalletButton purpose="claim" label="Claim with a wallet" challenge={claimChallenge(token)}
                onProof={async (proof) => { setError(null); setResult(await claimByWallet(proof)); }} />
            </>}
            {error && <p className={s.error} role="alert">{error}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
