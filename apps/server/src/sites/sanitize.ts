/**
 * Model-written HTML is hostile (x-revamp §3). What keeps a site away from Shillex's origin and off the network is the sandbox
 * CSP on GET /sites/:slug/raw; this pass removes what must not be in a page at all, or would only break inside that sandbox:
 * <base>, <meta http-equiv>, <form>, frames and plugins, scripts loaded from elsewhere, stylesheets other than Google Fonts,
 * links that leave the page, images from other hosts, and scripts that try to navigate (no CSP directive stops a frame from
 * navigating itself).
 *
 * It is a small tokenizer, not a full HTML parser, and errs on the side of removing: where it could read the markup differently
 * from a browser (inside <svg> and <math>), it drops scripts and styles instead of guessing.
 */

/** The largest page stored, after sanitising. */
export const SITE_MAX_BYTES = 200_000;

export interface Sanitized { html: string; removed: string[] }
interface Attr { name: string; raw: string | null }
interface Tag { name: string; attrs: Attr[]; end: number; closing: boolean; selfClosing: boolean }

/** Read as text up to their end tag (outside <svg> and <math>). */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);
/** Removed with everything inside them. */
const DROP_ALL = new Set(['iframe', 'noembed', 'noframes', 'object', 'applet', 'frameset', 'portal']);
/** Only the tag goes: a <form> keeps its text (nothing can be submitted without it); the rest have no content. */
const DROP_TAG = new Set(['base', 'embed', 'frame', 'form', 'isindex', 'keygen']);
const FOREIGN = new Set(['svg', 'math']);
const URL_ATTRS = new Set(['src', 'poster', 'background', 'lowsrc', 'dynsrc']);
const NO_ATTRS = new Set(['srcset', 'imagesrcset', 'srcdoc', 'action', 'formaction', 'ping', 'target', 'download', 'manifest']);
const FONT_CSS = 'https://fonts.googleapis.com/';
const FONT_FILES = 'https://fonts.gstatic.com';

/**
 * Script that tries to leave the page: the address bar, open() (which can replace the frame), history, writing the document
 * over, a refresh pragma, or WebRTC (which no CSP directive covers). Requests are already blocked by connect-src 'none'.
 * JavaScript is case-sensitive, so the words are too. A page whose script trips this keeps its HTML and CSS; anything cleverer
 * is caught in the browser, which closes a frame that navigates (features/sites/SiteEmbed.tsx).
 */
const LEAVES = /\b(?:location|history\s*\.\s*(?:back|forward|go)|document\s*\.\s*(?:write|writeln)|httpEquiv|RTCPeerConnection|webkitRTCPeerConnection)\b|(?<![\w$])open\s*\(/;
const REFRESH = /http-equiv/i;
const navigates = (js: string) => LEAVES.test(js) || REFRESH.test(js);
/** Inline script the browser could read past its first </script> ("<!--<script>" escapes it); never needed, so never kept. */
const ESCAPED_SCRIPT = /<!--|<script/i;

const WS = /[\t\n\f\r ]/;
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', sol: '/', bsol: '\\', tab: '\t', newline: '\n', num: '#',
  period: '.', lpar: '(', rpar: ')', semi: ';', equals: '=', excl: '!', percnt: '%', comma: ',', nbsp: ' ', grave: '`', lowbar: '_',
};

/** An attribute value as the browser reads it: character references decoded (more of them than browsers know is fine here). */
const decoded = (raw: string) => raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
  if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
});
/** A URL attribute as the browser follows it: decoded, without the spaces and control characters a URL loses. */
const urlValue = (raw: string) => decoded(raw).replace(/[\u0000- \u007f]+/g, '');

/** An image the CSP lets through: inline data, a path on Shillex, or Shillex's own origin. */
function ownImage(raw: string, origin: string): boolean {
  const v = urlValue(raw);
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(v)) return true;
  if (/^\/(?![/\\])/.test(v)) return true;
  return v.toLowerCase().startsWith(`${origin.toLowerCase()}/`);
}

function parseTag(s: string, at: number): Tag | null {
  let p = at + 1;
  const closing = s[p] === '/';
  if (closing) p++;
  if (!/[A-Za-z]/.test(s[p] ?? '')) return null;
  const start = p;
  while (p < s.length && !WS.test(s[p]!) && s[p] !== '/' && s[p] !== '>') p++;
  const name = s.slice(start, p);
  const attrs: Attr[] = [];
  let selfClosing = false;
  while (p < s.length) {
    while (p < s.length && WS.test(s[p]!)) p++;
    if (p >= s.length) break;
    if (s[p] === '>') return { name, attrs, end: p + 1, closing, selfClosing };
    if (s[p] === '/') { p++; selfClosing = s[p] === '>'; continue; }
    selfClosing = false;
    // A leading "=" belongs to the name, as in browsers.
    const an = p++;
    while (p < s.length && !WS.test(s[p]!) && s[p] !== '/' && s[p] !== '>' && s[p] !== '=') p++;
    const attrName = s.slice(an, p);
    while (p < s.length && WS.test(s[p]!)) p++;
    if (s[p] !== '=') { attrs.push({ name: attrName, raw: null }); continue; }
    p++;
    while (p < s.length && WS.test(s[p]!)) p++;
    const q = s[p];
    if (q === '"' || q === "'") {
      const e = s.indexOf(q, p + 1);
      if (e < 0) return null;
      attrs.push({ name: attrName, raw: s.slice(p + 1, e) });
      p = e + 1;
    } else {
      const v = p;
      while (p < s.length && !WS.test(s[p]!) && s[p] !== '>') p++;
      attrs.push({ name: attrName, raw: s.slice(v, p) });
    }
  }
  return null;
}

const attrText = (a: Attr) => (a.raw === null ? ` ${a.name}` : ` ${a.name}="${a.raw.replace(/"/g, '&quot;')}"`);
const startTag = (t: Tag, attrs: Attr[]) => `<${t.name}${attrs.map(attrText).join('')}${t.selfClosing ? ' /' : ''}>`;
const valueOf = (t: Tag, name: string) => t.attrs.find((a) => a.name.toLowerCase() === name)?.raw ?? null;
const hasAttr = (t: Tag, name: string) => t.attrs.some((a) => a.name.toLowerCase() === name);

/** Where the text content of a raw-text element ends: its end tag, or the end of the document. */
function closeOf(s: string, from: number, name: string): number {
  const re = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'ig');
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? m.index : s.length;
}

/** The kept attributes of a start tag, or null when the element itself must go. */
function keepAttrs(t: Tag, name: string, origin: string, removed: Set<string>): Attr[] | null {
  if (name === 'input' && (valueOf(t, 'type') ?? '').trim().toLowerCase() === 'password') { removed.add('password field'); return null; }
  const out: Attr[] = [];
  for (const a of t.attrs) {
    const an = a.name.toLowerCase();
    if (an.startsWith('on')) {
      if (a.raw !== null && navigates(decoded(a.raw))) { removed.add('event handler that navigates'); continue; }
      out.push(a);
    } else if (NO_ATTRS.has(an)) {
      removed.add(`${an} attribute`);
    } else if (an === 'href' || an === 'xlink:href') {
      // Links stay on the page: #anchors only. Elsewhere (an SVG <use>) the same, or an image this page may show.
      const v = a.raw === null ? '' : urlValue(a.raw);
      if (v.startsWith('#') || (name === 'image' && a.raw !== null && ownImage(a.raw, origin))) out.push(a);
      else if (name === 'a' || name === 'area') { out.push({ name: a.name, raw: '#' }); removed.add('link that leaves the page'); }
      else removed.add(`${an} attribute`);
    } else if (URL_ATTRS.has(an)) {
      if (a.raw !== null && ownImage(a.raw, origin)) out.push(a);
      else removed.add('image from another host');
    } else out.push(a);
  }
  return out;
}

/** A Google Fonts stylesheet (or a preconnect to its hosts): the only <link> a site keeps. */
function fontLink(t: Tag): boolean {
  const rel = (valueOf(t, 'rel') ?? '').toLowerCase().split(/\s+/);
  const href = urlValue(valueOf(t, 'href') ?? '').toLowerCase();
  if (rel.includes('stylesheet')) return href.startsWith(FONT_CSS);
  if (rel.includes('preconnect')) return href === FONT_FILES || href.startsWith(`${FONT_FILES}/`) || href.startsWith(FONT_CSS) || href === FONT_CSS.slice(0, -1);
  return false;
}

/**
 * The page with everything §3 forbids removed, and a list of what went (for the build's receipt). `origin` is Shillex's own
 * (PUBLIC_URL): images from it, from a path on it or inline data are kept, every other image source goes.
 */
export function sanitizeSiteHtml(input: string, origin: string): Sanitized {
  const s = input.replace(/\u0000/g, '');
  const removed = new Set<string>();
  let out = '';
  let i = 0;
  let foreign = 0;
  // Inside an element removed with its content (one that is not raw text): its name and nesting depth.
  let skip: { name: string; depth: number } | null = null;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { if (!skip) out += s.slice(i); break; }
    if (!skip) out += s.slice(i, lt);
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') {
      const e = s.indexOf('>', lt);
      const chunk = s.slice(lt, e < 0 ? s.length : e + 1);
      if (!skip && /^<!doctype\s/i.test(chunk)) out += chunk;
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    const t = parseTag(s, lt);
    if (!t) { if (!skip) out += '&lt;'; i = lt + 1; continue; }
    i = t.end;
    const name = t.name.toLowerCase();
    if (skip) {
      if (name === skip.name) { if (t.closing) skip.depth--; else if (!t.selfClosing) skip.depth++; }
      if (skip.depth <= 0) skip = null;
      continue;
    }
    if (FOREIGN.has(name)) foreign = Math.max(0, foreign + (t.closing ? -1 : t.selfClosing ? 0 : 1));
    if (t.closing) {
      if (DROP_TAG.has(name) || DROP_ALL.has(name)) continue;
      if (foreign && (name === 'script' || name === 'style')) continue;
      out += `</${t.name}>`;
      continue;
    }
    if (foreign && (name === 'script' || name === 'style')) { removed.add(`${name} inside svg or math`); continue; }
    if (!foreign && RAW_TEXT.has(name)) {
      const close = closeOf(s, i, name);
      const content = s.slice(i, close);
      const after = close >= s.length ? s.length : (s.indexOf('>', close) + 1 || s.length);
      i = after;
      if (DROP_ALL.has(name)) { removed.add(name); continue; }
      if (name === 'script') {
        if (hasAttr(t, 'src') || hasAttr(t, 'href') || hasAttr(t, 'xlink:href')) { removed.add('script from another host'); continue; }
        if (ESCAPED_SCRIPT.test(content) || navigates(content)) { removed.add('script that navigates'); continue; }
      }
      const attrs = keepAttrs(t, name, origin, removed);
      if (attrs) out += `${startTag({ ...t, selfClosing: false }, attrs)}${content}</${t.name}>`;
      continue;
    }
    if (DROP_ALL.has(name)) {
      removed.add(name);
      if (!t.selfClosing) skip = { name, depth: 1 };
      continue;
    }
    if (DROP_TAG.has(name)) { removed.add(name); continue; }
    if (name === 'meta' && t.attrs.some((a) => REFRESH.test(a.name))) { removed.add('meta http-equiv'); continue; }
    if (name === 'link') {
      // A font stylesheet needs no event handlers.
      if (fontLink(t)) out += startTag(t, t.attrs.filter((a) => !a.name.toLowerCase().startsWith('on')));
      else removed.add('link');
      continue;
    }
    const attrs = keepAttrs(t, name, origin, removed);
    if (attrs) out += startTag(t, attrs);
  }
  let html = out.trim();
  if (!/^<!doctype html/i.test(html)) html = `<!doctype html>\n${html}`;
  return { html, removed: [...removed] };
}
