import { test as base, expect, type Page } from '@playwright/test';
export const DEMO_TOKEN_SYMBOL = 'GRUB';
/** The signed-in shell: the left nav on desktop, the bottom tab bar on phones. */
const shell = (page: Page) => page.getByRole('navigation', { name: 'Main' }).or(page.getByRole('navigation', { name: 'Tabs' }));
export async function enterDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Enter the demo world' }).click();
  await expect(shell(page)).toBeVisible();
}
export async function signUp(page: Page, username: string) {
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Display name').fill(username);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(shell(page)).toBeVisible();
}
export const test = base;
export { expect };
