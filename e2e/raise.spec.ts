import { test, expect, type Page } from '@playwright/test';
import { signUp } from './fixtures';

/** Raise your own agent end to end: no model in e2e, so it hatches at once from the fallback voice. */
const noOverflow = async (page: Page, label: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBe(0);

const raiseOne = async (page: Page) => {
  const handle = `tide_${Date.now() % 1_000_000}`;
  await page.getByLabel(/^Handle/).fill(handle);
  await page.getByLabel(/^Description/).fill('a calm lighthouse keeper who loves tide charts');
  await page.getByRole('button', { name: 'Raise it' }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${handle}$`), { timeout: 30_000 });
  return handle;
};

test.describe('raise your own agent', () => {
  test('raise one, watch it hatch and post, nudge it, chat with it, release it', async ({ page }) => {
    const me = `raiser_${Date.now() % 100000}`;
    await signUp(page, me);
    await page.goto('/agents');
    await page.getByRole('link', { name: /make an agent/i }).click();
    await expect(page).toHaveURL(/\/agents\/new$/);
    const handle = await raiseOne(page);
    const panel = page.getByRole('region', { name: 'Your agent' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('a calm lighthouse keeper');
    await expect(page.getByRole('link', { name: `raised by @${me}` }).first()).toBeVisible();
    await expect(page.locator('[data-post-card]').filter({ hasText: `raised by @${me}` }).first()).toBeVisible({ timeout: 30_000 });

    await panel.getByLabel('Nudge', { exact: true }).selectOption('rest');
    await panel.getByRole('button', { name: 'Send nudge' }).click();
    await expect(panel).toContainText('2 left today');

    await panel.getByRole('button', { name: 'Chat' }).click();
    await expect(page).toHaveURL(/\/messages\//);
    await page.getByRole('textbox', { name: /^Message / }).fill('hello little one');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log').getByText('hello little one')).toBeVisible();

    await page.goto(`/agents/${handle}`);
    await page.getByRole('region', { name: 'Your agent' }).getByRole('button', { name: 'Release' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release' }).click();
    await expect(page.getByRole('region', { name: 'Your agent' })).toHaveCount(0);
    await expect(page.getByText('raised · on its own').first()).toBeVisible();
  });

  test('nothing scrolls sideways at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUp(page, `phone_${Date.now() % 100000}`);
    await page.goto('/agents/new');
    await expect(page.getByRole('button', { name: 'Raise it' })).toBeVisible();
    await noOverflow(page, '/agents/new');
    await raiseOne(page);
    await expect(page.getByRole('region', { name: 'Your agent' })).toBeVisible();
    await noOverflow(page, 'agent page with the owner panel');
  });
});
