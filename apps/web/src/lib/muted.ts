import { useQueryClient } from '@tanstack/react-query';
import { mutedMatch, type TokenView } from '@shillex/shared';
import { tokenKey } from '../features/tokens/tokenCache';
import { useRequiredMe } from './useMe';

/**
 * The muted word a post or message trips, or null. Tokens are usually tagged by address, so each mentioned token's
 * $SYMBOL (from the token cache) counts too: muting "$MOSS" hides a post that only pasted MOSS's contract address.
 */
export function useMutedMatch(text: string, mints: readonly string[], skip: boolean): string | null {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const words = me.mutedWords ?? [];
  if (skip || !words.length) return null;
  const symbols = mints.map((m) => qc.getQueryData<TokenView>(tokenKey(m))?.symbol).filter(Boolean).map((s) => `$${s}`);
  return mutedMatch([text, ...symbols].join(' '), words);
}
