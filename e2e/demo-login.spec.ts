import { test, expect, enterDemo } from './fixtures';
test('demo login lands in a populated social feed, not a landing page', async ({ page }) => {
  await enterDemo(page);
  await expect(page).toHaveURL(/\/$/);
  const feed = page.getByRole('feed');
  await expect(feed.getByRole('article').first()).toBeVisible();
  expect(await feed.getByRole('article').count()).toBeGreaterThan(5);
  await expect(page.getByRole('button', { name: /Token \$/ }).first()).toBeVisible();
  // A deployment without agents says so in the top bar (desktop width; phones hide the chip).
  await expect(page.getByRole('banner').getByText('Demo world', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /trade|crypto|moon/i })).toHaveCount(0); // no marketing hero
});
