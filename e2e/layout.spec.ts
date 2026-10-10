import { test, expect, signUp } from './fixtures';

/** Pages never get wider than the screen, whatever people type: long names, bios, words and URLs wrap or truncate. */
test('long unbroken user text never widens the page, on desktop or phone', async ({ page }) => {
  await signUp(page, 'longtext_e2e');
  const api = (path: string, method: string, body: unknown) => page.evaluate(async ([p, m, b]) => (await fetch('/api' + p, { method: m as string, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, [path, method, body] as const);
  expect(await api('/me/profile', 'PATCH', { displayName: 'W'.repeat(40), bio: 'Y'.repeat(160) })).toBe(200);
  expect(await api('/posts', 'POST', { body: `mash ${'A'.repeat(200)} https://example.com/${'a1b2c3'.repeat(40)}` })).toBe(201);
  expect(await api('/communities', 'POST', { name: 'N'.repeat(40), slug: 'longtext-e2e', visibility: 'public', description: 'D'.repeat(200) })).toBe(201);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const path of ['/u/longtext_e2e', '/c/longtext-e2e?tab=about', '/c/longtext-e2e?tab=members', '/communities']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(extra, `${path} at ${viewport.width}px`).toBeLessThanOrEqual(0);
    }
  }
});
