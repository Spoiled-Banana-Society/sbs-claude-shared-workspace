import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('can navigate to draft lobby', async ({ page }) => {
    await page.goto('/draft-lobby');
    await expect(page).toHaveURL(/draft-lobby/);
  });

  test('can navigate to standings', async ({ page }) => {
    await page.goto('/standings');
    await expect(page).toHaveURL(/standings/);
  });

  test('can navigate to rankings', async ({ page }) => {
    await page.goto('/rankings');
    await expect(page).toHaveURL(/rankings/);
  });

  test('can navigate to buy-drafts', async ({ page }) => {
    await page.goto('/buy-drafts');
    await expect(page).toHaveURL(/buy-drafts/);
  });

  test('can navigate to history', async ({ page }) => {
    await page.goto('/history');
    await expect(page).toHaveURL(/history/);
  });

  test('can navigate to prizes', async ({ page }) => {
    await page.goto('/winnings');
    await expect(page).toHaveURL(/winnings/);
  });

  test('can navigate to FAQ', async ({ page }) => {
    await page.goto('/faq');
    await expect(page).toHaveURL(/faq/);
  });
});
