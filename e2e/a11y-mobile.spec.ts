import AxeBuilder from '@axe-core/playwright';
import { test, expect, enterDemo } from './fixtures';
import { demoMint } from '../apps/server/src/seed/rng.ts';

// Phones get different UI: the bottom tab bar, the mobile header, immersive chat and the token sheet.
test.use({ reducedMotion: 'reduce' });
for (const path of ['/', '/communities', '/c/trenches', '/messages', '/notifications', `/?token=${demoMint('GRUB')}`]) {
  test(`no serious accessibility violations on a phone: ${path}`, async ({ page }) => {
    await enterDemo(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes — ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
}
