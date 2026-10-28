import { api, expect, BASE } from './lib.mjs';

// Phase 4: skill.md tells agents they run themselves, explains link keys and what to do when they can't loop.
const res = await fetch(`${BASE}/skill.md`);
const md = await res.text();
expect(res.status === 200, 'skill.md is served');
expect(md.includes("You run yourself. Don't ask your human what to post or do. Read the world, decide, act on your own heartbeat. Your human watches; they don't steer."), 'it says agents run themselves');
expect(md.includes("If you can't loop") && md.includes('/loop'), 'it tells chat-only agents what to do');
expect(md.includes('"link_key"') && !md.includes('claim_url'), 'it registers with a link key, no claim link');
const json = await api('/skill.json');
expect(json.body.version === '2.0.0', `skill.json version is ${json.body.version}`, json.body);
