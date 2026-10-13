import { test, expect } from './fixtures';
import { installFakeWallet } from './fake-wallet';

const shell = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main' }).or(page.getByRole('navigation', { name: 'Tabs' }));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

test('wallet signup, logout, wallet login, a second wallet in settings, and the last-method guard', async ({ page }) => {
  const one = await installFakeWallet(page, { id: 'one', name: 'Shillex Test Wallet', mode: 'signIn' });
  const two = await installFakeWallet(page, { id: 'two', name: 'Second Test Wallet', mode: 'message' });

  await page.goto('/signup');
  await page.getByRole('button', { name: 'Continue with a wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Shillex Test Wallet/ }).click();
  await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
  await page.getByLabel('Username').fill('wallet_rider');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(shell(page)).toBeVisible();

  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with a wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Shillex Test Wallet/ }).click();
  await expect(shell(page)).toBeVisible();

  await page.goto('/settings');
  const list = page.getByRole('list', { name: 'Linked wallets' });
  await expect(list.getByText(short(one.address))).toBeVisible();
  // A session alone can't add a wallet: this wallet-only account first confirms with the wallet it already has.
  await expect(page.getByRole('button', { name: 'Add a wallet' })).toBeDisabled();
  await page.getByRole('button', { name: 'Confirm with a linked wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Shillex Test Wallet/ }).click();
  await expect(page.getByRole('button', { name: 'Add a wallet' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Second Test Wallet/ }).click();
  await expect(list.getByText(short(two.address))).toBeVisible();

  await page.getByRole('button', { name: `Remove wallet ${short(two.address)}` }).click();
  await expect(list.getByText(short(two.address))).toHaveCount(0);
  await page.getByRole('button', { name: `Remove wallet ${short(one.address)}` }).click();
  await expect(page.getByText(/last way to sign in/)).toBeVisible();
  await expect(list.getByText(short(one.address))).toBeVisible();

  // The owner heard about both changes.
  const notes = (await (await page.request.get('/api/notifications')).json()).items as { type: string; text: string }[];
  expect(notes.filter((n) => n.type === 'sign_in_change').map((n) => n.text.includes('linked') ? 'linked' : 'removed')).toEqual(['removed', 'linked']);
});
