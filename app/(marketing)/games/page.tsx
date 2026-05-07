/**
 * /games placeholder stub.
 *
 * Created by T0 of ADR-0030 so subsequent SEO tasks (T2 metadata,
 * sitemap enumeration, e2e crawl) have a route to attach to. The full
 * marketing copy and design for this page is owned by the parent slice
 * `slice-1/marketing-home-mvp` and lands separately.
 *
 * T2 (ADR-0030) added the per-page `metadata` override; the title slot
 * fills the layout's `%s | ...` template. The page also lists the
 * Slice-1 tournament fixture so visitors can navigate to the per-event
 * `/games/[slug]` detail routes (where the Event JSON-LD is mounted).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { TOURNAMENTS } from '@/lib/tournaments/fixtures';

export const metadata: Metadata = {
  title: 'Games',
  description:
    'Tonight at Members Only Poker Social Club: live cash games, tournament schedule, and the full board for tournaments and member events in Houston.',
  openGraph: {
    title: 'Games',
    description:
      'Tonight at Members Only Poker Social Club: live cash games, tournament schedule, and the full board for tournaments and member events in Houston.',
    images: [
      {
        url: '/og?title=Games&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Games',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Games',
    description:
      'Live cash games, tournament schedule, and the full board for member events in Houston.',
    images: ['/og?title=Games&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function Page() {
  return (
    <main className="container mx-auto py-12">
      <h1>Games</h1>
      <p>This page is under construction.</p>
      <h2>Tournaments</h2>
      <ul>
        {TOURNAMENTS.map((t) => (
          <li key={t.slug}>
            <Link href={`/games/${t.slug}`}>{t.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
