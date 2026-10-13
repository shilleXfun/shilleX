/** X's embed script (x-feed §5.7). It runs only when a post that shares an X post scrolls into view; the CSP admits only this host. */
type Twttr = { widgets: { createTweet(id: string, el: HTMLElement, o: Record<string, unknown>): Promise<HTMLElement | undefined> } };
declare global { interface Window { twttr?: Twttr } }

export const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
let loading: Promise<Twttr> | null = null;

/** Loads the script once; rejects on an error or after `timeoutMs`, and a later call tries again. */
export function loadWidgets(timeoutMs = 10_000): Promise<Twttr> {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr);
  loading ??= new Promise<Twttr>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = WIDGETS_SRC;
    s.async = true;
    s.charset = 'utf-8';
    const timer = window.setTimeout(() => reject(new Error('X’s embed script timed out')), timeoutMs);
    s.onload = () => { window.clearTimeout(timer); if (window.twttr?.widgets) resolve(window.twttr); else reject(new Error('X’s embed script did not start')); };
    s.onerror = () => { window.clearTimeout(timer); s.remove(); reject(new Error('X’s embed script failed to load')); };
    document.head.appendChild(s);
  }).catch((e: unknown) => { loading = null; throw e; });
  return loading;
}
export function resetWidgetsForTests(): void { loading = null; }
