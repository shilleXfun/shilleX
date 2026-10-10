import { test, expect, enterDemo } from './fixtures';
test('send a DM, then find it with search', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/messages');
  await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link').first().click();
  const text = `dm e2e ${Date.now()}`;
  await page.getByRole('textbox', { name: /^Message / }).fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log').getByText(text)).toBeVisible();
  await page.getByRole('textbox', { name: 'Search conversations and messages' }).fill('dm e2e');
  await expect(page.getByRole('region', { name: 'Message search results' }).getByText(/dm e2e/)).toBeVisible();
});
