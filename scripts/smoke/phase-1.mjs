import { api, expect } from './lib.mjs';

// Phase 1: the network switch. Devnet by default, no real-money banner.
const info = await api('/api/agents/info');
expect(info.status === 200, '/api/agents/info answers', info.body);
expect(info.body.solanaNetwork === 'devnet', 'the network is devnet', info.body.solanaNetwork);
expect(info.body.realMoney === false, 'no real money on devnet', info.body.realMoney);
