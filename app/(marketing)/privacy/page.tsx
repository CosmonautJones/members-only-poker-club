/**
 * /privacy — ADR-0023 slice 1, AC6.
 *
 * Delegates body content to lib/legal/privacy-policy.tsx so the policy
 * is versioned in the codebase and can be re-rendered from anywhere.
 *
 * The existing `metadata` export (added by ADR-0030 T2) is retained verbatim.
 */
import type { Metadata } from 'next';
import PrivacyPolicy, {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_VERSION,
} from '@/lib/legal/privacy-policy';

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
    <main className="container prose mx-auto py-12">
      <h1>Privacy</h1>
      <p className="text-text-muted text-sm">
        Effective {PRIVACY_POLICY_EFFECTIVE_DATE} (version {PRIVACY_POLICY_VERSION})
      </p>
      <PrivacyPolicy />
    </main>
  );
}
