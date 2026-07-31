import type { MetadataRoute } from 'next';
import { nowUtc } from '@/lib/time';
import { fetchUpcomingTournaments } from '@/lib/tournaments/queries';

// Canonical production domain. Aligned with `app/robots.ts` and `app/layout.tsx`
// so all three SEO surfaces reference the same env var + fallback (ADR-0033 §Decision).
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://membersonlypokersocial.com';

/**
 * Per ADR-0037, tournament URLs come from the live `tournaments` table.
 * The sitemap takes a wider window (90 days) than `/games` itself (30 days)
 * so search engines see future events that haven't yet been promoted to
 * the on-page upcoming-events list. If the query fails (DB outage at
 * build/runtime), the sitemap still emits the static routes — search
 * engines re-crawl on their own cadence.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = nowUtc();

  const staticRoutes: MetadataRoute.Sitemap = [
    '/',
    '/club',
    '/games',
    '/membership',
    '/contact',
    '/faq',
    '/privacy',
    '/terms',
    '/member-agreement',
  ].map((path) => ({
    url: `${BASE_URL}${path === '/' ? '' : path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: path === '/' ? 1.0 : 0.7,
  }));

  let tournamentRoutes: MetadataRoute.Sitemap = [];
  try {
    const upcoming = await fetchUpcomingTournaments({ days: 90 });
    tournamentRoutes = upcoming.map((t) => ({
      url: `${BASE_URL}/games/${t.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }));
  } catch (err) {
    // No tournament routes on error — static routes still emit so the
    // sitemap is not empty. Log so Sentry captures the outage.
    console.error(
      JSON.stringify({
        event: 'sitemap_tournament_query_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return [...staticRoutes, ...tournamentRoutes];
}
