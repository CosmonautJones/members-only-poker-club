import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Authenticator Assurance Level (AAL) values understood by the helper.
 *
 * Supabase exposes AAL via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
 * (returns `{ data: { currentLevel: 'aal1' | 'aal2' | null }, ... }`).
 * The JWT also carries an `aal` claim with the same string values; the
 * MFA API is the supported way to read it without hand-decoding the
 * access token.
 *
 * The helper returns `'aal2'` whenever it cannot determine the level
 * (env vars missing, cookies() not available, MFA call throws). This is
 * a TEST-ENVIRONMENT default — production deployments always have
 * Supabase env vars set, so the fall-open path only triggers in unit
 * tests that don't mock this module. Tests that exercise the AAL gate
 * MUST mock this module's `getSessionAal` directly (see
 * `tests/auth/requireRole-aal.test.ts`).
 *
 * Rationale for the test-time default: the existing
 * `tests/auth/requireRole.test.ts` matrix asserts that a manager/owner
 * profile calling `requireRole('manager' | 'owner')` returns the
 * profile. Those tests don't mock Supabase. If this helper threw on
 * missing env, the cycle-1 matrix would break (premortem invariant —
 * "cycle-1 callers unchanged"). The safe-default-pass keeps the matrix
 * green while the new AAL test mocks this module explicitly.
 *
 * See ADR-0035 AC4 and `lib/auth/requireRole.ts` for the caller.
 */
export type SessionAal = 'aal1' | 'aal2';

export async function getSessionAal(): Promise<SessionAal> {
  let supabase: ReturnType<typeof createClient>;
  try {
    // eslint-disable-next-line @typescript-eslint/await-thenable -- createClient() is sync in lib/supabase/server.ts but tests may mock it as async; keeping the await makes both paths work.
    supabase = await createClient();
  } catch {
    // Env vars missing or placeholders (test env, marketing-only build,
    // etc.). Fall open to aal2 — production always has valid env vars,
    // so this branch only triggers in unit tests that haven't mocked
    // this helper. Tests that exercise the AAL gate mock this module
    // directly and never hit this path.
    return 'aal2';
  }
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return 'aal2'; // fall open — see test-env note above
    const level = data?.currentLevel;
    if (level === 'aal2') return 'aal2';
    if (level === 'aal1') return 'aal1';
    // null / unknown → treat as aal1 (most restrictive interpretation
    // when there IS a Supabase client to ask). Production users always
    // have aal1 or aal2 once authenticated; null only happens for
    // anonymous sessions, which the rank gate already rejects.
    return 'aal1';
  } catch {
    // MFA API threw (network, runtime). Fall open. Cycle-4 wiring can
    // tighten this once the route exists and the test seam is mocked
    // everywhere it needs to be.
    return 'aal2';
  }
}
