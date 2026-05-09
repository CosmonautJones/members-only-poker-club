/**
 * Public marketing route group layout.
 *
 * Wraps every page under `app/(marketing)/*` with the public header
 * and footer. Inherits fonts from the root layout. The `metadata`
 * export here defines the marketing-surface defaults: title template,
 * description, OpenGraph and Twitter card. `metadataBase` is set in
 * `app/layout.tsx` and inherited by all routes.
 *
 * Per ADR-0030 (SEO & content strategy), every marketing page either
 * inherits these defaults or exports its own `metadata` override.
 *
 * T7 — Per ADR-0024 + Slice-1 spec AC11, the entire layout body
 * (header, main, footer, banner, customize panel) is wrapped in
 * `<ConsentProvider>`. The provider must be an ancestor of every
 * component that calls `useConsent()` — the banner, the panel, AND
 * the footer's `<CookiePreferencesLink />`. Both `<CookieBanner />`
 * and `<ConsentCustomizePanel />` mount as siblings of the page
 * content but inside the provider so they share one modal instance
 * and one cookie state.
 */

import type { Metadata } from 'next';

import { PublicFooter } from '@/components/marketing/public-footer';
import { PublicHeader } from '@/components/marketing/public-header';
import { ConsentProvider } from '@/components/site/consent-provider';
import { CookieBanner } from '@/components/site/cookie-banner';
import { ConsentCustomizePanel } from '@/components/site/consent-customize-panel';

const DEFAULT_OG_IMAGE =
  '/og?title=Members%20Only%20Poker%20Social%20Club&subtitle=Private%20Poker%20Club';

// Intersection with `Record<string, unknown>` keeps the export valid as a
// Next.js `Metadata` while also being inspectable as a plain bag-of-keys
// in vitest (`tests/seo/layout-metadata.test.ts` casts to that shape).
export const metadata: Metadata & Record<string, unknown> = {
  title: {
    default: 'Members Only Poker Social Club',
    template: '%s | Members Only Poker Social Club',
  },
  description:
    'A private social club for legal, member-funded poker in Houston, Texas. Membership by application. 21+. No rake.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Members Only Poker Social Club',
    title: 'Members Only Poker Social Club',
    description:
      'A private social club for legal, member-funded poker in Houston, Texas. Membership by application. 21+. No rake.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Members Only Poker Social Club',
    description:
      'A private social club for legal, member-funded poker in Houston, Texas. Membership by application. 21+. No rake.',
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsentProvider>
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
      <CookieBanner />
      <ConsentCustomizePanel />
    </ConsentProvider>
  );
}
