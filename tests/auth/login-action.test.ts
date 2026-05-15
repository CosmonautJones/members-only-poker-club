/**
 * Unit tests for `app/(auth)/login/actions.ts:loginAction` (ADR-0002 cycle 3, t4).
 *
 * Run locally:    pnpm test tests/auth/login-action.test.ts
 * Prerequisites:  none — pure module mocks, no DB, no network.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC3 (Login at
 *       app/(auth)/login/page.tsx + colocated actions.ts).
 *
 * SUT contract (per AC3 + plan t4):
 *   - Reads {email, password, next?} from FormData.
 *   - Lowercases + trims email; password is NEVER trimmed (NIST 800-63B).
 *   - Calls supabase.auth.signInWithPassword via lib/supabase/server.ts.
 *   - On error:
 *       * `email_not_confirmed` (or message contains "not confirmed") →
 *         {field:'form', message:'Email not yet confirmed — check your inbox.'}
 *       * Anything else (including invalid_credentials) →
 *         {field:'form', message:'Invalid email or password.'} — generic;
 *         account-enumeration defense, MUST NOT echo the input email.
 *   - On success: redirect to safeNext(next) which falls back to /dashboard
 *     for missing/protocol-relative/absolute-url/non-leading-slash inputs.
 *
 * Mocking strategy mirrors tests/auth/middleware.test.ts: vi.hoisted to
 * dodge the hoisting trap where vi.mock factories run before module-scope
 * `const` declarations. The redirect mock throws a NEXT_REDIRECT-shaped
 * error so the SUT's `redirect()` call surfaces as a thrown error in the
 * test (the real Next 14 redirect throws a sentinel; we reproduce that).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Hoisted mocks: declared at vi.mock-hoist phase so the factory below can
// reference them safely. Test bodies access these via `mocks.<name>`.
const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

// Neutralize `server-only` so any transitive imports (e.g.
// lib/auth/safeNext.ts → `import 'server-only';`) don't blow up the
// jsdom test environment at module-load time. Mirrors the pattern used
// in tests/auth/signup-action.test.ts.
vi.mock('server-only', () => ({}));

// revalidatePath is called between auth.signInWithPassword and redirect()
// to invalidate the (member) layout cache so it reads the freshly-set
// session cookie on the redirected request. Stub it — the real impl
// requires Next's static-generation store which isn't present under vitest.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// NOTE on shape: the real `createClient()` in lib/supabase/server.ts is
// SYNCHRONOUS and returns the supabase client directly. The SUT does
// `const supabase = createClient()` (no await). The mock therefore must
// also be sync; an `async () => ({...})` factory would return a Promise
// that the SUT would treat as a client and crash on `.auth.signIn...`.
// (The dispatch's suggested `async` shape is a contradiction with the
// real source — this test follows the source.)
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword },
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

// Import AFTER vi.mock so the SUT picks up the mocked modules.
import { loginAction } from '@/app/(auth)/login/actions';

// Helper: build a FormData with the given fields (ignores undefined).
const makeForm = (fields: Record<string, string | undefined>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.append(k, v);
  }
  return fd;
};

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
  mocks.redirect.mockClear();
});

describe('loginAction', () => {
  it('1. invalid credentials returns generic form error and does not redirect', async () => {
    expect.assertions(3);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    const result = await loginAction(
      makeForm({ email: 'alice@example.com', password: 'password123XX' }),
    );

    expect(result).toEqual({ field: 'form', message: 'Invalid email or password.' });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('2. email_not_confirmed returns the distinct unconfirmed-email message', async () => {
    expect.assertions(2);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'email_not_confirmed',
        message: 'Email not confirmed',
      },
    });

    const result = await loginAction(
      makeForm({ email: 'alice@example.com', password: 'password123XX' }),
    );

    expect(result).toEqual({
      field: 'form',
      message: 'Email not yet confirmed — check your inbox.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('3. account-enumeration defense — error message is the literal string and does not contain the input email', async () => {
    expect.assertions(3);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    const result = await loginAction(
      makeForm({ email: 'victim@example.com', password: 'password123XX' }),
    );

    // Literal-equality on the message — any drift (e.g., echoing the
    // input email or interpolating Supabase's raw message text) fails
    // this assertion. This is the enumeration-defense pin.
    expect(result?.message).toBe('Invalid email or password.');
    expect(result?.message).not.toContain('victim@example.com');
    expect(result?.message).not.toContain('victim');
  });

  it('4. success with no `next` redirects to /dashboard', async () => {
    expect.assertions(2);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'uuid-1' }, session: { access_token: 'tok' } },
      error: null,
    });

    // The SUT's redirect() throws the NEXT_REDIRECT sentinel; wrap so the
    // test does not treat it as an unhandled rejection.
    await expect(
      loginAction(makeForm({ email: 'alice@example.com', password: 'password123XX' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('5. success with safe `next=/profile` redirects to /profile', async () => {
    expect.assertions(2);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'uuid-1' }, session: { access_token: 'tok' } },
      error: null,
    });

    await expect(
      loginAction(
        makeForm({
          email: 'alice@example.com',
          password: 'password123XX',
          next: '/profile',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/profile');
  });

  it('6. open-redirect defense — `next=//evil.com` falls back to /dashboard', async () => {
    expect.assertions(3);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'uuid-1' }, session: { access_token: 'tok' } },
      error: null,
    });

    await expect(
      loginAction(
        makeForm({
          email: 'alice@example.com',
          password: 'password123XX',
          next: '//evil.com',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
    // Belt-and-suspenders: the SUT MUST NOT have called redirect with the
    // protocol-relative target.
    expect(mocks.redirect).not.toHaveBeenCalledWith('//evil.com');
  });

  it('7. open-redirect defense — `next=/\\evil.com` (backslash escape) falls back to /dashboard', async () => {
    expect.assertions(3);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'uuid-1' }, session: { access_token: 'tok' } },
      error: null,
    });

    await expect(
      loginAction(
        makeForm({
          email: 'alice@example.com',
          password: 'password123XX',
          // Literal backslash followed by domain — Chrome historically
          // normalized `/\\evil.com` to `//evil.com` in the Location
          // header, enabling open redirects past naive `startsWith('//')`
          // guards. The SUT's safeNext MUST also reject this shape.
          next: '/\\evil.com',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
    expect(mocks.redirect).not.toHaveBeenCalledWith('/\\evil.com');
  });

  it('8. open-redirect defense — `next=https://evil.com` (absolute URL) falls back to /dashboard', async () => {
    expect.assertions(3);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'uuid-1' }, session: { access_token: 'tok' } },
      error: null,
    });

    await expect(
      loginAction(
        makeForm({
          email: 'alice@example.com',
          password: 'password123XX',
          next: 'https://evil.com',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
    expect(mocks.redirect).not.toHaveBeenCalledWith('https://evil.com');
  });

  it('9. open-redirect defense — `next=javascript:alert(1)` falls back to /dashboard (XSS-vector coverage)', async () => {
    // This input does not start with `/`, so the leading-slash gate in
    // safeNext rejects it. Including this case as defensive coverage of
    // a common XSS open-redirect payload — if a future contributor
    // weakens the leading-slash check, this test fires.
    expect.assertions(3);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'uuid-1' }, session: { access_token: 'tok' } },
      error: null,
    });

    await expect(
      loginAction(
        makeForm({
          email: 'alice@example.com',
          password: 'password123XX',
          next: 'javascript:alert(1)',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
    expect(mocks.redirect).not.toHaveBeenCalledWith('javascript:alert(1)');
  });

  it('10. email is lowercased before being passed to signInWithPassword', async () => {
    expect.assertions(1);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    await loginAction(makeForm({ email: 'AlICE@Example.COM', password: 'password123XX' }));

    // `email` MUST be the lowercase form. Match using objectContaining so
    // the assertion does not over-pin shape (the SUT may pass additional
    // options to Supabase later without breaking this test).
    expect(mocks.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com' }),
    );
  });

  it('11. password is NOT trimmed — leading/trailing spaces are preserved verbatim', async () => {
    expect.assertions(1);
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    // 16-char password with leading + trailing spaces. NIST 800-63B
    // accepts whitespace; trimming would silently weaken policy and let
    // a typo at the keyboard succeed if the stored password also had
    // whitespace, which is a different bug. The exact byte-string MUST
    // reach Supabase.
    const password = '  password123XX  ';
    await loginAction(makeForm({ email: 'alice@example.com', password }));

    expect(mocks.signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({ password }));
  });
});

// ---------------------------------------------------------------------
// Static-source invariants. These tests read the SUT's source file as
// text and assert structural properties that runtime tests cannot easily
// observe (placement of 'use server', try/catch around redirect, etc.).
//
// Why these matter:
//   - 'use server' MUST be the first non-comment line. If a future
//     contributor adds an `import` above it, Next.js silently treats the
//     file as a regular module and the action becomes a no-op (or worse,
//     leaks server-only code to the client bundle).
//   - redirect() inside a try/catch swallows the NEXT_REDIRECT sentinel
//     and turns every successful login into a false-failure. This is a
//     common subtle bug; pin it structurally.
//   - safeNext must exist as a named function (or inline guard with the
//     `://` substring check) — runtime tests cover the BEHAVIOR; this
//     pin makes the open-redirect defense visible in a code-review diff
//     so a refactor that drops the helper trips an alarm.
// ---------------------------------------------------------------------

describe('loginAction source invariants', () => {
  const sourcePath = path.resolve(__dirname, '..', '..', 'app', '(auth)', 'login', 'actions.ts');
  const source = readFileSync(sourcePath, 'utf8');

  it("12. first non-comment line is `'use server';`", () => {
    expect.assertions(1);
    // Strip leading shebang/blank/comment lines, then assert the next
    // non-empty line is the use-server directive. We support both block
    // (/* ... */) and line (//) comment forms.
    const lines = source.split(/\r?\n/);
    let firstCode: string | null = null;
    let inBlock = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (inBlock) {
        if (line.includes('*/')) inBlock = false;
        continue;
      }
      if (line.startsWith('/*')) {
        if (!line.includes('*/')) inBlock = true;
        continue;
      }
      if (line === '' || line.startsWith('//')) continue;
      firstCode = line;
      break;
    }
    expect(firstCode).toBe("'use server';");
  });

  it('13. no `redirect(` call inside any `try {` block', () => {
    expect.assertions(1);
    // Multiline regex: from `try {` to the matching `}` (non-greedy),
    // then check the captured body for `redirect(`. This is intentionally
    // conservative — a nested object literal inside a try would also
    // match the `}`, but in practice the SUT either has no try at all
    // (current shape) or simple flat try blocks. False positives here
    // surface as a clear "rewrite the redirect to live outside the try"
    // signal during code review.
    const tryBlocks = source.match(/try\s*\{[\s\S]*?\}/g) ?? [];
    const violation = tryBlocks.find((block) => /\bredirect\s*\(/.test(block));
    expect(violation).toBeUndefined();
  });

  it('14. safeNext helper exists (named function or inline `://` guard)', () => {
    expect.assertions(1);
    // Either `safeNext` appears as an identifier (function name, call
    // site, etc.) OR an inline guard with the `://` substring lives in
    // the file. The substring check is the load-bearing piece — without
    // it, `https://evil.com` slips through. The named-function form is
    // preferred for readability; the inline form is acceptable.
    const hasNamedHelper = /\bsafeNext\b/.test(source);
    const hasInlineGuard = source.includes('://');
    expect(hasNamedHelper || hasInlineGuard).toBe(true);
  });
});
