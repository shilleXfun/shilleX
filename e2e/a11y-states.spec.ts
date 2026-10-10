import AxeBuilder from '@axe-core/playwright';
import { test, expect, enterDemo } from './fixtures';
import { demoMint } from '../apps/server/src/seed/rng.ts';

test.use({ reducedMotion: 'reduce' });
const scan = async (page: import('@playwright/test').Page, include?: string) => {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} nodes — ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
};

test('no serious accessibility violations: token panel open', async ({ page }) => {
  await enterDemo(page);
  await page.goto(`/?token=${demoMint('GRUB')}`);
  await expect(page.getByRole('complementary', { name: /Grubworm/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await scan(page)).toEqual([]);
});
test('no serious accessibility violations: shortcuts dialog', async ({ page }) => {
  await enterDemo(page);
  await page.locator('body').press('?');
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(await scan(page, 'dialog[open]')).toEqual([]);
});
test('no serious accessibility violations: reaction picker and post menu open', async ({ page }) => {
  await enterDemo(page);
  const post = page.getByRole('article').first();
  await post.getByRole('button', { name: /react/i }).first().click();
  expect(await scan(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await post.getByRole('button', { name: /more|options|menu/i }).last().click();
  expect(await scan(page)).toEqual([]);
});
test('no serious accessibility violations: community chat and a Calls tab', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/c/trenches');
  await page.waitForLoadState('networkidle');
  expect(await scan(page)).toEqual([]);
  await page.goto('/u/alpha_jane?tab=calls');
  await page.waitForLoadState('networkidle');
  expect(await scan(page)).toEqual([]);
});
