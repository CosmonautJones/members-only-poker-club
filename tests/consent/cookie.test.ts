// Header note: cookie attribute-string assertions below depend on happy-dom
// honoring `vi.spyOn(document, 'cookie', 'set')` for the property setter. If
// a future happy-dom upgrade breaks the setter spy, the assertions inside
// `writeConsent cookie attributes` / `clearConsent cookie attributes` will
// surface the limitation and the fallback is to instrument via
// `Object.defineProperty(document, 'cookie', { set: spy, ... })` directly.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readConsent, writeConsent, clearConsent, type ConsentState } from '@/lib/consent/cookie';

const validState: ConsentState = {
  essential: true,
  analytics: true,
  errors: false,
  version: 1,
};

describe('readConsent', () => {
  beforeEach(() => {
    document.cookie = 'mopc-consent=; Max-Age=0; Path=/';
  });

  it('returns null when cookie absent', () => {
    expect(readConsent()).toBeNull();
  });

  it('returns parsed state when cookie present and valid', () => {
    writeConsent(validState);
    expect(readConsent()).toEqual(validState);
  });

  it('returns null when cookie value is malformed JSON', () => {
    document.cookie = `mopc-consent=${encodeURIComponent('{not json')}; Path=/`;
    expect(readConsent()).toBeNull();
  });

  it('returns null when version field does not match', () => {
    const wrongVersion = { ...validState, version: 0 } as unknown as ConsentState;
    document.cookie = `mopc-consent=${encodeURIComponent(JSON.stringify(wrongVersion))}; Path=/`;
    expect(readConsent()).toBeNull();
  });

  it('returns null when essential is not true', () => {
    const broken = { ...validState, essential: false } as unknown as ConsentState;
    document.cookie = `mopc-consent=${encodeURIComponent(JSON.stringify(broken))}; Path=/`;
    expect(readConsent()).toBeNull();
  });
});

describe('writeConsent', () => {
  beforeEach(() => {
    document.cookie = 'mopc-consent=; Max-Age=0; Path=/';
  });

  it('round-trips a valid state', () => {
    writeConsent(validState);
    expect(readConsent()).toEqual(validState);
  });

  it('throws if essential is not true', () => {
    expect(() =>
      writeConsent({ ...validState, essential: false } as unknown as ConsentState),
    ).toThrow();
  });
});

describe('clearConsent', () => {
  it('removes the cookie so readConsent returns null afterward', () => {
    writeConsent(validState);
    expect(readConsent()).toEqual(validState);
    clearConsent();
    expect(readConsent()).toBeNull();
  });
});

describe('writeConsent cookie attributes', () => {
  beforeEach(() => {
    document.cookie = 'mopc-consent=; Max-Age=0; Path=/';
  });

  it('writes cookie with Path=/, Max-Age=31536000, SameSite=Lax (non-prod)', () => {
    const setSpy = vi.spyOn(document, 'cookie', 'set');
    writeConsent({ essential: true, analytics: true, errors: false, version: 1 });
    const writes = setSpy.mock.calls.map((c) => c[0] as string);
    expect(writes.some((w) => w.includes('Path=/'))).toBe(true);
    expect(writes.some((w) => w.includes('Max-Age=31536000'))).toBe(true);
    expect(writes.some((w) => w.includes('SameSite=Lax'))).toBe(true);
    setSpy.mockRestore();
  });
});

describe('clearConsent cookie attributes', () => {
  it('writes cookie with Max-Age=0 + Path=/ + SameSite=Lax', () => {
    const setSpy = vi.spyOn(document, 'cookie', 'set');
    clearConsent();
    const writes = setSpy.mock.calls.map((c) => c[0] as string);
    expect(writes.some((w) => w.includes('Max-Age=0'))).toBe(true);
    expect(writes.some((w) => w.includes('Path=/'))).toBe(true);
    expect(writes.some((w) => w.includes('SameSite=Lax'))).toBe(true);
    setSpy.mockRestore();
  });
});
