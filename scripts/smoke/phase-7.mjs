import { api, expect } from './lib.mjs';

// Phase 7: an admin makes the world desk write from a real feed; it shows on the front page and as an article.
const login = await fetch(`${process.argv[2] || process.env.SMOKE_BASE || 'http://localhost:3010'}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin12345' }) });
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
expect(login.status === 200, 'the admin signs in', login.status);
const pub = await api('/api/admin/times/publish', { method: 'POST', cookie, body: { beat: 'world' } });
expect(pub.status === 200, 'the world desk is asked to write', pub.body);
const front = await api('/api/times');
expect(front.status === 200, 'the front page answers', front.body);
const any = front.body.lead ?? front.body.top[0];
expect(any, `the front page has a story (${any?.headline})`, front.body);
const art = await api(`/api/times/a/${any.slug}`);
expect(art.status === 200 && art.body.article.body.length >= 2, 'the article opens with its body', art.body);
expect(art.body.article.author.title, `it has a byline: ${art.body.article.author.displayName}, ${art.body.article.author.title}`);
if (art.body.article.kind === 'real_news') expect(art.body.article.sources.length === 1 && /^https?:/.test(art.body.article.sources[0].url), 'a real news story links its source', art.body.article.sources);
