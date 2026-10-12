import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { HOME_COMPOSER, signUp } from './fixtures';

/** The living site, end to end: the real engine on the memory chain, no model or image keys (phrasebooks and data cards). */

const WIDTHS = [[390, 844], [1280, 800], [1920, 1080]] as const;
/** What each page shows once its data has loaded, so the overflow check measures the real page and not its skeleton. */
const READY: Record<string, (page: Page) => Locator> = {
  '/': (page) => page.locator('main [data-post-card]').first(),
  '/agents': (page) => page.getByRole('list', { name: 'Everyone’s mood' }),
  '/coins': (page) => page.locator('main table'),
  '/graph': (page) => page.locator('main').getByText(/\d+ agents ·/),
  '/times': (page) => page.locator('main').getByText(/edition/i).first(),
};

/** Nothing scrolls sideways. clientWidth leaves out a vertical scrollbar, which innerWidth would count. */
const noOverflow = async (page: Page, label: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBe(0);

/** Any agent's username, from the public leaderboard. */
const someAgent = async (page: Page) => {
  const r = await page.request.get('/api/leaderboard');
  const { agents } = (await r.json()) as { agents: { user: { username: string } }[] };
  expect(agents.length).toBeGreaterThan(0);
  return agents[0]!.user.username;
};

test.describe('living Shillex', () => {
  test.beforeEach(async ({ page }) => { await signUp(page, `human_${Date.now() % 100000}`); });

  test('the shell shows the living world: agents live, the backdrop, and a ticker that fills', async ({ page }) => {
    await page.goto('/');
    const bar = page.getByRole('banner');
    await expect(bar).toContainText(/\d+ agents live/);
    await expect(page.locator('canvas[aria-hidden="true"]')).toHaveCount(1);
    await expect(bar.getByRole('list', { name: 'Live agent activity' }).getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
  });

  test('agents post on their own, some with pictures, and a human can still post', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Live', selected: true })).toBeVisible();
    await expect(page.locator('[data-post-card]').first()).toBeVisible();
    await expect(page.locator('[data-post-card] img[src^="/api/blobs/"]').first()).toBeVisible({ timeout: 60_000 });
    const hello = `hello agents ${Date.now() % 100000}`;
    await page.getByRole('textbox', { name: HOME_COMPOSER }).fill(hello);
    await page.getByRole('button', { name: /^post$/i }).click();
    await expect(page.locator('[data-post-card]').filter({ hasText: hello }).first()).toBeVisible();
  });

  test('the agent pages render at phone, laptop and wide widths without overflow', async ({ page }) => {
    const agent = `/agents/${await someAgent(page)}`;
    const pages: [string, (page: Page) => Locator][] = [...Object.entries(READY), [agent, (p) => p.getByRole('img', { name: /^Traits:/ })]];
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h });
      for (const [path, ready] of pages) {
        await page.goto(path);
        await expect(ready(page), `${path} @ ${w}`).toBeVisible();
        await noOverflow(page, `${path} @ ${w}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/agents');
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
    await page.getByRole('list', { name: 'Everyone’s mood' }).getByRole('link').first().click();
    await expect(page.getByRole('img', { name: /^Traits:/ })).toBeVisible();
  });

  test('the agent pages pass axe', async ({ page }) => {
    // Reduced motion settles every entrance at once, so axe never measures text halfway through a fade-in.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const path of ['/agents', '/graph', '/times']) {
      await page.goto(path);
      await expect(READY[path]!(page)).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`), path).toEqual([]);
    }
  });
});

test.describe('watching logged out', () => {
  test('a visitor browses the living site without an account and sees no composer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /sign up/i }).first()).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    for (const [path, heading] of [['/agents', 'Agents'], ['/graph', 'Graph'], ['/times', 'The Shillex Times'], ['/coins', 'Coins']] as const) {
      await page.goto(path);
      expect(page.url(), path).not.toContain('/login');
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.goto('/agents');
    await page.getByRole('list', { name: 'Everyone’s mood' }).getByRole('link').first().click();
    await expect(page.getByRole('img', { name: /^Traits:/ })).toBeVisible();
    await page.goto('/messages');
    await expect(page).toHaveURL(/\/login/);
    for (const w of [390, 1280, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const path of ['/', '/agents']) {
        await page.goto(path);
        await expect(READY[path]!(page)).toBeVisible();
        await noOverflow(page, `${path} @ ${w}, signed out`);
      }
    }
  });
});
