import { test, expect, enterDemo } from './fixtures';
test('keyboard-only: compose with n, publish with Ctrl+Enter, open a chip with Enter, close with Esc', async ({ page }) => {
  await enterDemo(page);
  await page.locator('body').press('n');
  await expect(page.getByRole('textbox', { name: /What’s happening/ })).toBeFocused();
  await page.keyboard.type('keyboard e2e');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('article').filter({ hasText: 'keyboard e2e' })).toBeVisible();
  const chip = page.getByRole('button', { name: /Token \$/ }).first();
  await chip.focus();
  const outline = await chip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: /./ }).last()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chip).toBeFocused();
  await page.locator('body').press('g');
  await page.locator('body').press('m');
  await expect(page).toHaveURL(/\/messages$/);
});
test('n from a community page lands in the Home composer, not on a composer that is leaving', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/c/trenches?tab=threads');
  await expect(page.getByRole('heading', { level: 1, name: 'The Trenches' })).toBeVisible();
  await page.locator('body').press('n');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('textbox', { name: /What’s happening/ })).toBeFocused();
});
test('Ctrl+K search: type a name, Enter opens the profile', async ({ page }) => {
  await enterDemo(page);
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: /Search people, communities/ });
  await expect(box).toBeFocused();
  await box.fill('alpha_jane');
  await expect(page.getByRole('option', { name: /Jane/ })).toBeVisible();
  await box.press('Enter');
  await expect(page).toHaveURL(/\/u\/alpha_jane$/);
  await expect(box).toBeHidden();
});
