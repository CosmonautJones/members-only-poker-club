import 'server-only';

/**
 * Admin-console PostHog event wiring (ADR-0035 AC31, WD.T21 / t18).
 *
 * Four events emit from the admin surface — gated by ADR-0024 server-side
 * consent. The consent gate runs against the `mopc-consent` cookie via
 * `next/headers`'s `cookies()` (the client-side `readConsent()` cannot be
 * called from a server action — `document` is undefined).
 *
 * **Premortem R4 mitigation (PII cohort leak).** PostHog event property
 * keys MUST NOT match `/email|profile_id|actor_id|target_id|user_id/`.
 * The cross-cutting test `tests/admin/posthog-events.test.ts` asserts
 * this on every payload, and `trackAdminEvent` defensively STRIPS any
 * forbidden key before forwarding so an inattentive future caller cannot
 * leak PII even when the source-grep test misses the new caller.
 *
 * **Q6 acknowledgement (silent telemetry from declined staff).** Staff
 * consent at signup (ADR-0024 cookie banner runs on every page including
 * signup). Staff who decline analytics get a silent admin surface — the
 * audit log remains the operational record-of-record, so the dashboards
 * miss observability rows but the forensic trail is intact.
 *
 * **Server-only.** Reads cookies via `next/headers`. Calling outside a
 * request scope throws; callers (admin server actions, the admin layout
 * RSC) are themselves request-scoped so the constraint is satisfied
 * transitively. The helper swallows ALL errors so a forensic-layer
 * outage cannot break the load-bearing action.
 */

import { cookies } from 'next/headers';

import { getDriver } from './driver';
import type { Events } from './events';
import type { ConsentState } from '@/lib/consent/cookie';

// ---- Event taxonomy --------------------------------------------------------

/**
 * Verbatim event names per ADR-0035 §AC31. These are PostHog event names
 * (snake_case), distinct from the audit_log event names (dot.case). The
 * separation is intentional: PostHog tracks operational observability
 * across the funnel; audit_log tracks the forensic record-of-record.
 */
export const ADMIN_EVENT_NAMES = [
  'admin_session_entered',
  'admin_action_attempted',
  'admin_verification_decision',
  'admin_flag_changed',
] as const;

export type AdminEventName = (typeof ADMIN_EVENT_NAMES)[number];

/** Outcome enum for `admin_action_attempted` payloads. */
export type AdminActionOutcome = 'ok' | 'denied' | 'error';

/** Decision enum for `admin_verification_decision` payloads. */
export type AdminVerificationDecision = 'approve' | 'reject' | 'request_info';

/** Field enum for `admin_flag_changed` payloads. */
export type AdminFlagField = 'enabled' | 'percent' | 'allowlist' | 'role_gate';

// ---- PII guard regex -------------------------------------------------------

/**
 * Premortem R4 forbidden-key regex. Matches property names containing
 * `email`, `profile_id`, `actor_id`, `target_id`, or `user_id` —
 * case-insensitive, anywhere in the key.
 *
 * Exported so the test can assert against the SAME regex the helper
 * uses (one source of truth — premortem-equivalent of the AC28 grep
 * pattern at lib/audit/no-pii.ts).
 */
export const ADMIN_EVENT_FORBIDDEN_KEY_RE = /email|profile_id|actor_id|target_id|user_id/i;

// ---- Consent gate ---------------------------------------------------------

const CONSENT_COOKIE_NAME = 'mopc-consent';

/**
 * Server-side mirror of `lib/consent/cookie.ts`'s `readConsent()`. The
 * client helper uses `document.cookie`; the server reads via
 * `next/headers` cookies(). Returns `null` when the cookie is absent,
 * malformed, or version-mismatched — matching the client-side semantics.
 *
 * Exported so `tests/admin/posthog-events.test.ts` can drive the
 * negative-consent path through the SAME shape the real code reads.
 */
export async function readServerConsent(): Promise<ConsentState | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/await-thenable -- cookies() is sync in Next 14 but async in Next 15; await both paths.
    const store = await cookies();
    const raw = store.get(CONSENT_COOKIE_NAME);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.value);
    } catch {
      return null;
    }
    if (!isValidConsentState(parsed)) return null;
    return parsed;
  } catch {
    // Catch-all — `cookies()` throws outside a request scope. The helper
    // is called from request-scoped code paths only, but a future
    // refactor that imports this module from a build-time entry point
    // would otherwise surface as a confusing 500. Swallow and treat
    // as "no consent" — telemetry is silent, action continues.
    return null;
  }
}

function isValidConsentState(value: unknown): value is ConsentState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.essential === true &&
    typeof v.analytics === 'boolean' &&
    typeof v.errors === 'boolean' &&
    v.version === 1
  );
}

// ---- PII stripping helper -------------------------------------------------

/**
 * Strip any property whose KEY matches `ADMIN_EVENT_FORBIDDEN_KEY_RE`.
 * This is a defense-in-depth seam: the spec contract is "callers send
 * compliant payloads"; this strip catches an inattentive caller before
 * the data leaves the process.
 *
 * Returns a NEW object — the input is not mutated. Values are passed
 * through verbatim (no key-name recursion); the PostHog event property
 * surface is flat by convention.
 */
function stripForbiddenKeys(props: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (ADMIN_EVENT_FORBIDDEN_KEY_RE.test(key)) {
      // Skip — the property name matched the R4 forbidden-key regex.
      // We do NOT log the offending key (it might itself echo the
      // forbidden substring into the log line). Operators inspecting
      // a "missing event property" should compare the source caller
      // against the regex.
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

// ---- Error → outcome classifier -------------------------------------------

/**
 * Map a thrown error to the AC31 `outcome` enum.
 *
 *   - `denied` for typed business-rule rejections and auth-tier denials
 *     (the actor's request was understood + structurally well-formed
 *     but refused: insufficient role, self-edit, range / shape
 *     validation, status-guard).
 *   - `error` for everything else — unexpected DB failures, programming
 *     errors, anything that does NOT name a denial constraint by class.
 *
 * The named denial error classes are the union of:
 *   - `lib/auth/errors.ts`'s `InsufficientRoleError`.
 *   - `app/(admin)/admin/_errors.ts`'s admin-domain errors
 *     (`SelfEditViolation`, `RoleLadderViolation`, `RejectReasonInvalid`,
 *     `MessageInvalid`, `NoChange`, `BadRequest`, `RequestNotPending`,
 *     `ConfirmEmailMismatch`).
 *   - `RangeError` from updateFlag's percent-validation throw.
 *
 * Classification is by `error.name` string match — avoids importing
 * the error classes here (which would create a cyclic dep between
 * the analytics module and the admin route group's _errors module).
 * The class names are part of the action's stable contract: each
 * concrete class's JSDoc pins `this.name = '<ClassName>'`.
 */
export function classifyAdminActionError(err: unknown): AdminActionOutcome {
  if (!(err instanceof Error)) {
    return 'error';
  }
  const denialNames: ReadonlySet<string> = new Set([
    'InsufficientRoleError',
    'SelfEditViolation',
    'RoleLadderViolation',
    'RejectReasonInvalid',
    'MessageInvalid',
    'NoChange',
    'BadRequest',
    'RequestNotPending',
    'ConfirmEmailMismatch',
    'RangeError',
  ]);
  return denialNames.has(err.name) ? 'denied' : 'error';
}

// ---- Queue-depth helper ---------------------------------------------------

/**
 * Best-effort verification-queue depth at the moment of decision
 * (ADR-0035 AC31 `admin_verification_decision` payload). The query
 * matches the queue surface at /admin/verifications:
 *
 *   profiles WHERE id_verified_at IS NULL
 *            AND id_doc_uploaded_at IS NOT NULL
 *            AND id_verification_rejected_at IS NULL
 *
 * Returns `0` on any failure (env-var miss, DB error, RLS denial,
 * supabase outage) — telemetry MUST NOT break the load-bearing action.
 * A zero queue-depth from a failed read looks like an empty queue,
 * which is the least-bad signal for the observability funnel.
 *
 * Lazy-imports the supabase admin client so the analytics module
 * itself does not pull env-var-bound dependencies into its own
 * import graph (which would otherwise trip cycle-1 analytics tests
 * that don't mock supabase).
 */
export async function readVerificationQueueDepth(): Promise<number> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .is('id_verified_at', null)
      .not('id_doc_uploaded_at', 'is', null)
      .is('id_verification_rejected_at', null);
    if (error || typeof count !== 'number') {
      return 0;
    }
    return count;
  } catch {
    return 0;
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * Track an admin-console PostHog event. Consent-gated AND PII-stripped.
 *
 * Behavior:
 *   - Reads the `mopc-consent` cookie server-side. If consent is null,
 *     missing-version, or `analytics: false`, the event is dropped
 *     SILENTLY (no error, no log) — Q6 acknowledgement.
 *   - Defensively strips any property key matching the R4 forbidden-key
 *     regex before forwarding (`email`, `profile_id`, `actor_id`,
 *     `target_id`, `user_id`).
 *   - Forwards via `trackServer` — driver is noop until the PostHog
 *     client lands (ADR-0028 follow-up slice).
 *   - All errors are caught and swallowed. A telemetry-layer outage
 *     MUST NOT break the load-bearing action.
 *
 * @param name — one of the four ADR-0035 §AC31 event names.
 * @param props — flat property bag. Compliant callers pass only
 *   non-PII keys; non-compliant callers have their forbidden keys
 *   stripped here.
 */
export async function trackAdminEvent(
  name: AdminEventName,
  props: Record<string, unknown>,
): Promise<void> {
  try {
    const consent = await readServerConsent();
    if (!consent || !consent.analytics) {
      // Silent drop per ADR-0024 consent gate + Q6 acknowledgement.
      return;
    }

    const safeProps = stripForbiddenKeys(props);

    // Forward straight to the driver. The four admin events are NOT
    // members of the compile-time `Events` discriminated union in
    // lib/analytics/events.ts — that union pins the consumer-funnel
    // call sites where TS narrows the props shape based on the name.
    // Admin events have a runtime-only contract (the four names + the
    // R4-stripped property bag) and are tracked structurally; the
    // driver layer is shape-agnostic so the cast is safe.
    //
    // When the PostHog driver lands in the ADR-0028 follow-up slice,
    // its `capture()` will serialize the payload via JSON anyway —
    // the structural shape is the load-bearing contract, not the
    // compile-time discriminated union.
    const driver = getDriver();
    driver.capture({ name, props: safeProps } as unknown as Events);
  } catch {
    // Catch-all — a forensic-layer outage MUST NOT break the action.
    // Same posture as the audit-event emission hooks in
    // lib/auth/requireRole.ts.
  }
}
