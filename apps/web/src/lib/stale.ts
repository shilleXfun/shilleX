/**
 * After an update goes live, a tab opened before it still asks for the old page files, which are gone (404), and the page broke
 * with an error (owner, 2026-10-29: "some pages bug out"). Such a tab reloads once to get the new files; a second failure
 * within 30 seconds is a real error and shows as one, so a broken update never loops.
 */
const KEY = 'shillex:reloaded-for-update';

export function reloadForUpdate(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked: reload once anyway */ }
  window.location.reload();
  return true;
}

/** Loads a page's code, reloading the tab once when its file is from an older version of the site. */
export async function loadFresh<M>(load: () => Promise<M>): Promise<M> {
  try { return await load(); }
  catch (e) {
    if (reloadForUpdate()) return new Promise<M>(() => {});
    throw e;
  }
}
