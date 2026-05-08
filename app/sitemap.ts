import type { MetadataRoute } from 'next';
import { TOURNAMENTS } from '@/lib/tournaments/fixtures';

// Canonical production domain. Aligned with `app/robots.ts` and `app/layout.tsx`
// so all three SEO surfaces reference the same env var + fallback (ADR-0033 §Decision).
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://membersonlypoker.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

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

  const tournamentRoutes: MetadataRoute.Sitemap = TOURNAMENTS.map((t) => ({
    url: `${BASE_URL}/games/${t.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...tournamentRoutes];
}
