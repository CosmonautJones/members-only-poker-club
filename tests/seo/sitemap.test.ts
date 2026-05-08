/**
 * AC3 / T4 — `app/sitemap.ts` must return a `MetadataRoute.Sitemap`
 * enumerating every Slice-1 marketing route plus every fixture-backed
 * tournament detail page.
 *
 * Required Slice-1 marketing routes (per spec §AC3):
 *   /, /club, /games, /membership, /contact, /faq, /privacy, /terms,
 *   /member-agreement
 *
 * Tournament routes are sourced from `lib/tournaments/fixtures.ts`
 * (see ADR-0030 T4 + T8). When ADR-0012 ratifies and the fixture is
 * replaced with a live data source, this test continues to assert the
 * same property: every tournament slug must appear in the sitemap.
 */
import { describe, it, expect } from 'vitest';
import sitemap from '@/app/sitemap';
import { TOURNAMENTS } from '@/lib/tournaments/fixtures';

describe('app/sitemap.ts (AC3 / T4)', () => {
  const VALID_CHANGE_FREQUENCIES = [
    'always',
    'hourly',
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'never',
  ] as const;

  it('returns an array', () => {
    const map = sitemap();
    expect(Array.isArray(map)).toBe(true);
  });

  it('has at least 11 entries (9 marketing routes + 2+ tournament fixtures)', () => {
    const map = sitemap();
    expect(map.length).toBeGreaterThanOrEqual(11);
  });

  it('includes all Slice-1 marketing routes', () => {
    const map = sitemap();
    const urls = map.map((entry) => entry.url);
    const slugs = [
      '/',
      '/club',
      '/games',
      '/membership',
      '/contact',
      '/faq',
      '/privacy',
      '/terms',
      '/member-agreement',
    ];
    for (const slug of slugs) {
      // Root `/` typically serialises as a bare base URL with no trailing
      // path segment, so accept either an empty path or `/` suffix.
      const expected = slug === '/' ? '' : slug;
      expect(
        urls.some((u) =>
          slug === '/' ? u.endsWith('/') || u.endsWith(expected) : u.endsWith(expected),
        ),
        `expected sitemap to contain a URL ending in "${slug}"`,
      ).toBe(true);
    }
  });

  it('includes every tournament fixture as a /games/<slug> route', () => {
    const map = sitemap();
    expect(TOURNAMENTS.length).toBeGreaterThanOrEqual(2);
    for (const t of TOURNAMENTS) {
      expect(
        map.some((entry) => entry.url.endsWith(`/games/${t.slug}`)),
        `expected sitemap to contain /games/${t.slug}`,
      ).toBe(true);
    }
  });

  it('each entry has the required sitemap shape', () => {
    const map = sitemap();
    for (const entry of map) {
      // url: non-empty string
      expect(typeof entry.url).toBe('string');
      expect(entry.url.length).toBeGreaterThan(0);

      // lastModified: Date | string (per MetadataRoute.Sitemap)
      const isDate = entry.lastModified instanceof Date;
      const isString = typeof entry.lastModified === 'string';
      expect(isDate || isString, `lastModified for ${entry.url} must be Date or string`).toBe(true);

      // changeFrequency: one of the allowed enum values
      expect(VALID_CHANGE_FREQUENCIES).toContain(
        entry.changeFrequency as (typeof VALID_CHANGE_FREQUENCIES)[number],
      );

      // priority: number in [0, 1]
      expect(typeof entry.priority).toBe('number');
      expect(entry.priority as number).toBeGreaterThanOrEqual(0);
      expect(entry.priority as number).toBeLessThanOrEqual(1);
    }
  });
});
