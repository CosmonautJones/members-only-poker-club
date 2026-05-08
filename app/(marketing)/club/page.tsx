/**
 * /club placeholder stub.
 *
 * Created by T0 of ADR-0030 so subsequent SEO tasks (T2 metadata,
 * sitemap enumeration, e2e crawl) have a route to attach to. The full
 * marketing copy and design for this page is owned by the parent slice
 * `slice-1/marketing-home-mvp` and lands separately.
 *
 * T2 (ADR-0030) added the per-page `metadata` override; the title slot
 * fills the layout's `%s | ...` template. Description copy is brand-aligned
 * and ~150 chars per the spec.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Our Club',
  description:
    'Inside Members Only Poker Social Club: twelve tournament-grade tables, trained dealers, and a private members-only room in Houston, Texas.',
  openGraph: {
    title: 'Our Club',
    description:
      'Inside Members Only Poker Social Club: twelve tournament-grade tables, trained dealers, and a private members-only room in Houston, Texas.',
    images: [
      {
        url: '/og?title=Our%20Club&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Our Club',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our Club',
    description:
      'Inside Members Only Poker Social Club: twelve tables, trained dealers, a private room in Houston.',
    images: ['/og?title=Our%20Club&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function Page() {
  return (
    <main className="container mx-auto py-12">
      <h1>Club</h1>
      <p>This page is under construction.</p>
    </main>
  );
}
