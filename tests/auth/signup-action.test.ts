/**
 * Unit tests for the signup server action at
 * `app/(auth)/signup/actions.ts` (ADR-0002 cycle 3, task t3).
 *
 * Run locally:    pnpm test tests/auth/signup-action.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC2 + AC9 sub-cases
 *       1-8. Premortem: .conductor/0002/dispatches/0008-premortem-t3.md.
 *
 * SUT contract (per t3 dispatch + premortem):
 *   - Validate in order, return typed FormError WITHOUT calling Supabase on
 *     first failure: DOB parse + 21+ gate; password ≥12 chars; email
 *     lowercase normalization.
 *   - Call `supabase.auth.signUp({ email: lowercased, password })` via the
 *     server client. On `user_already_exists`, return
 *     `{ field: 'email', message: 'An account with this email already
 *     exists.' }` — STATIC message, no email value interpolated.
 *   - On signUp success: INSERT into `profiles` via `createAdminClient()`
 *     with `{ id, full_name, dob, email: lowercased, role: 'member' }`.
 *   - On profiles INSERT failure: FAIL-LOUD contract — log structured
 *     payload (with `tag: 'signup.profile_insert_failed'` and
 *     `auth_user_id`) and return generic FormError. NO retry, NO redirect,
 *     NO second signUp call, NO detection SELECT. (R4 of premortem.)
 *   - On full success: redirect to
 *     `/confirm-email-pending?email=<URL-encoded lowercased email>`.
 *     `next` is NEVER honored at signup. (R9 of premortem.)
 *
 * Mocking strategy mirrors the t1/t2 vi.hoisted pattern (see
 * tests/auth/requireRole.test.ts for the canonical write-up). The mocked
 * `redirect` throws an error with a `digest` matching the NEXT_REDIRECT
 * sentinel so test assertions can recognize the redirect path.
 *
 * Behavioral tests (AC9 sub-cases 1-8) live in `describe('signupAction',
 * ...)`. Static-source-text invariants (premortem-derived guards on the
 * action and page source) live in two separate describes that read the
 * source files via `readFileSync`.
 *
 * NOTE on parallel work: if this file is run before the t3 worker has
 * shipped `app/(auth)/signup/actions.ts`, the `await import(...)` calls
 * will fail. That is expected during conductor parallel build; the test
 * file is the contract the worker codes against.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Hoisted mocks — declared at vi.mock-hoist phase so the factories below
// can reference them safely. Test bodies access these via `mocks.<name>`
// after imports have run. See requireRole.test.ts for the rationale.
const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  insert: vi.fn(),
  redirect: vi.fn((path: string) => {
    const err = new Error(`NEXT_REDIRECT: ${path}`);
    err.name = 'RedirectError';
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${path}`;
    throw err;
  }),
}));

// Neutralize `server-only` so the real admin/server modules under @/lib/...
// can transitively import it without blowing up the test environment.
vi.mock('server-only', () => ({}));

// NOTE on createClient shape: `lib/supabase/server.ts` exports a SYNCHRONOUS
// `createClient()`. The dispatch template sketched `async () => ({...})`,
// but mirroring the real export keeps the SUT call site (`const supabase =
// createClient(); await supabase.auth.signUp(...)`) wired correctly. Tests
// that mock async would fail because `supabase` would be a Promise and
// `supabase.auth` would be undefined.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { signUp: mocks.signUp },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: mocks.insert }),
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

// Resolve the SUT source paths once for the static-source describes.
const ACTION_FILE = resolve(__dirname, '../../app/(auth)/signup/actions.ts');
const PAGE_FILE = resolve(__dirname, '../../app/(auth)/signup/page.tsx');

// Helper: build a populated FormData with sensible defaults; tests
// override individual fields by passing `overrides`.
const makeFormData = (overrides: Record<string, string> = {}): FormData => {
  const fd = new FormData();
  const merged: Record<string, string> = {
    email: 'a@x.com',
    password: 'aaaaaaaaaaaa', // 12 chars — meets the NIST floor.
    dob: '2000-01-01', // 26 yrs old at the pinned 2026-05-09 epoch.
    full_name: 'Test User',
    ...overrides,
  };
  for (const k of Object.keys(merged)) {
    fd.set(k, merged[k] as string);
  }
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('signupAction', () => {
  it('happy path: 21+, valid email, password ≥12 → calls signUp + INSERT, redirects', async () => {
    expect.assertions(6);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    mocks.signUp.mockResolvedValueOnce({
      data: {
        user: {
          id: 'uuid-a',
          email: 'a@x.com',
          email_confirmed_at: null,
        },
      },
      error: null,
    });
    mocks.insert.mockResolvedValueOnce({ error: null });

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    // Action redirects on success — the redirect mock throws a
    // RedirectError sentinel that the action MUST NOT swallow.
    await expect(signupAction(makeFormData())).rejects.toMatchObject({
      name: 'RedirectError',
    });

    expect(mocks.signUp).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    // No detection SELECT (premortem R4): the SUT must NOT call
    // `from('profiles').select(...)`. Our admin mock only exposes
    // `insert`; if the SUT tried `.select`, the test would throw at
    // method-resolution time. Documenting that contract here.
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const target = mocks.redirect.mock.calls[0]![0] as string;
    // %40 is the URL-encoded `@`. Premortem R9 mitigation 1: the
    // redirect URL must encode the email value.
    expect(target).toBe('/confirm-email-pending?email=a%40x.com');
    // Premortem R8 mitigation 3: cycle-3 contract is no audit_log
    // INSERT. Our admin client mock has no `audit_log` table at all —
    // any attempt to write would throw at lookup time. Belt-and-
    // suspenders: confirm `insert` was called for profiles only (1x).
    expect(mocks.insert).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('DOB <21: rejects without calling Supabase', async () => {
    expect.assertions(4);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    // 16 yrs old at the pinned epoch.
    const result = await signupAction(makeFormData({ dob: '2010-05-09' }));

    expect(result).toMatchObject({ field: 'dob' });
    expect((result as { message?: string })?.message).toBeTruthy();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('invalid DOB string: returns dob FormError without Supabase call', async () => {
    expect.assertions(3);

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    const result = await signupAction(makeFormData({ dob: 'not-a-date' }));

    expect(result).toMatchObject({ field: 'dob' });
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('password too short: returns password FormError without Supabase call', async () => {
    expect.assertions(3);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    // 5-char password fails the NIST 12-char floor.
    const result = await signupAction(makeFormData({ password: 'short' }));

    expect(result).toMatchObject({ field: 'password' });
    // Premortem R2 mitigation 1: password length is checked BEFORE
    // any Supabase call.
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('password exactly 12 chars: passes the length gate and proceeds to signUp', async () => {
    expect.assertions(2);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    mocks.signUp.mockResolvedValueOnce({
      data: {
        user: {
          id: 'uuid-c',
          email: 'a@x.com',
          email_confirmed_at: null,
        },
      },
      error: null,
    });
    mocks.insert.mockResolvedValueOnce({ error: null });

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    // 12 chars exactly — boundary, MUST pass the length gate.
    await expect(signupAction(makeFormData({ password: 'aaaaaaaaaaaa' }))).rejects.toMatchObject({
      name: 'RedirectError',
    });
    expect(mocks.signUp).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('email already exists: returns email FormError with STATIC message (no PII leak)', async () => {
    expect.assertions(5);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    mocks.signUp.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'User already registered',
        code: 'user_already_exists',
      },
    });

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    const inputEmail = 'duplicate-user@example.com';
    const result = await signupAction(makeFormData({ email: inputEmail }));

    expect(result).toMatchObject({ field: 'email' });
    const message = (result as { message: string }).message;
    expect(message).toBe('An account with this email already exists.');
    // Premortem R3 mitigation 2: the message MUST NOT contain the
    // input email value — that turns the existence disclosure into a
    // confirmation oracle.
    expect(message).not.toContain(inputEmail);
    expect(message).not.toContain('duplicate-user');
    // Profiles INSERT was NOT attempted on the duplicate-email path.
    expect(mocks.insert).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('orphan window: profiles INSERT fails after signUp success → fail-loud, no retry', async () => {
    expect.assertions(8);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    mocks.signUp.mockResolvedValueOnce({
      data: {
        user: {
          id: 'uuid-b',
          email: 'b@x.com',
          email_confirmed_at: null,
        },
      },
      error: null,
    });
    mocks.insert.mockResolvedValueOnce({
      error: { message: 'connection lost', code: 'PGRST301' },
    });

    // Premortem R4 mitigation 5: the action logs structured fields so
    // support can triage. Spy on console.error and capture the payload.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    const result = await signupAction(makeFormData({ email: 'b@x.com' }));

    expect(result).toMatchObject({
      field: 'form',
      message: 'Account created, but we hit a snag finishing setup. Please contact support.',
    });
    // Premortem R4 mitigation 1+2: ZERO retry. Exactly one signUp,
    // exactly one INSERT, NO redirect, NO second signUp.
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();

    // Structured log payload assertion. We accept any call that
    // includes an object whose `tag` field is the expected string AND
    // `auth_user_id` is the orphan id. Workers may pass the payload as
    // the first arg, second arg, etc.; flatten the recorded calls and
    // search for a matching object.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const allArgs = consoleErrorSpy.mock.calls.flat();
    const payload = allArgs.find(
      (a): a is Record<string, unknown> =>
        typeof a === 'object' &&
        a !== null &&
        (a as Record<string, unknown>)['tag'] === 'signup.profile_insert_failed',
    );
    expect(payload).toBeDefined();
    expect(payload!['auth_user_id']).toBe('uuid-b');
    // Premortem R3 mitigation 4: do NOT log the input email.
    // (Loose check — the payload itself MAY contain a hashed/coded
    // representation; we only assert the literal email value isn't in
    // the JSON-serialised payload.)
    expect(JSON.stringify(payload)).not.toContain('b@x.com');

    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('no `next` redirect honor: passing `next` field does NOT change the redirect target', async () => {
    expect.assertions(3);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09'));

    mocks.signUp.mockResolvedValueOnce({
      data: {
        user: {
          id: 'uuid-d',
          email: 'a@x.com',
          email_confirmed_at: null,
        },
      },
      error: null,
    });
    mocks.insert.mockResolvedValueOnce({ error: null });

    const { signupAction } = await import('@/app/(auth)/signup/actions');

    // Premortem R9 mitigation 2: signup MUST NOT honor a `next`
    // field. Passing `next='/profile'` in FormData should be silently
    // ignored — redirect target is always /confirm-email-pending.
    await expect(signupAction(makeFormData({ next: '/profile' }))).rejects.toMatchObject({
      name: 'RedirectError',
    });

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).not.toContain('/profile');

    vi.useRealTimers();
  });
});

describe('signup action source-text invariants', () => {
  // Premortem R5 mitigation 3: first non-comment, non-blank line of
  // `actions.ts` is the `'use server';` directive. Auto-formatters /
  // organize-imports passes that move the directive lower would push
  // the entire module into the client-bundle eligibility set.
  it("first non-comment line of actions.ts is 'use server';", () => {
    const source = readFileSync(ACTION_FILE, 'utf8').replace(/^﻿/, '');
    const lines = source.split('\n');
    let firstCodeLine: string | undefined;
    let inBlockComment = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (inBlockComment) {
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line.startsWith('/*')) {
        if (!line.includes('*/')) inBlockComment = true;
        continue;
      }
      if (line.startsWith('//')) continue;
      firstCodeLine = line;
      break;
    }
    expect(firstCodeLine).toBe("'use server';");
  });

  it('does NOT contain `new Date(` (locale-ambiguous parsing forbidden)', () => {
    // Premortem R1 mitigation 5: `new Date(<userInput>)` is locale-
    // dependent and produces silent off-by-one bugs on the 21+ gate.
    // The action MUST use `parseISO` from date-fns instead.
    const source = readFileSync(ACTION_FILE, 'utf8');
    expect(source.includes('new Date(')).toBe(false);
  });

  it('does NOT reference `withAudit` or `@/lib/audit` outside comments (cycle-3 deferral)', () => {
    // Premortem R8 mitigation 2: cycle-3 must NOT partially wire
    // withAudit. Cycle 4 owns the integration end-to-end.
    //
    // The TODO(cycle-4) comment intentionally contains the literal
    // word `withAudit` so cycle-4's worker greps for it. We only fail
    // when `withAudit` or the audit module path appears OUTSIDE
    // comments — i.e., as an import, identifier, or function call.
    const source = readFileSync(ACTION_FILE, 'utf8');
    // Strip block comments and line comments. Preserves source line
    // count is not required — we just want to see what code is left.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
    expect(stripped).not.toContain('withAudit');
    expect(stripped).not.toContain('@/lib/audit');
  });

  it('contains the literal `TODO(cycle-4)` token at the INSERT site', () => {
    // Premortem R8 mitigation 1: cycle-4's worker greps for this
    // exact token to find wiring sites for withAudit + reaper.
    const source = readFileSync(ACTION_FILE, 'utf8');
    expect(source).toContain('TODO(cycle-4)');
  });

  it('the duplicate-email message is a literal static string (no `${...}` interpolation)', () => {
    // Premortem R3 mitigation 2: the message must be a literal —
    // template-literal interpolation would risk leaking the email
    // value into the response body, converting an existence disclosure
    // into a confirmation oracle.
    const source = readFileSync(ACTION_FILE, 'utf8');
    expect(source).toContain('An account with this email already exists.');
    // Loose multi-line check: there is no occurrence of the exact
    // template-literal pattern `${...} already exists` near the email
    // path. A worker that interpolates the email into the message would
    // write something like `\`${email} already exists.\``; this regex
    // catches that.
    expect(source).not.toMatch(/\$\{[^}]*\}\s*already exists/);
  });

  it('no `redirect(` call lives inside a `try {` block', () => {
    // Premortem R10: Next.js 14's `redirect()` throws a sentinel
    // (NEXT_REDIRECT). A surrounding try/catch that swallows it would
    // turn every successful signup into a fake "we hit a snag" error.
    // Multi-line regex: any `try {` followed by any content (incl.
    // newlines) followed by `redirect(` BEFORE a balancing close-brace
    // is the bug pattern. We use a lazy match that DOESN'T cross a
    // `}` to avoid false-positives across separate try blocks. The
    // simpler check below also catches any ill-formed nesting; a worker
    // who structures the code per the spec will pass.
    const source = readFileSync(ACTION_FILE, 'utf8');
    // Lazy inner pattern: match `try {`, then anything that ISN'T
    // a closing `}` followed by an optional re-open, until a `redirect(`.
    // Practically this catches the dangerous pattern without crossing
    // try-block boundaries. (We accept some false-positive risk on
    // nested-brace edge cases; if the worker writes idiomatic code the
    // test passes.)
    expect(source).not.toMatch(/try\s*\{[^}]*\bredirect\(/);
  });
});

describe('signup page source-text invariants', () => {
  it("page does NOT contain `'use client'` (server component invariant)", () => {
    // Premortem R5 mitigation 1: the page is a server component. A
    // stray 'use client' boundary would pull actions.ts (and its
    // `createAdminClient` import + service-role construction site)
    // into the client bundle.
    const source = readFileSync(PAGE_FILE, 'utf8');
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain('"use client"');
  });

  it('page does NOT honor a `next` query param or hidden form field', () => {
    // Premortem R9 mitigation 3: signup is NOT a redirect-target
    // boundary. The page must not read `?next=...` for any purpose
    // and must not surface a hidden `next` field in the form. Loose
    // grep — these are the two specific shapes the premortem calls
    // out, and either would be a regression.
    const source = readFileSync(PAGE_FILE, 'utf8');
    expect(source).not.toContain('searchParams.next');
    expect(source).not.toContain("formData.append('next'");
    expect(source).not.toContain('formData.append("next"');
  });
});
