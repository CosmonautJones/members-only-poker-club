/**
 * /privacy placeholder stub.
 *
 * Created by T0 of ADR-0030 so subsequent SEO tasks (T2 metadata,
 * sitemap enumeration, e2e crawl) have a route to attach to. The full
 * privacy-policy copy is owned by the legal/compliance work and lands
 * separately.
 *
 * T2 (ADR-0030) added the per-page `metadata` override; the title slot
 * fills the layout's `%s | ...` template.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'Privacy policy for Members Only Poker Social Club: what we collect, how we use it, and the choices members have about their personal information.',
  openGraph: {
    title: 'Privacy',
    description:
      'Privacy policy for Members Only Poker Social Club: what we collect, how we use it, and the choices members have about their personal information.',
    images: [
      {
        url: '/og?title=Privacy&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Privacy',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Privacy',
    description: 'Privacy policy: what we collect, how we use it, and the choices members have.',
    images: ['/og?title=Privacy&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function Page() {
  return (
    <main className="container mx-auto py-12">
      <h1>Privacy</h1>
      <p>This page is under construction.</p>
    </main>
  );
}
