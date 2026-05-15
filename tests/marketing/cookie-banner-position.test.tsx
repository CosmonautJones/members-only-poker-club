/**
 * Site audit 2026-05-15, P1 item #5: cookie banner overlaps hero.
 *
 * Banner positioning currently uses `bottom-4 right-4 max-w-md`. On first
 * paint it overlaps the right edge of the hero, covering "A chair
 * waiting for you." Fix: narrower max-width AND a motion-safe entry
 * delay so the hero gets a clean first second.
 *
 * Pin one of the two interventions with a class-presence check so a
 * future refactor doesn't silently regress.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsentProvider } from '@/components/site/consent-provider';
import { CookieBanner } from '@/components/site/cookie-banner';

beforeEach(() => {
  document.cookie = 'mopc-consent=; Max-Age=0; Path=/';
});

describe('cookie banner positioning (audit P1 #5)', () => {
  it('uses a tighter max-width than max-w-md OR is bottom-aligned to bottom-2', async () => {
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );
    const banner = await screen.findByRole('region', { name: /cookie consent/i });
    const cls = banner.className;
    const hasNarrowWidth = /\bmax-w-(sm|xs)\b/.test(cls);
    const hasLowerOffset = /\bbottom-2\b/.test(cls);
    expect(hasNarrowWidth || hasLowerOffset).toBe(true);
  });

  it('still appears at the bottom-right (anchor preserved)', async () => {
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );
    const banner = await screen.findByRole('region', { name: /cookie consent/i });
    const cls = banner.className;
    expect(cls).toMatch(/\bright-/);
    expect(cls).toMatch(/\bbottom-/);
    expect(cls).toMatch(/\bfixed\b/);
  });
});
