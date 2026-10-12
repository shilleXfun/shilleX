import { test, expect, enterDemo, HOME_COMPOSER } from './fixtures';
import { demoMint } from '../apps/server/src/seed/rng.ts';
const MINT = demoMint('GRUB');
test('pasting a CA creates an interactive chip; the panel opens beside the feed and closes back to the chip', async ({ page }) => {
  await enterDemo(page);
  const box = page.getByRole('textbox', { name: HOME_COMPOSER });
  await box.fill(`e2e watching ${MINT} closely`);
  await expect(page.getByRole('button', { name: new RegExp(MINT) }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const posted = page.getByRole('article').filter({ hasText: 'e2e watching' }).first();
  await expect(posted).toBeVisible();
  const chip = posted.getByRole('button', { name: new RegExp(MINT) });
  await expect(chip).toContainText('$GRUB');
  await chip.hover();
  await expect(page.getByRole('dialog').filter({ hasText: 'DEMO data' })).toBeVisible();
  await chip.click();
  const panel = page.getByRole('complementary', { name: /Grubworm/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(MINT)).toBeVisible();
  await expect(panel.getByText('Mentions measure discussion, not quality. Do your own research.')).toBeVisible();
  for (const l of ['Axiom', 'GMGN', 'Dexscreener', 'Solscan']) await expect(panel.getByText(l, { exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(posted).toBeVisible(); // feed stays in place
  await expect(page).toHaveURL(new RegExp(`token=${MINT}`));
  await panel.getByRole('tab', { name: /Posts/ }).click();
  await expect(panel.getByRole('article').filter({ hasText: 'e2e watching' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(chip).toBeFocused();
});
test('an unknown address shows an honest unavailable state when live lookup is off (no invented token data)', async ({ page }) => {
  await enterDemo(page);
  const wallet = demoMint('not-a-registered-token');
  await page.getByRole('textbox', { name: HOME_COMPOSER }).fill(`addr ${wallet}`);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const posted = page.getByRole('article').filter({ hasText: 'addr' }).first();
  await expect(posted.getByRole('button', { name: new RegExp(wallet) })).toContainText('Couldn’t load'); // honest: lookup disabled
});
test('a shared community link keeps its token panel when it opens the first channel', async ({ page }) => {
  await enterDemo(page);
  await page.goto(`/c/trenches?token=${MINT}`);
  await expect(page).toHaveURL(new RegExp(`/c/trenches/[^/?]+[?]token=${MINT}$`));
  const panel = page.getByRole('complementary', { name: /Grubworm/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('img', { name: /in the last 24 hours/ })).toBeVisible();
});
