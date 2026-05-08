/**
 * /membership placeholder stub.
 *
 * Created by T0 of ADR-0030 so subsequent SEO tasks (T2 metadata,
 * sitemap enumeration, e2e crawl) have a route to attach to. The full
 * marketing copy and design for this page is owned by the parent slice
 * `slice-1/marketing-home-mvp` and lands separately.
 *
 * T2 (ADR-0030) added the per-page `metadata` override; the title slot
 * fills the layout's `%s | ...` template.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Membership',
  description:
    'How to join Members Only Poker Social Club: apply online, get reviewed within twenty-four hours, and start playing legal member-funded poker in Houston.',
  openGraph: {
    title: 'Membership',
    description:
      'How to join Members Only Poker Social Club: apply online, get reviewed within twenty-four hours, and start playing legal member-funded poker in Houston.',
    images: [
      {
        url: '/og?title=Membership&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Membership',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Membership',
    description:
      'Apply online, reviewed within twenty-four hours, then play member-funded poker in Houston.',
    images: ['/og?title=Membership&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function Page() {
  return (
    <main className="container mx-auto py-12">
      <h1>Membership</h1>
      <p>This page is under construction.</p>
    </main>
  );
}
