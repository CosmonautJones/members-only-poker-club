import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Font weights are intentionally minimal. Audit `grep -rn 'font-weight\|fontWeight\|font-bold\|font-semibold'`
// before adding more — every extra weight is an LCP cost on the home hero.
//
//   Cormorant Garamond: 400 (body), 500 (headings + hero), 600 (primitive numerals);
//                       italic only for 400/500 (via <em>); no 700 in use.
//   Inter:              400 (body), 500 (eyebrow / button), 600 (button-emphasis);
//                       no 700 in use anywhere.
//   JetBrains Mono:     400, 500 (only used for the live ticker).
const fontDisplay = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const fontSans = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://membersonlypoker.com'),
  title: {
    default: 'Members Only Poker Social Club',
    template: '%s · Members Only Poker Social Club',
  },
  description:
    'A private social club for legal, member-funded poker. Membership by application. 21+. Texas.',
  openGraph: {
    type: 'website',
    siteName: 'Members Only Poker Social Club',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0B0B0B',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
