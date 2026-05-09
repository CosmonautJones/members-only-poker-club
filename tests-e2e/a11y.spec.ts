/**
 * Axe-core e2e accessibility audit — ADR-0026 slice 1.
 *
 * Runs against every Slice-1 marketing route. Asserts no `serious` or
 * `critical` axe violations. `moderate` and `minor` are surfaced as test
 * output but do not fail the run; tracking those is Slice 4 work.
 */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/',
  '/games',
  '/contact',
  '/faq',
  '/membership',
  '/club',
  '/privacy',
  '/terms',
  '/member-agreement',
  '/accessibility',
] as const;

for (const route of ROUTES) {
  test(`a11y: ${route} has no serious or critical axe violations`, async ({ page }) => {
    // `domcontentloaded` is deliberately used instead of `networkidle`:
    // some marketing pages keep open keep-alive connections (Vercel analytics
    // poll, Sentry session ping) that never let `networkidle` settle within
    // the test timeout. The DOM tree we care about for axe is fully painted
    // by `domcontentloaded`; further hydration only adds attributes, not
    // landmark structure.
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      blocking,
      `Route ${route} has ${blocking.length} serious/critical a11y violation(s):\n${blocking
        .map((v) => `  ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
        .join('\n')}`,
    ).toEqual([]);
  });
}
