// happy-dom (the global vitest env) provides `document.cookie`, sufficient
// for the consent-cookie reads exercised here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { track, trackServer, identify, clearBuffer, noopDriver } from '@/lib/analytics';
import type { ConsentState } from '@/lib/consent/cookie';

const COOKIE_NAME = 'mopc-consent';

function setConsentCookie(state: ConsentState | null): void {
  if (state === null) {
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    return;
  }
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
}

beforeEach(() => {
  clearBuffer();
  setConsentCookie(null);
});

afterEach(() => {
  setConsentCookie(null);
});

describe('track / client-side / consent gate', () => {
  it('drops the event when no consent cookie is set', () => {
    track({ name: 'landing_page_viewed', props: {} });
    expect(noopDriver.getEvents()).toHaveLength(0);
  });

  it('drops the event when analytics consent is false', () => {
    setConsentCookie({ essential: true, analytics: false, errors: false, version: 1 });
    track({ name: 'landing_page_viewed', props: {} });
    expect(noopDriver.getEvents()).toHaveLength(0);
  });

  it('forwards the event when analytics consent is true', () => {
    setConsentCookie({ essential: true, analytics: true, errors: false, version: 1 });
    track({ name: 'landing_page_viewed', props: {} });
    const captured = noopDriver.getEvents();
    expect(captured).toHaveLength(1);
    const first = captured[0];
    if (!first) throw new Error('expected one event');
    expect(first.event.name).toBe('landing_page_viewed');
  });

  it('preserves typed payloads on forwarded events', () => {
    setConsentCookie({ essential: true, analytics: true, errors: false, version: 1 });
    track({
      name: 'time_topup_completed',
      props: { tier: '200', gross_cents: 20_000, bonus_cents: 10_000 },
    });
    const captured = noopDriver.getEvents();
    expect(captured).toHaveLength(1);
    const first = captured[0];
    if (!first) throw new Error('expected one event');
    expect(first.event).toEqual({
      name: 'time_topup_completed',
      props: { tier: '200', gross_cents: 20_000, bonus_cents: 10_000 },
    });
  });
});

describe('identify / client-side / consent gate', () => {
  it('drops identify when consent is not granted', () => {
    identify('profile-1', { email: 'x@example.com' });
    expect(noopDriver.getIdentifies()).toHaveLength(0);
  });

  it('forwards identify when analytics consent is true', () => {
    setConsentCookie({ essential: true, analytics: true, errors: false, version: 1 });
    identify('profile-1', { tier: 'autopay' });
    const calls = noopDriver.getIdentifies();
    expect(calls).toHaveLength(1);
    const first = calls[0];
    if (!first) throw new Error('expected one identify call');
    expect(first.profileId).toBe('profile-1');
    expect(first.traits).toEqual({ tier: 'autopay' });
  });
});

describe('trackServer / not subject to consent gate', () => {
  it('forwards regardless of consent cookie state', () => {
    // No consent cookie set.
    trackServer({ name: 'cashier_redeem_completed', props: { minutes: 90 } });
    expect(noopDriver.getEvents()).toHaveLength(1);
  });

  it('forwards when consent is explicitly denied', () => {
    setConsentCookie({ essential: true, analytics: false, errors: false, version: 1 });
    trackServer({ name: 'cashier_redeem_completed', props: { minutes: 60 } });
    expect(noopDriver.getEvents()).toHaveLength(1);
  });
});
