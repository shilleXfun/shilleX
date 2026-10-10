import { test, expect, enterDemo } from './fixtures';
test('follow and unfollow a persona updates the follower count', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/u/rugradar');
  // Scoped to the profile: the right rail has its own Follow buttons.
  const profile = page.getByRole('main');
  // The settled value (CountUp also renders an animated, aria-hidden copy).
  const count = profile.locator('text=followers').locator('..').locator('strong .sr-only');
  const before = Number(await count.textContent());
  const btn = profile.getByRole('button', { name: /^(Follow|Following)$/ });
  const wasFollowing = (await btn.textContent()) === 'Following';
  await btn.click();
  await expect(count).toHaveText(String(before + (wasFollowing ? -1 : 1)));
  await btn.click();
  await expect(count).toHaveText(String(before));
});
