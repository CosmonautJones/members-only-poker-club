/**
 * AC3 / T4 — `app/sitemap.ts` must return a `MetadataRoute.Sitemap`
 * enumerating every Slice-1 marketing route plus every upcoming
 * tournament instance from the `tournaments` table.
 *
 * Per ADR-0037, the tournament rows are sourced live via
 * `fetchUpcomingTournaments`. The test mocks the query to assert the
 * shape contract without spinning up a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tournament } from '@/lib/tournaments/types';

const mocks = vi.hoisted(() => ({
  fetchUpcomingTournaments: vi.fn<() => Promise<Tournament[]>>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/tournaments/queries', () => ({
  fetchUpcomingTournaments: mocks.fetchUpcomingTournaments,
}));

import sitemap from '@/app/sitemap';

const sample = (slug: string): Tournament => ({
  id: '00000000-0000-0000-0000-000000000000',
  slug,
  name: slug,
  startsAt: '2026-07-01T00:00:00Z',
  tzName: 'America/Chicago',
  buyInCents: 0,
  capacity: 1,
  gameType: 'nlhe',
  structureMd: null,
  status: 'scheduled',
  sourceTemplateId: null,
  venueName: '',
  venueAddress: '',
});

beforeEach(() => {
  mocks.fetchUpcomingTournaments.mockReset();
});

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

  it('returns an array', async () => {
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce([]);
    const map = await sitemap();
    expect(Array.isArray(map)).toBe(true);
  });

  it('has at least 9 entries (Slice-1 marketing routes) even when tournaments query returns empty', async () => {
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce([]);
    const map = await sitemap();
    expect(map.length).toBeGreaterThanOrEqual(9);
  });

  it('includes all Slice-1 marketing routes', async () => {
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce([]);
    const map = await sitemap();
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
      const expected = slug === '/' ? '' : slug;
      expect(
        urls.some((u) =>
          slug === '/' ? u.endsWith('/') || u.endsWith(expected) : u.endsWith(expected),
        ),
        `expected sitemap to contain a URL ending in "${slug}"`,
      ).toBe(true);
    }
  });

  it('includes every upcoming tournament as a /games/<slug> route', async () => {
    const upcoming: Tournament[] = [
      sample('tuesday-bounty-2026-07-07'),
      sample('thursday-ladies-night-2026-07-09'),
    ];
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce(upcoming);
    const map = await sitemap();
    for (const t of upcoming) {
      expect(
        map.some((entry) => entry.url.endsWith(`/games/${t.slug}`)),
        `expected sitemap to contain /games/${t.slug}`,
      ).toBe(true);
    }
  });

  it('still emits the static routes when the tournament query throws', async () => {
    mocks.fetchUpcomingTournaments.mockRejectedValueOnce(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const map = await sitemap();
    // Static-route count is the floor.
    expect(map.length).toBeGreaterThanOrEqual(9);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('each entry has the required sitemap shape', async () => {
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce([sample('test-slug')]);
    const map = await sitemap();
    for (const entry of map) {
      expect(typeof entry.url).toBe('string');
      expect(entry.url.length).toBeGreaterThan(0);

      const isDate = entry.lastModified instanceof Date;
      const isString = typeof entry.lastModified === 'string';
      expect(isDate || isString, `lastModified for ${entry.url} must be Date or string`).toBe(true);

      expect(VALID_CHANGE_FREQUENCIES).toContain(
        entry.changeFrequency as (typeof VALID_CHANGE_FREQUENCIES)[number],
      );

      expect(typeof entry.priority).toBe('number');
      expect(entry.priority as number).toBeGreaterThanOrEqual(0);
      expect(entry.priority as number).toBeLessThanOrEqual(1);
    }
  });
});
