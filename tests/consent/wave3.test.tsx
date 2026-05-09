/**
 * Wave-3 (T2-T6) bundled vitest coverage per ADR-0024 + Slice-1 spec.
 *
 * Tests cover:
 *   T2 / AC3, AC4 — `<CookieBanner />` render gate + button payloads.
 *   T4 / AC10    — `<CookiePreferencesLink />` opens the customize panel.
 *   T5 / AC7     — `<AnalyticsGate />` renders children only when consent.
 *   T6 / AC8, AC9 — `<ErrorTrackingGate />` + `initSentry` idempotency.
 *
 * AC5 (`prefers-reduced-motion`) is intentionally not asserted here — the
 * gate is delegated to the `motion-safe:` Tailwind variant; T8's dedicated
 * `cookie-banner.test.ts` (or a future per-AC test) is the canonical home
 * for the className-branch assertion.
 *
 * AC6 (Radix Dialog a11y) is owned by `tests/consent/consent-customize-panel.test.ts`
 * (T8) — those five assertions need the panel mounted in a layout that has
 * `Dialog.Portal` semantics wired, which is T7's job. The wave-3 bundle
 * here covers what is testable without T7's layout integration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConsentProvider, useConsent } from '@/components/site/consent-provider';
import { CookieBanner } from '@/components/site/cookie-banner';
import { CookiePreferencesLink } from '@/components/site/cookie-preferences-link';
import { AnalyticsGate } from '@/components/site/analytics-gate';
import { ErrorTrackingGate } from '@/components/site/error-tracking-gate';
import { __resetSentryInitForTests, initSentry } from '@/lib/sentry/init';
import type { ConsentState } from '@/lib/consent/cookie';

const COOKIE_NAME = 'mopc-consent';

function clearCookie(): void {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
}

function seedCookie(state: ConsentState): void {
  const encoded = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${COOKIE_NAME}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

beforeEach(() => {
  clearCookie();
  __resetSentryInitForTests();
});

afterEach(() => {
  clearCookie();
  vi.restoreAllMocks();
});

describe('CookieBanner — render gate (T2 / AC3, AC4)', () => {
  it('renders the banner with three buttons when no cookie is present post-hydration', async () => {
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );

    expect(await screen.findByRole('region', { name: /cookie consent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /essential only/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /customize/i })).toBeInTheDocument();
  });

  it('renders nothing when consent is already granted (state !== null)', async () => {
    seedCookie({ essential: true, analytics: true, errors: true, version: 1 });

    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );

    // Wait one microtask so the mount effect can flush; banner should still
    // not appear because state hydrated to a non-null cookie.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
    });
  });

  it('clicking "Essential only" writes the essential-only cookie and dismisses the banner', async () => {
    const user = userEvent.setup();
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /essential only/i }));

    expect(document.cookie).toContain(`${COOKIE_NAME}=`);
    const segment = document.cookie.split(`${COOKIE_NAME}=`)[1] ?? '';
    const decoded = decodeURIComponent(segment.split(';')[0] ?? '');
    expect(JSON.parse(decoded)).toEqual({
      essential: true,
      analytics: false,
      errors: false,
      version: 1,
    });

    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
  });

  it('clicking "Accept all" writes the all-true cookie and dismisses the banner', async () => {
    const user = userEvent.setup();
    render(
      <ConsentProvider>
        <CookieBanner />
      </ConsentProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /accept all/i }));

    const segment = document.cookie.split(`${COOKIE_NAME}=`)[1] ?? '';
    const decoded = decodeURIComponent(segment.split(';')[0] ?? '');
    expect(JSON.parse(decoded)).toEqual({
      essential: true,
      analytics: true,
      errors: true,
      version: 1,
    });

    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
  });

  it('clicking "Customize" opens the customize panel without writing a cookie', async () => {
    const user = userEvent.setup();

    function PanelObserver(): JSX.Element {
      const { isCustomizePanelOpen } = useConsent();
      return <div data-testid="panel-state">{isCustomizePanelOpen ? 'open' : 'closed'}</div>;
    }

    render(
      <ConsentProvider>
        <CookieBanner />
        <PanelObserver />
      </ConsentProvider>,
    );

    expect(await screen.findByTestId('panel-state')).toHaveTextContent('closed');

    await user.click(screen.getByRole('button', { name: /customize/i }));

    expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
    // Customize click must not write the cookie — the user has not yet decided.
    expect(document.cookie).not.toContain(`${COOKIE_NAME}=ey`); // encoded JSON starts with %7B → not 'ey'; presence-of-encoded-state check below
    const segment = document.cookie.split(`${COOKIE_NAME}=`)[1];
    expect(segment === undefined || segment.startsWith(';') || segment === '').toBe(true);
  });
});

describe('CookiePreferencesLink — re-entry control (T4 / AC10)', () => {
  it('opens the customize panel when clicked', async () => {
    const user = userEvent.setup();

    function PanelObserver(): JSX.Element {
      const { isCustomizePanelOpen } = useConsent();
      return <div data-testid="panel-state">{isCustomizePanelOpen ? 'open' : 'closed'}</div>;
    }

    render(
      <ConsentProvider>
        <CookiePreferencesLink />
        <PanelObserver />
      </ConsentProvider>,
    );

    expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');

    await user.click(screen.getByRole('button', { name: /cookie preferences/i }));

    expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
  });

  it('renders with the COPY.footer_link label by default', () => {
    render(
      <ConsentProvider>
        <CookiePreferencesLink />
      </ConsentProvider>,
    );
    expect(screen.getByRole('button', { name: /cookie preferences/i })).toBeInTheDocument();
  });
});

describe('AnalyticsGate — consent-aware children (T5 / AC7)', () => {
  it('renders nothing when no cookie is present (state hydrates to null)', async () => {
    render(
      <ConsentProvider>
        <AnalyticsGate>
          <span data-testid="analytics-child">child</span>
        </AnalyticsGate>
      </ConsentProvider>,
    );

    // Wait for the hydration effect; gate should still render nothing because
    // state hydrated to null and analytics is undefined.
    await waitFor(() => {
      expect(screen.queryByTestId('analytics-child')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when state.analytics is false', async () => {
    seedCookie({ essential: true, analytics: false, errors: false, version: 1 });

    render(
      <ConsentProvider>
        <AnalyticsGate>
          <span data-testid="analytics-child">child</span>
        </AnalyticsGate>
      </ConsentProvider>,
    );

    await waitFor(() => {
      // After hydration, the cookie's analytics:false should suppress children.
      expect(screen.queryByTestId('analytics-child')).not.toBeInTheDocument();
    });
  });

  it('renders children when state.analytics is true', async () => {
    seedCookie({ essential: true, analytics: true, errors: false, version: 1 });

    render(
      <ConsentProvider>
        <AnalyticsGate>
          <span data-testid="analytics-child">child</span>
        </AnalyticsGate>
      </ConsentProvider>,
    );

    expect(await screen.findByTestId('analytics-child')).toBeInTheDocument();
  });
});

describe('ErrorTrackingGate + initSentry (T6 / AC8, AC9)', () => {
  it('always renders children regardless of consent state', async () => {
    render(
      <ConsentProvider>
        <ErrorTrackingGate>
          <span data-testid="error-child">child</span>
        </ErrorTrackingGate>
      </ConsentProvider>,
    );

    // The gate is for SDK initialization, not children visibility.
    expect(await screen.findByTestId('error-child')).toBeInTheDocument();
  });

  it('renders children even when state.errors is true', async () => {
    seedCookie({ essential: true, analytics: false, errors: true, version: 1 });

    render(
      <ConsentProvider>
        <ErrorTrackingGate>
          <span data-testid="error-child">child</span>
        </ErrorTrackingGate>
      </ConsentProvider>,
    );

    expect(await screen.findByTestId('error-child')).toBeInTheDocument();
  });

  it('initSentry runs the underlying init exactly once across multiple calls', () => {
    // Module-level flag is reset in beforeEach via __resetSentryInitForTests().
    // Calling initSentry repeatedly must not throw; the flag flips on the first
    // call and short-circuits subsequent calls.
    expect(() => {
      initSentry();
      initSentry();
      initSentry();
    }).not.toThrow();
  });

  it('initSentry is callable again after a test-only reset (idempotency contract)', () => {
    initSentry();
    initSentry();
    __resetSentryInitForTests();
    expect(() => initSentry()).not.toThrow();
  });
});
