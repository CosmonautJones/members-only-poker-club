/**
 * Unit tests for `lib/auth/safeNext.ts` (ADR-0002 cycle 3, t4).
 *
 * Run locally:    pnpm test tests/auth/safeNext.test.ts
 * Prerequisites:  none — pure function, no DB, no network, no mocks.
 *
 * Spec t4: "Open-redirect validation is a shared helper at
 * `lib/auth/safeNext.ts` (worth lifting to its own file — login isn't the
 * only future caller)." The 10 sub-cases in `tests/auth/login-action.test.ts`
 * exercise the validator end-to-end through the login action; this file
 * pins the helper's contract directly so future callers (signup `?next=`,
 * magic-link callback, OAuth callback) can rely on it without round-
 * tripping the login action.
 *
 * SUT contract:
 *   - empty / undefined / null              → '/dashboard'
 *   - non-string (TS forbids; runtime guard) → '/dashboard'
 *   - does not start with '/'               → '/dashboard'
 *   - starts with '//'  (protocol-rel)      → '/dashboard'
 *   - starts with '/\\' (backslash trick)   → '/dashboard'
 *   - contains '://'   (absolute URL trap)  → '/dashboard'
 *   - safe same-origin path                 → returned verbatim, with
 *     query string + hash fragment preserved.
 *
 * Static-source assertion: the file's first line MUST be
 * `import 'server-only';`. That directive is load-bearing per the security
 * model — pulling the validator into a client bundle would tempt a future
 * contributor to call it client-side, where the user agent can already
 * navigate anywhere.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Neutralize the `import 'server-only';` directive so the SUT loads under
// vitest. Mirrors the pattern in tests/auth/getCurrentProfile.test.ts.
vi.mock('server-only', () => ({}));

// Import AFTER vi.mock so the SUT picks up the mocked module.
// eslint-disable-next-line import/first
import { safeNext } from '@/lib/auth/safeNext';

const SAFE_NEXT_FILE = resolve(__dirname, '../../lib/auth/safeNext.ts');

describe('safeNext — empty / nullish inputs', () => {
  it('returns /dashboard for null', () => {
    expect(safeNext(null)).toBe('/dashboard');
  });

  it('returns /dashboard for undefined', () => {
    expect(safeNext(undefined)).toBe('/dashboard');
  });

  it('returns /dashboard for empty string', () => {
    expect(safeNext('')).toBe('/dashboard');
  });
});

describe('safeNext — happy-path safe targets', () => {
  it('returns /dashboard verbatim', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard');
  });

  it('returns /profile verbatim', () => {
    expect(safeNext('/profile')).toBe('/profile');
  });

  it('preserves query string and hash on a safe path', () => {
    // `/safe?x=1#h` MUST round-trip — the encoding/decoding is the
    // caller's problem (e.g. encodeURIComponent for `?next=` insertion).
    // The validator only gates the protocol/origin shape.
    expect(safeNext('/safe?x=1#h')).toBe('/safe?x=1#h');
  });

  it('preserves deep paths', () => {
    expect(safeNext('/admin/users')).toBe('/admin/users');
  });
});

describe('safeNext — open-redirect defenses', () => {
  it('rejects protocol-relative `//evil.com`', () => {
    // Protocol-relative URLs inherit the page's protocol but redirect
    // off-origin. Browsers happily follow them.
    expect(safeNext('//evil.com')).toBe('/dashboard');
  });

  it('rejects backslash-escape `/\\evil.com`', () => {
    // Chrome historically normalized `/\evil.com` to `//evil.com` in the
    // Location header, enabling open redirects past naive `startsWith('//')`
    // guards. We reject this shape explicitly.
    expect(safeNext('/\\evil.com')).toBe('/dashboard');
  });

  it('rejects absolute URL `https://evil.com`', () => {
    expect(safeNext('https://evil.com')).toBe('/dashboard');
  });

  it('rejects `http://evil.com`', () => {
    expect(safeNext('http://evil.com')).toBe('/dashboard');
  });

  it('rejects an embedded `://` `/foo://bar`', () => {
    // Even with a leading slash, an embedded `://` is suspicious — some
    // routers normalize it back into a scheme. We reject the whole class.
    expect(safeNext('/foo://bar')).toBe('/dashboard');
  });

  it('rejects javascript: pseudo-URL (XSS vector)', () => {
    // Does not start with '/', so the leading-slash gate catches it.
    expect(safeNext('javascript:alert(1)')).toBe('/dashboard');
  });

  it('rejects bare path without leading slash `dashboard`', () => {
    expect(safeNext('dashboard')).toBe('/dashboard');
  });

  it('rejects `data:` URL', () => {
    expect(safeNext('data:text/html,evil')).toBe('/dashboard');
  });
});

describe('safeNext — non-string runtime input (defense in depth)', () => {
  it('returns /dashboard for a number passed at runtime', () => {
    // TS forbids this at compile time, but server-action FormData entries
    // can be `File | string`, and a misconfigured client could submit
    // anything. The runtime guard is the last line of defense.
    expect(safeNext(123 as unknown as string)).toBe('/dashboard');
  });

  it('returns /dashboard for an object passed at runtime', () => {
    expect(safeNext({} as unknown as string)).toBe('/dashboard');
  });
});

describe('safeNext — source invariants', () => {
  it("first line is import 'server-only';", () => {
    // Same anti-leak invariant as lib/supabase/admin.ts and
    // lib/auth/errors.ts. The directive is load-bearing — if the module
    // is ever pulled into a client bundle, Next's compiler trips at
    // build time rather than silently shipping the validator's source
    // (and the implicit "what counts as safe") to the browser.
    const source = readFileSync(SAFE_NEXT_FILE, 'utf8');
    const stripped = source.replace(/^﻿/, '');
    const lines = stripped.split('\n');
    expect(lines[0]!.trim()).toBe("import 'server-only';");
  });

  it('exports a `safeNext` function', () => {
    const source = readFileSync(SAFE_NEXT_FILE, 'utf8');
    expect(source).toMatch(/export\s+function\s+safeNext/);
  });
});
