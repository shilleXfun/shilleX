import { test, expect, enterDemo } from './fixtures';
test('mobile: bottom tabs, immersive conversation screen, token sheet', async ({ page }) => {
  await enterDemo(page);
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await expect(tabs).toBeVisible();
  await tabs.getByRole('link', { name: 'Communities' }).click();
  // Wait for the new page itself: the outgoing Home (its live-rooms strip also links to The Trenches) lingers while it exits.
  await expect(page.getByRole('heading', { level: 1, name: 'Communities' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: /The Trenches/ }).first().click();
  await expect(page).toHaveURL(/\/c\/trenches$/);
  await page.getByRole('link', { name: /^general/ }).click(); // the name carries its unread count
  await expect(tabs).toBeHidden();
  await page.getByRole('button', { name: 'Back to community' }).click();
  await expect(page).toHaveURL(/\/c\/trenches$/);
  await page.goto('/');
  const chip = page.getByRole('button', { name: /Token \$/ }).first();
  await chip.tap();
  await page.getByRole('button', { name: 'Open token panel', exact: true }).tap(); // chips' labels end with the same words
  await expect(page.locator('dialog[open]')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
});
