// Helpers shared by the README compositions. scripts/readme/build.mjs calls window.render(data) on each page,
// then screenshots the .card element at deviceScaleFactor 2.

const X_PATHS = `
  <mask id="xm" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
    <rect x="-8" y="-8" width="80" height="80" fill="white"/>
    <path d="M12 10 L52 54" stroke="black" stroke-width="19" stroke-linecap="round"/>
  </mask>
  <path d="M52 10 L12 54" stroke="#FFB86B" stroke-width="11" stroke-linecap="round" mask="url(#xm)"/>
  <path d="M12 10 L52 54" stroke="#EEF0F7" stroke-width="11" stroke-linecap="round"/>`;

/** The wordmark at a font size in CSS px, built like Wordmark.tsx. */
export function wordmark(size) {
  return `<span class="wordmark" style="font-size:${size}px" role="img" aria-label="Shillex">shille<svg class="x" viewBox="0 0 64 64" aria-hidden="true">${X_PATHS}</svg></span>`;
}

const LOCK = '<svg viewBox="0 0 10 10" fill="none"><rect x="1.5" y="4.5" width="7" height="5" rx="1.2" fill="currentColor"/><path d="M3 4.5V3.2a2 2 0 0 1 4 0v1.3" stroke="currentColor" stroke-width="1.2"/></svg>';

/**
 * A browser window holding one screenshot.
 * box: the window's rect in the card (CSS px). shot: { src, width, height } in CSS px of the page it was taken from.
 * crop: { x, y } the page point that lands at the view's top-left. scale: page px to card px.
 * urlCenter: where (in card x) to centre the address pill, so it stays visible when the window bleeds off an edge.
 */
export function browserWindow({ box, shot, crop, scale, url, urlCenter }) {
  const el = document.createElement('div');
  el.className = 'window';
  Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  const [host, ...rest] = url.replace(/^https?:\/\//, '').split('/');
  const short = (seg) => (seg.length > 18 ? `${seg.slice(0, 6)}…${seg.slice(-4)}` : seg);
  const path = rest.length ? `/${rest.map(short).join('/')}` : '';
  const pillLeft = urlCenter === undefined ? '50%' : `${urlCenter - box.x}px`;
  el.innerHTML = `
    <div class="bar"><div class="dots"><i></i><i></i><i></i></div>
      <div class="url" style="left:${pillLeft}">${LOCK}<span><b>${host}</b>${path}</span></div></div>
    <div class="view" style="height:${box.h - 34}px"><img alt="" src="${shot.src}"
      style="width:${shot.width * scale}px;left:${-crop.x * scale}px;top:${-crop.y * scale}px"></div>`;
  return el;
}

export function phone({ box, shot }) {
  const el = document.createElement('div');
  el.className = 'phone';
  Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  el.innerHTML = `<img alt="" src="${shot.src}">`;
  return el;
}

/** Resolves once every image has decoded and the brand fonts are in. */
export async function settle() {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  await Promise.all(['800 40px Bricolage', '400 16px Geist', '500 12px "Geist Mono"'].map((f) => document.fonts.load(f)));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
