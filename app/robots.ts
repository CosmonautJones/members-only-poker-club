/**
 * Robots metadata route — `/robots.txt`.
 *
 * Allows public crawling of the marketing surface; disallows the
 * member portal, cashier console, admin dashboard, and the API
 * surface, per ADR-0030 acceptance criterion 4.
 *
 * The `sitemap` URL points at `/sitemap.xml`; T4 of ADR-0030 lands
 * `app/sitemap.ts`. The base URL prefers `NEXT_PUBLIC_APP_URL` (set
 * per-environment) and falls back to the canonical production
 * domain `https://membersonlypoker.com` (per the domain cascade in
 * journal entry 2026-05-05-04).
 */

import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://membersonlypoker.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/admin', '/cashier', '/dashboard', '/api'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
