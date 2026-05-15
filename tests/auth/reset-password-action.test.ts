/**
 * Unit tests for `app/(auth)/reset-password/actions.ts:resetPasswordAction`
 * AND structural coverage for the verifyOtp branch in
 * `app/(auth)/reset-password/page.tsx` (ADR-0002 cycle 3, t4).
 *
 * Run locally:    pnpm test tests/auth/reset-password-action.test.ts
 * Prerequisites:  none — pure module mocks, no DB, no network.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC4 step 3 (the
 *       password-update form action) and AC4 step 1 (page-level verifyOtp).
 *
 * SUT contract (per AC4 + plan t4):
 *   - resetPasswordAction(formData):
 *       * Reads `password` and `confirmPassword`.
 *       * If password !== confirmPassword → {field:'confirmPassword', ...}
 *       * If password.length < 12 → {field:'password', ...}
 *       * Otherwise calls supabase.auth.updateUser({password}); on error
 *         returns {field:'form', ...}; on success redirects /dashboard.
 *   - page.tsx (covered by static-source assertions only — see NOTE below):
 *       * If searchParams.token_hash AND searchParams.type === 'recovery',
 *         calls supabase.auth.verifyOtp({token_hash, type}).
 *
 * NOTE on testing the page-level `verifyOtp`: page-component testing in
 * vitest requires either a full RSC render harness (Next 14 does not
 * ship one for unit tests) or a Playwright integration that boots the
 * dev server. Neither is in scope for t4. Instead, we cover the
 * verifyOtp call site via static-source-text assertions: the source
 * imports `createClient`, contains the literal `verifyOtp`, and
 * references `searchParams.token_hash` and the `'recovery'` literal.
 * This is the same pattern tests/auth/lib-supabase-admin.test.ts uses
 * for load-bearing source structure.
 *
 * Mocking strategy mirrors tests/auth/middleware.test.ts (vi.hoisted).
 * The redirect mock throws a NEXT_REDIRECT-shaped error so the SUT's
 * `redirect()` call surfaces as a thrown error in the test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

// revalidatePath is called between auth.updateUser and redirect() to
// invalidate the (member) layout cache so the recovery session cookie is
// read fresh on the redirected /dashboard request. Stub it — the real
// impl requires Next's static-generation store which isn't present here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Sync factory — see comment in login-action.test.ts. The real
// `createClient()` in lib/supabase/server.ts is sync.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { verifyOtp: mocks.verifyOtp, updateUser: mocks.updateUser },
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

// Import AFTER vi.mock. If the worker has not yet shipped the source
// file, this import throws. We catch it so the static-source tests
// below can still report `awaiting worker` cleanly rather than a
// confusing `Cannot find module` error during the action tests.
let resetPasswordAction: ((formData: FormData) => Promise<unknown>) | undefined;
let importError: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = await import('@/app/(auth)/reset-password/actions');
  resetPasswordAction = (mod as { resetPasswordAction?: (fd: FormData) => Promise<unknown> })
    .resetPasswordAction;
} catch (e) {
  importError = e;
}

const makeForm = (fields: Record<string, string | undefined>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.append(k, v);
  }
  return fd;
};

beforeEach(() => {
  mocks.verifyOtp.mockReset();
  mocks.updateUser.mockReset();
  mocks.redirect.mockClear();
});

describe('resetPasswordAction', () => {
  // Skip the runtime-action tests if the worker has not yet shipped the
  // source. The static-source describe-block below still runs and reports
  // a clear `awaiting worker` failure. Once the worker ships
  // app/(auth)/reset-password/actions.ts, all tests in this file activate.
  const it_ = resetPasswordAction ? it : it.skip;

  it_(
    '1. password mismatch returns confirmPassword field error and does not call updateUser',
    async () => {
      expect.assertions(3);
      const result = (await resetPasswordAction!(
        makeForm({
          password: 'aaaaaaaaaaaa',
          confirmPassword: 'bbbbbbbbbbbb',
        }),
      )) as { field: string; message: string } | undefined;

      expect(result?.field).toBe('confirmPassword');
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it_(
    '2. password shorter than 12 chars returns password field error and does not call updateUser',
    async () => {
      expect.assertions(3);
      // 10 chars — below the NIST 800-63B floor pinned by the spec.
      const pass = '11charsxx0';
      const result = (await resetPasswordAction!(
        makeForm({ password: pass, confirmPassword: pass }),
      )) as { field: string; message: string } | undefined;

      expect(result?.field).toBe('password');
      expect(mocks.updateUser).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it_('3. password exactly 12 chars passes the length gate and calls updateUser', async () => {
    expect.assertions(2);
    // Boundary case: 12 chars is the inclusive minimum per the spec
    // ("≥12 chars"). One char shorter must reject; exactly 12 must accept.
    mocks.updateUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const pass = 'aaaaaaaaaaaa'; // exactly 12

    // The redirect throws NEXT_REDIRECT on success; allow the throw.
    await expect(
      resetPasswordAction!(makeForm({ password: pass, confirmPassword: pass })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.updateUser).toHaveBeenCalledWith(expect.objectContaining({ password: pass }));
  });

  it_('4. updateUser success redirects to /dashboard', async () => {
    expect.assertions(2);
    mocks.updateUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    const pass = 'aaaaaaaaaaaa';

    await expect(
      resetPasswordAction!(makeForm({ password: pass, confirmPassword: pass })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it_('5. updateUser failure returns form error and does NOT redirect', async () => {
    expect.assertions(3);
    mocks.updateUser.mockResolvedValueOnce({
      data: null,
      error: { message: 'token expired' },
    });
    const pass = 'aaaaaaaaaaaa';

    const result = (await resetPasswordAction!(
      makeForm({ password: pass, confirmPassword: pass }),
    )) as { field: string; message: string } | undefined;

    expect(result?.field).toBe('form');
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------
// Static-source invariants. These tests cover:
//   - The page-level verifyOtp call site (which we cannot drive at
//     runtime in vitest without an RSC render harness).
//   - The action file's 'use server' placement and try/redirect
//     placement (same rationale as login-action.test.ts).
// ---------------------------------------------------------------------

describe('reset-password source invariants', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const pagePath = path.resolve(repoRoot, 'app', '(auth)', 'reset-password', 'page.tsx');
  const actionsPath = path.resolve(repoRoot, 'app', '(auth)', 'reset-password', 'actions.ts');

  // Read once; if the file is missing, leave source as null and let
  // each `it` produce a clear `awaiting worker` failure rather than a
  // single readFileSync throw that masks all 5 assertions.
  const pageSource = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : null;
  const actionsSource = existsSync(actionsPath) ? readFileSync(actionsPath, 'utf8') : null;

  it('6. page.tsx imports `createClient` from `@/lib/supabase/server`', () => {
    expect.assertions(1);
    if (pageSource === null) {
      throw new Error('awaiting worker — app/(auth)/reset-password/page.tsx not yet shipped');
    }
    // Match either named import or namespace alias forms — the spec
    // pins the symbol name, not the import shape. Forbid the wrong
    // module path (e.g., importing from `@/lib/supabase/client` would
    // be a browser-side client and is wrong for a server component).
    const hasImport =
      /from\s+['"]@\/lib\/supabase\/server['"]/.test(pageSource) &&
      /\bcreateClient\b/.test(pageSource);
    expect(hasImport).toBe(true);
  });

  it('7. page.tsx contains a `verifyOtp` call', () => {
    expect.assertions(1);
    if (pageSource === null) {
      throw new Error('awaiting worker — app/(auth)/reset-password/page.tsx not yet shipped');
    }
    // Substring match on the method name is sufficient — runtime
    // behavior is exercised by Supabase's own tests and the e2e
    // password-reset flow (cycle 3 e2e is OUT OF SCOPE; the call
    // site existing in source is the structural pin).
    expect(/\bverifyOtp\s*\(/.test(pageSource)).toBe(true);
  });

  it('8. page.tsx references searchParams.token_hash and the literal `recovery`', () => {
    expect.assertions(2);
    if (pageSource === null) {
      throw new Error('awaiting worker — app/(auth)/reset-password/page.tsx not yet shipped');
    }
    // Both substrings MUST be present — `token_hash` is the param the
    // PKCE recovery flow sends, and `'recovery'` is the type discriminant
    // verifyOtp expects. A page that calls verifyOtp without checking
    // type==='recovery' would attempt to verify signup confirmation
    // tokens too, which is a different contract.
    expect(pageSource).toMatch(/token_hash/);
    expect(pageSource).toMatch(/['"]recovery['"]/);
  });

  it("9. actions.ts first non-comment line is `'use server';`", () => {
    expect.assertions(1);
    if (actionsSource === null) {
      throw new Error('awaiting worker — app/(auth)/reset-password/actions.ts not yet shipped');
    }
    const lines = actionsSource.split(/\r?\n/);
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

  it('10. actions.ts has no `redirect(` call inside any `try {` block', () => {
    expect.assertions(1);
    if (actionsSource === null) {
      throw new Error('awaiting worker — app/(auth)/reset-password/actions.ts not yet shipped');
    }
    // See login-action.test.ts test 13 for the rationale. Same regex
    // strategy: extract `try { ... }` blocks (non-greedy) and forbid
    // `redirect(` inside any of them. NEXT_REDIRECT is a thrown
    // sentinel; wrapping in try/catch swallows it and turns success
    // into a false-failure.
    const tryBlocks = actionsSource.match(/try\s*\{[\s\S]*?\}/g) ?? [];
    const violation = tryBlocks.find((block) => /\bredirect\s*\(/.test(block));
    expect(violation).toBeUndefined();
  });
});

// Surface the import error (if any) under a separate describe so the
// `awaiting worker` signal is unambiguous in the test output.
describe('reset-password source presence', () => {
  it('action source is importable (or this test reports awaiting worker)', () => {
    expect.assertions(1);
    if (importError) {
      throw new Error(
        `awaiting worker — app/(auth)/reset-password/actions.ts import failed: ${
          importError instanceof Error ? importError.message : String(importError)
        }`,
      );
    }
    expect(typeof resetPasswordAction).toBe('function');
  });
});
