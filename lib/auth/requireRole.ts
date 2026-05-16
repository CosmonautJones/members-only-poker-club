import 'server-only';
import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { getCurrentProfile } from './getCurrentProfile';
import { InsufficientRoleError } from './errors';
import { ROLE_RANK, type Role } from './types';
import { getSessionAal } from './getSessionAal';
// Namespace import so the test can flip `MFA_CHALLENGE_READY` between
// cases via a getter-backed `vi.mock`. A bare named import would still
// work under ESM live bindings, but the namespace form is the
// least-surprising shape for callers grepping for the constant.
import * as MfaAvailability from './mfa-availability';
// Lazy-imported per-call so the audit module's `server-only` directive
// + supabase env-var reads don't fire at module load time (which would
// break the existing `tests/auth/requireRole.test.ts` matrix that
// doesn't mock supabase). See `__auditHooks` JSDoc for details.

// Re-export `Role` from the canonical types module so existing call sites
// (and `tests/auth/requireRole.test.ts`, which imports `type Role` from
// '@/lib/auth/requireRole') keep working without coupling them to the
// types-module path. New code SHOULD import `Role` from `@/lib/auth/types`
// directly.
export type { Role };

/**
 * Roles for which `requireRole` enforces the AAL2 (MFA) assertion.
 *
 * ADR-0035 §Auth: no `/admin/**` page renders content over an aal1
 * session. The AAL check is encapsulated INSIDE `requireRole` so the
 * admin layout has a single first-statement (`await requireRole('manager')`)
 * — see AC4 / B1 reconciliation. `member` and `cashier` callers do NOT
 * require aal2 (those gates are below the admin surface), so the AAL
 * check is skipped for them. This keeps cycle-1 callers unchanged.
 */
const AAL2_REQUIRED_ROLES: ReadonlySet<Role> = new Set(['manager', 'owner']);

/**
 * Cookie name used to deduplicate `admin.session.entered` emissions
 * per browser tab / session (ADR-0035 AC31 + AC34). Set on the FIRST
 * successful manager+ entry; subsequent entries see the cookie and
 * suppress the audit row. TTL is 30 minutes — matches the PostHog
 * dedup window named in §AC31. Setting the cookie inside `requireRole`
 * (rather than the layout) means every code path that enters a
 * manager+ surface contributes to the dedup, including direct server
 * action calls that bypass the layout shell.
 */
const ADMIN_SESSION_SEEN_COOKIE = 'mopc-admin-session-seen';
const ADMIN_SESSION_SEEN_TTL_SEC = 60 * 30; // 30 min

/**
 * Audit-event hook seams (ADR-0035 AC4 + AC34).
 *
 * Wired by t17 to emit the Slice 4D session-level audit events. The
 * shape was pinned in t2 (no-op stubs); this task (t17) replaces the
 * no-ops with real audit_log INSERT calls. Both implementations are
 * defensive: any error during emission is logged + swallowed so the
 * load-bearing security boundary (the rank + AAL gates) is not
 * compromised by an audit-infrastructure outage.
 *
 * The names match the sixteen-event taxonomy in ADR-0035 §AC27:
 *   - `admin.session.entered`           — first entry per tab/session
 *   - `admin.session.role_check_denied` — InsufficientRoleError thrown
 *     on an `/admin/**` path
 *
 * Internal-only. Exported for the t17 wiring task and for the
 * `tests/admin/session-and-flow-audit-events.test.ts` source-grep.
 *
 * Dedup contract (`admin.session.entered`):
 *   - Reads cookie `mopc-admin-session-seen` (30-min TTL).
 *   - When absent, emits the audit row AND sets the cookie.
 *   - When present, no row is emitted.
 *   - Cookie scope is per-browser-tab in v1 (HTTP cookies don't
 *     distinguish tabs natively, but the 30-min TTL keeps the
 *     surface small). A future cycle may switch to sessionStorage
 *     + a client component for true tab-scoping.
 *
 * Path scoping (`admin.session.role_check_denied`):
 *   - Reads `x-pathname` from request headers and only emits when the
 *     path starts with `/admin`. A `requireRole('manager')` call from
 *     a non-`/admin` surface (e.g. a hypothetical owner-only setting
 *     on the portal) does NOT log to this event — the event name
 *     literally refers to the admin console denial path.
 *
 * Server-only constraint:
 *   - These functions call `cookies()` + `headers()` from `next/headers`
 *     which throw outside a request scope. The caller (`requireRole`)
 *     is itself only callable within a request scope, so the
 *     constraint is satisfied transitively. Tests that exercise the
 *     emission MUST mock both `next/headers` and the audit module.
 */
export const __auditHooks = {
  async onAdminSessionEntered(actorId: string, _role: Role): Promise<void> {
    try {
      // Dedup via the `mopc-admin-session-seen` cookie. The cookie's
      // value itself is opaque (`'1'`) — only its presence + TTL
      // matter. Reading + writing cookies is async-safe in Next 14+
      // server components / actions; tests mock `next/headers` to
      // pin both surfaces.
      // eslint-disable-next-line @typescript-eslint/await-thenable -- cookies() is sync in Next 14 but async in Next 15; await both paths.
      const cookieStore = await cookies();
      const seen = cookieStore.get(ADMIN_SESSION_SEEN_COOKIE);
      if (seen) {
        // Already seen this session — suppress duplicate emission.
        return;
      }
      // Mark seen FIRST so a partial-failure (audit INSERT throws)
      // doesn't dirty the audit log on the next request with the
      // same content. The 30-min TTL is generous enough that a real
      // production cookies() write that silently fails (RSC context
      // — see lib/supabase/server.ts:31) doesn't cascade into
      // unbounded duplicate rows.
      try {
        cookieStore.set(ADMIN_SESSION_SEEN_COOKIE, '1', {
          maxAge: ADMIN_SESSION_SEEN_TTL_SEC,
          path: '/',
          sameSite: 'lax',
          httpOnly: true,
        });
      } catch {
        // Server Components cannot set cookies — same pattern as
        // lib/supabase/server.ts. Ignore; the next request that
        // goes through middleware will re-emit, but the operational
        // impact is bounded.
      }

      // Cookie-scoped client for the success path (ADR-0035 AC34 t17).
      // The role check just succeeded so we have a valid authenticated
      // session AND the audit_log INSERT policy
      // (audit_log_insert_authenticated) is satisfied by `auth.uid() IS
      // NOT NULL` — the cookie-scoped client carries that session.
      // Using the cookie-scoped client here preserves the "actor's own
      // write" forensic posture: the audit row's actor_id and the
      // database connection identity match, so a future audit-log
      // viewer's "rows written by user X" filter is internally
      // consistent without a service-role escape hatch.
      //
      // Lazy import so module load doesn't trigger env-var reads
      // (which would break the cycle-1 requireRole.test.ts matrix
      // that doesn't mock supabase).
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = createClient();
      const { error } = await supabase.from('audit_log').insert({
        actor_id: actorId,
        action: 'admin.session.entered',
        target_type: 'session',
        target_id: actorId, // the actor is the target of "they entered"
        before: null,
        after: null,
        ip: null,
        user_agent: null,
      });
      if (error) {
        // Don't throw — the security boundary (the rank + AAL
        // gates) is already satisfied; audit emission is a
        // forensic add-on.
        console.warn('requireRole: admin.session.entered emission failed', {
          error: error.message,
        });
      }
    } catch (err) {
      // Catch-all so an audit-infrastructure outage never breaks
      // the request. Premortem-equivalent of R12: never let a
      // forensic-layer failure surface as a user-visible error.
      console.warn('requireRole: admin.session.entered hook threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  async onAdminRoleCheckDenied(
    actorId: string,
    required: Role,
    actual: Role,
  ): Promise<void> {
    try {
      // Path scope — only emit when the denial happened on an
      // /admin/** path. A lower-rank caller poking at a hypothetical
      // owner-only setting on the portal would otherwise generate
      // false positives in the admin-console denial channel.
      // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is sync in Next 14 but async in Next 15; await both paths.
      const hdrs = await headers();
      const pathname = hdrs.get('x-pathname') ?? hdrs.get('x-invoke-path') ?? '';
      if (!pathname.startsWith('/admin')) {
        return;
      }

      // Service-role for the denial INSERT — the denied session
      // lacks the role to write under, so we MUST use the admin
      // (BYPASSRLS) client. This is the canonical "actor_id is
      // captured but the writer is service-role" pattern named in
      // the AC34 t17 task description.
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const admin = createAdminClient();
      const { error } = await admin.from('audit_log').insert({
        actor_id: actorId,
        action: 'admin.session.role_check_denied',
        target_type: 'session',
        target_id: actorId,
        before: null,
        // `after` records the structural denial details — role
        // names are NOT PII (AC28's redaction list is email /
        // full_name / phone / dob; role string is operational).
        after: { required, actual, path: pathname },
        ip: null,
        user_agent: null,
      });
      if (error) {
        console.warn(
          'requireRole: admin.session.role_check_denied emission failed',
          { error: error.message },
        );
      }
    } catch (err) {
      console.warn('requireRole: admin.session.role_check_denied hook threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
} as const;

export async function requireRole(
  required: Role,
): Promise<{ profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>> }> {
  const profile = await getCurrentProfile();
  if (!profile) {
    // No session → redirect to /login with the original path as next param.
    // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is synchronous in Next 14 but tests mock it as async (Next 15 forward-compat); keeping the await makes both code paths work.
    const hdrs = await headers();
    const pathname = hdrs.get('x-pathname') ?? hdrs.get('x-invoke-path') ?? '/';
    const search = hdrs.get('x-search') ?? '';
    const next = encodeURIComponent(pathname + search);
    redirect(`/login?next=${next}`);
  }
  const have = ROLE_RANK[profile.role] ?? -1;
  const need = ROLE_RANK[required] ?? Number.POSITIVE_INFINITY;
  if (have < need) {
    // Emit `admin.session.role_check_denied` ONLY when the denial
    // happens on a manager+ required minimum (ADR-0035 AC34). A
    // lower-rank caller failing a member/cashier gate on a non-admin
    // surface is not an admin-console denial event. The hook itself
    // also gates on the request path starting with `/admin` (defense
    // in depth) — both checks must pass for an audit row to land.
    // Fire-and-forget (void) so the audit emission cannot delay the
    // throw; the hook internally swallows errors per its own JSDoc.
    if (AAL2_REQUIRED_ROLES.has(required)) {
      void __auditHooks.onAdminRoleCheckDenied(profile.id, required, profile.role);
    }
    throw new InsufficientRoleError(required, profile.role);
  }

  // AAL2 gate — only for manager|owner required minimums (ADR-0035 AC4).
  // Member/cashier required minimums never trigger this branch, so
  // cycle-1 callers (the member portal, cashier console gates) keep
  // their pre-existing semantics. The gate runs AFTER the rank check
  // so a privilege-escalation attempt by a lower-rank actor still
  // surfaces as `InsufficientRoleError` (not a deceptive redirect to
  // /login/mfa-pending — premortem invariant: never collapse the
  // rank-deny and AAL-deny branches into the same outward signal).
  if (AAL2_REQUIRED_ROLES.has(required)) {
    const aal = await getSessionAal();
    if (aal !== 'aal2') {
      // eslint-disable-next-line @typescript-eslint/await-thenable -- headers() is synchronous in Next 14 but tests mock it as async (Next 15 forward-compat); keeping the await makes both code paths work.
      const hdrs = await headers();
      const pathname = hdrs.get('x-pathname') ?? hdrs.get('x-invoke-path') ?? '/';
      const search = hdrs.get('x-search') ?? '';
      const next = encodeURIComponent(pathname + search);
      if (MfaAvailability.MFA_CHALLENGE_READY) {
        redirect(`/login/mfa-challenge?next=${next}`);
      }
      // Graceful degradation (ADR-0035 Open Q 7): the /login/mfa-challenge
      // route is owned by ADR-0002 cycle 4 and may not exist yet. The
      // static /login/mfa-pending page tells the user "MFA enrollment
      // required — please contact the club owner." See
      // `app/(auth)/login/mfa-pending/page.tsx`.
      redirect(`/login/mfa-pending?next=${next}`);
    }
    // `admin.session.entered` emission (ADR-0035 AC34). The hook
    // performs cookie-based dedup (30-min TTL via
    // `mopc-admin-session-seen`) so only the first manager+ entry per
    // session writes an audit row. Fire-and-forget (void) so the
    // audit emission cannot delay the return; the hook internally
    // swallows errors per its own JSDoc.
    void __auditHooks.onAdminSessionEntered(profile.id, profile.role);
  }

  return { profile };
}
