/**
 * T7 / T8 — AC11 structural assertion that `app/(marketing)/layout.tsx`
 * wraps the entire layout body in `<ConsentProvider>` and that both the
 * `<CookieBanner />` and `<ConsentCustomizePanel />` are mounted as
 * descendants of the provider.
 *
 * This is intentionally a source-grep test (read the file as a string and
 * regex-match), not a runtime render. Two reasons:
 *
 *   1. The layout itself is a server component and pulls a chain of
 *      client components and Next.js-specific imports (next/link,
 *      next/image) that are awkward to mount in a happy-dom test outside
 *      the Next.js runtime.
 *   2. AC11's binding is structural: the `<ConsentProvider>` MUST be the
 *      outermost wrapper of the body (header + main + footer + banner +
 *      panel) — i.e., the source shape itself is the contract. A grep
 *      assertion captures that more directly than a render test would.
 *
 * The complementary runtime contract — provider-tree behavior across the
 * banner / panel / footer-link island — is exercised in
 * `tests/consent/integration.test.tsx`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const LAYOUT_PATH = resolve(__dirname, '../../app/(marketing)/layout.tsx');

function readLayout(): string {
  return readFileSync(LAYOUT_PATH, 'utf-8');
}

describe('app/(marketing)/layout.tsx — AC11 (T7) provider wraps body', () => {
  it('imports ConsentProvider, CookieBanner, and ConsentCustomizePanel', () => {
    const src = readLayout();
    expect(src).toMatch(
      /import\s*\{\s*ConsentProvider\s*\}\s*from\s*['"]@\/components\/site\/consent-provider['"]/,
    );
    expect(src).toMatch(
      /import\s*\{\s*CookieBanner\s*\}\s*from\s*['"]@\/components\/site\/cookie-banner['"]/,
    );
    expect(src).toMatch(
      /import\s*\{\s*ConsentCustomizePanel\s*\}\s*from\s*['"]@\/components\/site\/consent-customize-panel['"]/,
    );
  });

  it('wraps the entire body (header + main + footer + banner + panel) inside <ConsentProvider>', () => {
    const src = readLayout();

    // The opening provider tag MUST come before any of these landmarks.
    const providerOpenIdx = src.search(/<ConsentProvider\b/);
    const headerIdx = src.search(/<PublicHeader\b/);
    const mainIdx = src.search(/<main\b/);
    const footerIdx = src.search(/<PublicFooter\b/);
    const bannerIdx = src.search(/<CookieBanner\b/);
    const panelIdx = src.search(/<ConsentCustomizePanel\b/);
    const providerCloseIdx = src.search(/<\/ConsentProvider>/);

    expect(providerOpenIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(providerOpenIdx);
    expect(mainIdx).toBeGreaterThan(providerOpenIdx);
    expect(footerIdx).toBeGreaterThan(providerOpenIdx);
    expect(bannerIdx).toBeGreaterThan(providerOpenIdx);
    expect(panelIdx).toBeGreaterThan(providerOpenIdx);

    expect(providerCloseIdx).toBeGreaterThan(panelIdx);
    expect(providerCloseIdx).toBeGreaterThan(bannerIdx);
    expect(providerCloseIdx).toBeGreaterThan(footerIdx);
    expect(providerCloseIdx).toBeGreaterThan(mainIdx);
    expect(providerCloseIdx).toBeGreaterThan(headerIdx);
  });

  it('mounts <CookieBanner /> and <ConsentCustomizePanel /> as siblings inside the provider', () => {
    const src = readLayout();
    expect(src).toMatch(/<CookieBanner\s*\/>/);
    expect(src).toMatch(/<ConsentCustomizePanel\s*\/>/);
  });

  it('preserves the metadata export (no SEO regression from the wrap)', () => {
    const src = readLayout();
    expect(src).toMatch(/export\s+const\s+metadata\b/);
  });
});

describe('components/marketing/public-footer.tsx — T4/T7 cookie preferences link', () => {
  const FOOTER_PATH = resolve(__dirname, '../../components/marketing/public-footer.tsx');

  it('imports and mounts <CookiePreferencesLink />', () => {
    const src = readFileSync(FOOTER_PATH, 'utf-8');
    expect(src).toMatch(
      /import\s*\{\s*CookiePreferencesLink\s*\}\s*from\s*['"]@\/components\/site\/cookie-preferences-link['"]/,
    );
    expect(src).toMatch(/<CookiePreferencesLink\b/);
  });
});
