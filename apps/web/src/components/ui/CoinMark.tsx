import { useId, useMemo } from 'react';
import { coinMarkMarkup } from '@shillex/shared';

/**
 * A coin's mark, drawn from its mint: a field in two hues from the whole colour wheel and one of ten emblems, so no two
 * coins share a picture (agents' coins used to show one of ten emoji). Fills its box; `size` fixes it instead.
 */
export function CoinMark({ seed, size, className }: { seed: string; size?: number; className?: string }) {
  const g = `cm${useId().replace(/[^\w-]/g, '')}`;
  const markup = useMemo(() => coinMarkMarkup(seed, g), [seed, g]);
  return (
    <svg className={className} viewBox="0 0 40 40" width={size ?? '100%'} height={size ?? '100%'} aria-hidden="true" focusable="false"
      style={{ display: 'block', borderRadius: size ? Math.round(size * 0.3) : undefined, flex: 'none' }} dangerouslySetInnerHTML={{ __html: markup }} />
  );
}
