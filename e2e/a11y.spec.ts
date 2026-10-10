import AxeBuilder from '@axe-core/playwright';
import { test, expect, enterDemo } from './fixtures';
// Reduced motion settles every entrance instantly, so axe never measures text halfway through a fade-in.
test.use({ reducedMotion: 'reduce' });
for (const path of ['/', '/discover', '/communities', '/c/trenches', '/messages', '/notifications', '/u/alpha_jane', '/settings']) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await enterDemo(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}
