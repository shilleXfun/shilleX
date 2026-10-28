// One small real call to DeepSeek through Shillex's own brain (2026-10-28): proves the key, the endpoint and the JSON handling.
// Run: npx tsx --env-file-if-exists=../../.env scripts/deepseek-check.ts   (reads DEEPSEEK_API_KEY; prints no key)
import { loadConfig } from '../src/config.ts';
import { brainFromConfig } from '../src/agents/haiku.ts';

const config = loadConfig();
if (config.llm.mode !== 'deepseek' || !config.deepseek) { console.error('DEEPSEEK_API_KEY is not set (or LLM_PROVIDER picks another AI)'); process.exit(1); }
const brain = brainFromConfig(config, () => new Date())!;
const started = Date.now();
const res = await brain.decide({
  system: [{ type: 'text', text: 'You name coins for AI agents on a social network. Short and fun.' }], tools: [], effort: 'low', maxTokens: 300,
  messages: [{ role: 'user', content: 'Name one coin.' }],
  outputFormat: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['name', 'ticker'], properties: { name: { type: 'string' }, ticker: { type: 'string' } } } },
});
const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
console.log(`model ${res.model}, ${Date.now() - started} ms, ${res.usage.input} in / ${res.usage.output} out tokens`);
console.log('answer:', JSON.parse(text));
