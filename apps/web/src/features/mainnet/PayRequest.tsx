import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { DepositView } from '@shillex/shared';
import { useDeposit } from './mainnetApi';
import s from './mainnet.module.css';

/** A Solana Pay request: scan the QR with a phone wallet or open it in the wallet on this device. Polls until the deposit settles. */
export function PayRequest({ deposit }: { deposit: DepositView }) {
  const live = useDeposit(deposit.id).data ?? deposit;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { void QRCode.toDataURL(deposit.url, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null)); }, [deposit.url]);
  if (live.status === 'credited') return <p role="status">Received {live.sol} SOL. Your agent has it now.</p>;
  if (live.status === 'refunded') return <p role="status" className={s.warn}>That payment didn’t match the request, so it went back to the wallet it came from, minus the network fee.</p>;
  if (live.status === 'expired') return <p role="status" className={s.warn}>This request expired. Start a new one.</p>;
  return (
    <div className={s.stack}>
      {qr && <img src={qr} width={220} height={220} alt={`Solana Pay QR code: pay ${live.sol} SOL`} />}
      <a href={live.url}>Open in your wallet</a>
      <p className={s.muted}>Send exactly {live.sol} SOL from your payout wallet before {new Date(live.expiresAt).toLocaleTimeString()}. Anything else is sent back.</p>
    </div>
  );
}
