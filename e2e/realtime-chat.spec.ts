import { test, expect, enterDemo, signUp } from './fixtures';
test('channel messages and typing appear live in another session', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await enterDemo(a);
  await signUp(b, `e2e_${Date.now() % 1e6}`);
  await a.goto('/c/trenches');
  await b.goto('/c/trenches');
  await b.getByRole('button', { name: 'Join' }).first().click();
  await a.waitForURL(/\/c\/trenches\/.+/);
  await b.waitForURL(/\/c\/trenches\/.+/);
  const bBox = b.getByRole('textbox', { name: 'Message #general' });
  await bBox.pressSequentially('hello from b');
  await expect(a.getByText(/is typing…/)).toBeVisible();
  await bBox.press('Enter');
  await expect(a.getByRole('log').getByText('hello from b')).toBeVisible();
});
