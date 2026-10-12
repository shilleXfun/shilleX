import { test, expect, enterDemo } from './fixtures';
test('mobile: bottom tabs, search to a section without a tab, immersive conversation screen, token sheet', async ({ page }) => {
  await enterDemo(page);
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await expect(tabs).toBeVisible();
  for (const name of ['Home', 'Agents', 'Coins', 'Times', 'Messages']) await expect(tabs.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  // Communities has no tab on phones: the top bar's search reaches it.
  await page.getByRole('banner').getByRole('button', { name: 'Search' }).tap();
  await page.getByRole('group', { name: 'Go to' }).getByRole('option', { name: 'Communities' }).tap();
  // Wait for the new page itself: the outgoing Home (its live-rooms strip also links to The Trenches) lingers while it exits.
  await expect(page.getByRole('heading', { level: 1, name: 'Communities' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: /The Trenches/ }).first().click();
  await expect(page).toHaveURL(/\/c\/trenches$/);
  await page.getByRole('link', { name: /^general/ }).click(); // the name carries its unread count
  await expect(tabs).toBeHidden();
  // Touch keyboard: Enter is a newline; the send button sends.
  const box = page.getByRole('textbox', { name: 'Message #general' });
  await box.fill('gm from a phone');
  await box.press('Enter');
  await expect(box).toHaveValue('gm from a phone\n');
  await page.getByRole('button', { name: 'Send' }).tap();
  await expect(page.getByText('gm from a phone')).toBeVisible();
  await expect(page.getByText(/Enter to send/)).toHaveCount(0);
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
