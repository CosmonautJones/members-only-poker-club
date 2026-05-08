import { expect, test } from '@playwright/test';

test('home page returns 200 and has a non-empty title', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/.+/);
});
