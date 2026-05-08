/**
 * /terms placeholder stub.
 *
 * Created by T0 of ADR-0030 so subsequent SEO tasks (T2 metadata,
 * sitemap enumeration, e2e crawl) have a route to attach to. The full
 * terms-of-service copy is owned by the legal/compliance work and lands
 * separately.
 *
 * T2 (ADR-0030) added the per-page `metadata` override; the title slot
 * fills the layout's `%s | ...` template.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'Terms of service for Members Only Poker Social Club: the rules of the room, your account responsibilities, and the limits of our service.',
  openGraph: {
    title: 'Terms',
    description:
      'Terms of service for Members Only Poker Social Club: the rules of the room, your account responsibilities, and the limits of our service.',
    images: [
      {
        url: '/og?title=Terms&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Terms',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Terms',
    description:
      'Terms of service: rules of the room, account responsibilities, and the limits of our service.',
    images: ['/og?title=Terms&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function Page() {
  return (
    <main className="container mx-auto py-12">
      <h1>Terms</h1>
      <p>This page is under construction.</p>
    </main>
  );
}
