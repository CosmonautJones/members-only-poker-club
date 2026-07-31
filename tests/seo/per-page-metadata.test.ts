/**
 * AC1 / T2 — Per-page metadata overrides.
 *
 * Acceptance criterion 1 of `docs/specs/0030-seo-and-content-strategy-implementation.md`
 * requires every Slice-1 marketing page to either inherit the layout default
 * or export its own `metadata` override. T1's marketing-layout default is
 * already covered by `tests/seo/layout-metadata.test.ts`; this file covers
 * T2 — the per-page overrides on the six Slice-1 pages that must declare
 * a distinct `<title>` / `<meta name="description">`.
 *
 * For each page module we assert:
 *   1. A `metadata` object is exported (Next.js 14 App Router contract).
 *   2. `metadata.title` is a non-empty string. (The pages do NOT use the
 *      `{ template: ... }` form — that is the layout's job. Per-page
 *      overrides supply a literal slot value that the layout's
 *      `title.template` wraps.)
 *   3. `metadata.description` is a non-empty string.
 *
 * The home page (`/`) intentionally inherits the layout default per the
 * spec ("the home page (`/`) inherits defaults") and is not asserted on
 * here. The /contact page is owned by T6 and is covered by the existing
 * `tests/seo/local-business-jsonld.test.ts`; whether it carries its own
 * metadata override is also out of scope for this dispatch.
 *
 * Implementation notes:
 *   - `describe.each` parameterises the assertion across all six pages so
 *     a single failure surfaces the offending route by name in the
 *     vitest reporter (e.g. `> club page metadata > exports a metadata
 *     object ...`).
 *   - Dynamic `import()` is used because Vite's static analyser would
 *     otherwise eagerly import every page module at collection time;
 *     deferring the import keeps the file safe to load even if one page
 *     module has a transient syntax error during development.
 */

import { describe, expect, it, vi } from 'vitest';

// ADR-0037 Slice 1: the /games page now transitively imports
// `lib/tournaments/queries.ts`, which carries `'server-only'`. Neutralise the
// directive so the dynamic page imports below succeed under happy-dom.
vi.mock('server-only', () => ({}));

type PageModule = {
  metadata?: { title?: unknown; description?: unknown };
};

const pages: ReadonlyArray<{ name: string; import: () => Promise<PageModule> }> = [
  { name: 'club', import: () => import('@/app/(marketing)/club/page') },
  { name: 'games', import: () => import('@/app/(marketing)/games/page') },
  { name: 'membership', import: () => import('@/app/(marketing)/membership/page') },
  { name: 'privacy', import: () => import('@/app/(marketing)/privacy/page') },
  { name: 'terms', import: () => import('@/app/(marketing)/terms/page') },
  {
    name: 'member-agreement',
    import: () => import('@/app/(marketing)/member-agreement/page'),
  },
];

describe.each(pages)('$name page metadata (AC1 / T2)', ({ import: importPage }) => {
  it('exports a metadata object with non-empty title and description', async () => {
    const mod = await importPage();

    expect(mod.metadata).toBeDefined();
    expect(mod.metadata).not.toBeNull();
    expect(typeof mod.metadata).toBe('object');

    const title = mod.metadata?.title;
    expect(typeof title).toBe('string');
    expect((title as string).length).toBeGreaterThan(0);

    const description = mod.metadata?.description;
    expect(typeof description).toBe('string');
    expect((description as string).length).toBeGreaterThan(0);
  });
});
