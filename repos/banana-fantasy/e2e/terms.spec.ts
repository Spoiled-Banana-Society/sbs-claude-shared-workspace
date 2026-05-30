import { test, expect } from '@playwright/test';

test.describe('Terms of Service Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/terms');
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByText('Terms of Service')).toBeVisible();
  });

  test('renders last updated date', async ({ page }) => {
    await expect(page.getByText(/last updated/i)).toBeVisible();
  });

  test('renders all 12 sections', async ({ page }) => {
    const sections = [
      'Acceptance of Terms',
      'Eligibility',
      'Account Creation',
      'Draft Passes',
      'Prize Distribution',
      'Provably Fair RNG',
      'Prohibited Conduct',
      'Intellectual Property',
      'Limitation of Liability',
      'Dispute Resolution',
      'Privacy',
      'Contact Information',
    ];

    for (const section of sections) {
      await expect(page.getByText(section, { exact: false }).first()).toBeVisible();
    }
  });

  test('desktop ToC sidebar has clickable links', async ({ page, isMobile }) => {
    if (isMobile) return; // Skip on mobile — ToC is hidden
    const tocButton = page.locator('nav[aria-label="Table of contents"] button').first();
    await expect(tocButton).toBeVisible();
    await tocButton.click();
    // Should scroll to section (no crash)
    await page.waitForTimeout(500);
  });

  test('mobile accordion opens sections', async ({ page, isMobile }) => {
    if (!isMobile) return; // Skip on desktop
    const firstAccordion = page.getByRole('button', { name: /acceptance of terms/i });
    await firstAccordion.click();
    await expect(page.getByText(/agree to be bound/i)).toBeVisible();
  });

  test('contact section has email link', async ({ page }) => {
    await expect(page.getByText('team@sbsfantasy.com').first()).toBeVisible();
  });
});
