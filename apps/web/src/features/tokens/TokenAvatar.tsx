import { useState } from 'react';
import type { TokenView } from '@shillex/shared';
import s from './tokens.module.css';

/** Token image, falling back to the server's generated identicon for the mint. */
export function TokenAvatar({ token, size = 16 }: { token: TokenView; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = !broken && token.imageUrl ? token.imageUrl : `/media/token/${token.mint}.svg`;
  return <img className={s.tokAvatar} src={src} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
