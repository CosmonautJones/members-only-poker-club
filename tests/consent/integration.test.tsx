/**
 * T8 — Cross-component consent integration tests per ADR-0024 + Slice-1
 * spec AC10, AC11.
 *
 * Wave-3 covered each component in isolation; this suite binds the
 * provider-tree contract: banner + panel + footer-link island all share
 * one `<ConsentProvider>` and therefore one cookie state and one modal
 * instance (concern 4 + 5).
 *
 * Tests:
 *   1. Banner -> Customize -> toggle Analytics -> Save flow persists the
 *      cookie and dismisses the banner.
 *   2. Footer link re-opens the panel after consent has been given (the
 *      banner is hidden but the panel is reachable).
 *   3. Esc closes the panel via Radix's built-in keyboard handling.
 *
 * happy-dom + Radix Dialog Portal: the dialog renders into a portal that
 * is appended to `document.body`. happy-dom supports `document.body`
 * portals reliably; we render the panel inside the same provider tree so
 * `useConsent()` resolves correctly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConsentProvider } from '@/components/site/consent-provider';
import { CookieBanner } from '@/components/site/cookie-banner';
import { ConsentCustomizePanel } from '@/components/site/consent-customize-panel';
import { CookiePreferencesLink } from '@/components/site/cookie-preferences-link';
import type { ConsentState } from '@/lib/consent/cookie';

const COOKIE_NAME = 'mopc-consent';

function clearCookie(): void {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
}

function seedCookie(state: ConsentState): void {
  const encoded = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${COOKIE_NAME}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readCookieState(): ConsentState | null {
  const segment = document.cookie.split(`${COOKIE_NAME}=`)[1];
  if (!segment) return null;
  const value = segment.split(';')[0] ?? '';
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value)) as ConsentState;
  } catch {
    return null;
  }
}

beforeEach(() => {
  clearCookie();
});

afterEach(() => {
  clearCookie();
});

describe('Consent flow integration (T7 wiring + T2/T3/T4)', () => {
  it('banner Customize -> panel opens -> toggle Analytics -> Save persists cookie + dismisses banner', async () => {
    const user = userEvent.setup();

    render(
      <ConsentProvider>
        <CookieBanner />
        <ConsentCustomizePanel />
        <CookiePreferencesLink />
      </ConsentProvider>,
    );

    // Banner appears post-hydration when no cookie is present.
    expect(await screen.findByRole('region', { name: /cookie consent/i })).toBeInTheDocument();

    // Click Customize -> panel opens.
    await user.click(screen.getByRole('button', { name: /customize/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Toggle Analytics on (Essential is locked + already checked).
    const analyticsCheckbox = await screen.findByRole('checkbox', { name: /analytics/i });
    expect(analyticsCheckbox).not.toBeChecked();
    await user.click(analyticsCheckbox);
    expect(analyticsCheckbox).toBeChecked();

    // Save preferences.
    await user.click(screen.getByRole('button', { name: /save preferences/i }));

    // Cookie was persisted with Analytics on, Errors off.
    await waitFor(() => {
      const persisted = readCookieState();
      expect(persisted).toEqual({
        essential: true,
        analytics: true,
        errors: false,
        version: 1,
      });
    });

    // Banner is gone now that consent has been given.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
    });
  });

  it('footer Cookie preferences link re-opens the panel after consent has been given', async () => {
    seedCookie({ essential: true, analytics: false, errors: false, version: 1 });
    const user = userEvent.setup();

    render(
      <ConsentProvider>
        <CookieBanner />
        <ConsentCustomizePanel />
        <CookiePreferencesLink />
      </ConsentProvider>,
    );

    // Banner does NOT show (cookie present).
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
    });

    // Footer link opens the same panel instance (concern 5).
    await user.click(screen.getByRole('button', { name: /cookie preferences/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('Esc key closes the customize panel (Radix Dialog default — AC6)', async () => {
    const user = userEvent.setup();

    render(
      <ConsentProvider>
        <CookieBanner />
        <ConsentCustomizePanel />
      </ConsentProvider>,
    );

    // Open via the banner Customize button.
    await user.click(await screen.findByRole('button', { name: /customize/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Press Escape.
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
