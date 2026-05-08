import { test, expect } from '@playwright/test';

// NOTE: this spec is structural — it cannot run on the dev host because port 3000
// is reserved by Hyper-V. CI runs it against the Vercel preview URL via the
// PLAYWRIGHT_BASE_URL env var. Local runtime gate is deferred to ADR-0017's CI
// workflow (CONDUCTOR retrospective: structural-deferral-pattern).

test.describe('Cookie consent flow', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('first visit shows banner with three actions', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('region', { name: /cookie/i });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: /accept all/i })).toBeVisible();
    await expect(banner.getByRole('button', { name: /essential only/i })).toBeVisible();
    await expect(banner.getByRole('button', { name: /customize/i })).toBeVisible();
  });

  test('Essential only writes cookie + dismisses banner + survives reload', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /essential only/i }).click();
    await expect(page.getByRole('region', { name: /cookie/i })).not.toBeVisible();

    const cookies = await context.cookies();
    const consent = cookies.find((c) => c.name === 'mopc-consent');
    expect(consent).toBeDefined();
    const decoded = JSON.parse(decodeURIComponent(consent!.value));
    expect(decoded).toEqual({ essential: true, analytics: false, errors: false, version: 1 });

    // Reload — banner stays gone
    await page.reload();
    await expect(page.getByRole('region', { name: /cookie/i })).not.toBeVisible();
  });

  test('Accept all writes the all-true cookie', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /accept all/i }).click();
    const cookies = await context.cookies();
    const decoded = JSON.parse(
      decodeURIComponent(cookies.find((c) => c.name === 'mopc-consent')!.value),
    );
    expect(decoded).toEqual({ essential: true, analytics: true, errors: true, version: 1 });
  });

  test('Customize → Analytics on → Save persists analytics: true', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /customize/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: /analytics/i }).check();
    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('region', { name: /cookie/i })).not.toBeVisible();

    const cookies = await context.cookies();
    const decoded = JSON.parse(
      decodeURIComponent(cookies.find((c) => c.name === 'mopc-consent')!.value),
    );
    expect(decoded.analytics).toBe(true);
    expect(decoded.errors).toBe(false);
  });

  test('Footer Cookie preferences link re-opens panel after consent given', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /essential only/i }).click();
    await expect(page.getByRole('region', { name: /cookie/i })).not.toBeVisible();

    // Find the footer link and click it
    const link = page.getByRole('button', { name: /cookie preferences/i });
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('Esc closes the customize panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /customize/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Locked Essential category cannot be toggled', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /customize/i }).click();
    const essentialCheckbox = page.getByRole('checkbox', { name: /^essential/i });
    await expect(essentialCheckbox).toBeDisabled();
    await expect(essentialCheckbox).toBeChecked();
  });
});
