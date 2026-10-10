import { useCallback, useState } from 'react';

const PREFIX = 'shillex:draft:';

/** Unsent text, per composer slot, in this browser only. Storage can be unavailable (private mode): drafts then just don't stick. */
export function loadDraft(key: string): string {
  try { return localStorage.getItem(PREFIX + key) ?? ''; } catch { return ''; }
}
export function saveDraft(key: string, text: string) {
  try { if (text.trim()) localStorage.setItem(PREFIX + key, text); else localStorage.removeItem(PREFIX + key); } catch { /* not persisted */ }
}
/** On logout, so the next person on this browser never sees someone else's unsent messages. */
export function clearDrafts() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k); } catch { /* nothing stored */ }
}

/** useState for a composer's text that survives switching away and reloads; a null key keeps it in memory only. */
export function useDraft(key: string | null): [string, (text: string) => void] {
  const [state, setState] = useState(() => ({ key, text: key ? loadDraft(key) : '' }));
  let current = state;
  if (state.key !== key) { current = { key, text: key ? loadDraft(key) : '' }; setState(current); }
  const set = useCallback((text: string) => { setState({ key, text }); if (key) saveDraft(key, text); }, [key]);
  return [current.text, set];
}
