/**
 * Shared helpers for the admin-page a11y test suite (ADR-0035 AC33,
 * WD.T23 / t20).
 *
 * Contract per AC33:
 *   - RTL renders the admin page tree under happy-dom.
 *   - `axe(container)` evaluates the rendered DOM against the WCAG 2.1
 *     A + AA rule packs.
 *   - The assertion is "NO serious or critical violations." `moderate`
 *     and `minor` are intentionally NOT failing here — the e2e
 *     `tests-e2e/a11y.spec.ts` is the formal-audit surface (ADR-0026).
 *
 * Why a thin wrapper rather than the `expect(results).toHaveNoViolations()`
 * matcher from `vitest-axe`:
 *   - The matcher fails on ANY impact level (including `moderate` /
 *     `minor`), but AC33's contract is the serious+critical subset.
 *   - A bespoke filter keeps the assertion grep-able from the task
 *     dispatch — anyone reading the test sees exactly what's asserted.
 *
 * Suspense unwrapping: happy-dom does not run the React server-renderer's
 * Suspense streaming, so async Server Components inside a `<Suspense>`
 * never materialize. `resolveAsyncChildren` recursively awaits Promise
 * children and calls async function components so the resolved tree is
 * what gets handed to `render()` and axe-core. The walker mirrors the
 * one in `tests/admin/verifications-page.test.tsx` (kept in sync —
 * any change there should land here too).
 */

import { axe } from 'vitest-axe';
import { expect } from 'vitest';
import type { AxeResults, ImpactValue, Result, RunOptions } from 'axe-core';
import * as React from 'react';

/**
 * Axe options tuned for the admin surface:
 *   - WCAG 2.1 A + AA rule packs only. `wcag2aaa` is intentionally out
 *     of scope; it would force unnecessary contrast escalation beyond
 *     ADR-0026's stated Level AA target.
 *   - `color-contrast` is disabled because:
 *     (a) the admin palette uses CSS custom properties (`var(--ivory-…)`)
 *         which happy-dom does not evaluate — axe sees `var(...)` as
 *         the literal computed value `''` and false-positives every
 *         text node;
 *     (b) the e2e a11y suite (`tests-e2e/a11y.spec.ts`) runs against a
 *         live page where contrast is meaningful, and that's the right
 *         surface to gate contrast.
 *   - `region` is disabled because the admin pages render WITHOUT the
 *     `(admin)/layout.tsx` wrapper in unit tests (the layout adds the
 *     `<main>` landmark); the page-level test only covers the page's
 *     own DOM. The layout's landmark contract is covered separately.
 */
const ADMIN_A11Y_AXE_OPTIONS: RunOptions = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
};

/**
 * Run axe-core against the rendered container and assert NO serious or
 * critical violations exist. `moderate` and `minor` violations are
 * tolerated at this layer per AC33's stated impact gate.
 *
 * @param container The DOM node returned by RTL's `render({ container })`.
 */
export async function expectNoSeriousAxeViolations(container: Element): Promise<void> {
  const results: AxeResults = (await axe(container, ADMIN_A11Y_AXE_OPTIONS)) as AxeResults;
  const blocking: Result[] = results.violations.filter(
    (v) => v.impact === ('serious' as ImpactValue) || v.impact === ('critical' as ImpactValue),
  );
  expect(
    blocking,
    blocking.length === 0
      ? 'No serious or critical axe violations'
      : `Found ${blocking.length} serious/critical axe violation(s):\n${blocking
          .map(
            (v) =>
              `  ${v.id} [${v.impact}]: ${v.description}\n    nodes: ${v.nodes
                .map((n) => n.target.join(' '))
                .join(', ')}`,
          )
          .join('\n')}`,
  ).toEqual([]);
}

/**
 * Walk a React tree and materialize async function components and
 * Promise children. Returns the fully-resolved element tree ready for
 * RTL `render`. Mirrors `tests/admin/verifications-page.test.tsx`'s
 * `resolveAsyncChildren` — any change here should land there too.
 */
export async function resolveAsyncChildren(
  node: React.ReactNode,
): Promise<React.ReactElement> {
  if (
    node &&
    typeof node === 'object' &&
    'then' in (node as object) &&
    typeof (node as Promise<unknown>).then === 'function'
  ) {
    const awaited = (await node) as React.ReactNode;
    return resolveAsyncChildren(awaited);
  }
  if (!node || typeof node !== 'object' || !('props' in (node as object))) {
    return node as React.ReactElement;
  }
  const el = node as React.ReactElement & { type: unknown };
  if (typeof el.type === 'function') {
    const fn = el.type as (props: Record<string, unknown>) => unknown;
    try {
      const ret = fn(el.props as Record<string, unknown>);
      if (ret && typeof ret === 'object' && 'then' in ret) {
        const awaited = (await (ret as Promise<unknown>)) as React.ReactNode;
        return resolveAsyncChildren(awaited);
      }
    } catch {
      // pass through — non-async component or threw on first call
    }
  }
  const props = el.props as { children?: React.ReactNode };
  if (props.children !== undefined) {
    if (Array.isArray(props.children)) {
      const newKids = await Promise.all(
        props.children.map(async (k, i) => {
          const resolved = await resolveAsyncChildren(k);
          if (
            resolved &&
            typeof resolved === 'object' &&
            'props' in (resolved as object) &&
            (resolved as React.ReactElement).key == null
          ) {
            return { ...(resolved as React.ReactElement), key: `__t-${i}` };
          }
          return resolved;
        }),
      );
      return { ...el, props: { ...el.props, children: newKids } };
    }
    const newChild = await resolveAsyncChildren(props.children);
    return { ...el, props: { ...el.props, children: newChild } };
  }
  return el;
}

/**
 * Stock manager profile object used by every admin a11y test. Matches
 * the shape returned by `requireRole('manager')` so the SUT's first
 * body statement resolves to a populated profile without per-test
 * fixture setup.
 */
export const BASE_MANAGER_PROFILE = {
  id: 'uuid-test-manager',
  role: 'manager' as const,
  full_name: 'Test Manager',
  email: 'manager@example.com',
};
