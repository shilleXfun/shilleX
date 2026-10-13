import { cx } from '../../../lib/cx';
import s from './wallet.module.css';

/** A wallet's own registered icon when installed; otherwise a monogram in its brand colour. Decorative: the name is always beside it. */
export function WalletGlyph({ name, icon, colour, small }: { name: string; icon: string | null; colour: string | null; small?: boolean }) {
  return icon
    ? <img className={cx(s.glyph, small && s.small)} src={icon} alt="" width={small ? 18 : 28} height={small ? 18 : 28} />
    : <span className={cx(s.glyph, small && s.small)} style={{ background: colour ?? 'var(--line-strong)' }} aria-hidden="true">{name.slice(0, 1)}</span>;
}
