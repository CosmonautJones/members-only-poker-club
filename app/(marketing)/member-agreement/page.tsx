/**
 * /member-agreement placeholder stub.
 *
 * Created by T0 of ADR-0030 so subsequent SEO tasks (T2 metadata,
 * sitemap enumeration, e2e crawl) have a route to attach to. The full
 * member-agreement copy is owned by the legal/compliance work and lands
 * separately.
 *
 * T2 (ADR-0030) added the per-page `metadata` override; the title slot
 * fills the layout's `%s | ...` template.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Member Agreement',
  description:
    'The Member Agreement for Members Only Poker Social Club: house rules, code of conduct, and the terms every approved member accepts at signup.',
  openGraph: {
    title: 'Member Agreement',
    description:
      'The Member Agreement for Members Only Poker Social Club: house rules, code of conduct, and the terms every approved member accepts at signup.',
    images: [
      {
        url: '/og?title=Member%20Agreement&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Member Agreement',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Member Agreement',
    description:
      'House rules, code of conduct, and the terms every approved member accepts at signup.',
    images: ['/og?title=Member%20Agreement&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function Page() {
  return (
    <main className="container mx-auto py-12">
      <h1>Member Agreement</h1>
      <p>This page is under construction.</p>
    </main>
  );
}
