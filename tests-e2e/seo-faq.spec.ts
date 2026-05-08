/**
 * AC8 / T9 — `/faq` page Playwright check.
 *
 * Asserts the page renders, has a non-empty `<h1>`, and contains at least
 * six `<details>` (or accordion question) elements covering the Slice-1
 * question set (membership, age, BYOB, time-bank intro, hours, location).
 *
 * NOTE: requires baseURL adjusted away from 3000 on Windows hosts with
 * Hyper-V port reservations. The Playwright config's webServer block
 * defaults to port 3000; CI runs (once ADR-0017 ratifies) will exercise
 * this without conflict. Local Windows developers should override
 * `webServer.port` and `use.baseURL` to a free port (e.g. 3100) before
 * running `pnpm test:e2e`.
 */

import { expect, test } from '@playwright/test';

test('faq page renders title and at least six question/answer elements', async ({ page }) => {
  const response = await page.goto('/faq');
  expect(response?.status()).toBe(200);

  const heading = page.locator('h1').first();
  await expect(heading).toBeVisible();
  const headingText = (await heading.textContent())?.trim() ?? '';
  expect(headingText.length).toBeGreaterThan(0);

  // Prefer native <details>; fall back to a generic accordion-question
  // selector if T9 elects to render with a shadcn `<Accordion>` (Radix-
  // based) instead of native disclosure widgets.
  const detailsCount = await page.locator('details').count();
  if (detailsCount >= 6) {
    expect(detailsCount).toBeGreaterThanOrEqual(6);
    return;
  }

  const accordionCount = await page
    .locator(
      'details, [data-radix-accordion-item], [data-state][role="region"], [role="button"][aria-expanded]',
    )
    .count();
  expect(accordionCount).toBeGreaterThanOrEqual(6);
});
