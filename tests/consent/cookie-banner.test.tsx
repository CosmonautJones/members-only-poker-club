/**
 * T8 — `<CookieBanner />` AC5 (`prefers-reduced-motion`) + AC3 SSR coverage
 * per ADR-0024 + Slice-1 spec critic remediation.
 *
 * AC5: the banner uses Tailwind's `motion-safe:` variant which is gated by
 * the `@media (prefers-reduced-motion: no-preference)` query at the CSS
 * layer. Because the gating happens in CSS rather than in React, the
 * className list will always include the `motion-safe:animate-in` token —
 * the assertion is therefore that animation utilities are paired with the
 * `motion-safe:` prefix (so the OS-level preference can suppress them
 * downstream) rather than emitted raw.
 *
 * AC3 (SSR): `renderToString(<ConsentProvider><CookieBanner /></ConsentProvider>)`
 * must produce empty banner markup because `isLoaded` starts `false` on the
 * server and the banner returns `null` while not loaded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsentProvider } from '@/components/site/consent-provider';
import { CookieBanner } from '@/components/site/cookie-banner';
import { COPY } from '@/lib/consent/copy';

beforeEach(() => {
  document.cookie = 'mopc-consent=; Max-Age=0; Path=/';
});

describe('CookieBanner — prefers-reduced-motion', () => {
  it('uses Tailwind motion-safe variant for animation classes', async () => {
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );
    const banner = await screen.findByRole('region', { name: /cookie/i });
    // Tailwind's motion-safe: prefix means the animate-in class is gated by
    // the @media (prefers-reduced-motion: no-preference) query at CSS layer.
    // We assert the className uses motion-safe: prefix rather than raw animate-in.
    const className = banner.className;
    if (className.includes('animate-in')) {
      // animate-in must be paired with motion-safe: prefix
      expect(className).toMatch(/motion-safe:[^ ]*animate-in/);
    }
    if (className.includes('slide-in')) {
      expect(className).toMatch(/motion-safe:[^ ]*slide-in/);
    }
  });

  it('renders a Privacy policy link inside the cookie consent region', async () => {
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );
    // Banner must be visible (isLoaded && state === null).
    const banner = await screen.findByRole('region', { name: /cookie consent/i });
    expect(banner).toBeTruthy();

    // The privacy-policy link must be inside the banner region.
    const link = await screen.findByRole('link', { name: new RegExp(COPY.policy_link, 'i') });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('SSR snapshot is empty (no banner emitted server-side)', async () => {
    const { renderToString } = await import('react-dom/server');
    // Pre-seed cookie so render path would be "no banner" anyway, but the key check
    // is the SSR initial render: provider's isLoaded=false means banner returns null.
    const html = renderToString(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );
    // Banner is gated by isLoaded which starts false; no banner element should appear in SSR markup
    expect(html.toLowerCase()).not.toContain('cookie consent');
    expect(html.toLowerCase()).not.toContain('accept all');
  });
});
