/**
 * Typed retention schedule helper — ADR-0023 slice 1, AC2.
 *
 * Maps each data category to its ADR-0023 retention window. This is a pure,
 * side-effect-free, I/O-free module: calling getRetentionWindow('audit_log')
 * always returns the same value.
 *
 * Importable from cron handlers (Slice 2), server actions, RSCs, and tests
 * alike. No 'use client', no 'server-only' — it is vanilla TypeScript.
 *
 * Exhaustiveness is enforced by the never-assertion in getRetentionWindow's
 * default branch: adding a new RetentionCategory without updating the
 * function body is a TypeScript compile error, not a runtime fallthrough.
 */

/**
 * Data categories tracked in the ADR-0023 retention schedule.
 * Adding a value here WITHOUT updating getRetentionWindow triggers a
 * compile-time never-assertion error.
 */
export type RetentionCategory =
  | 'id_document'
  | 'audit_log'
  | 'ledger'
  | 'payment'
  | 'sentry'
  | 'posthog'
  | 'session'
  | 'marketing_contact';

/**
 * Retention window discriminated union.
 *
 * - `days`: retain for a fixed number of days from the creation or
 *   triggering event timestamp.
 * - `forever`: no deletion; retained for the lifetime of the system.
 * - `until_event`: retained until a specific lifecycle event occurs
 *   (e.g. unsubscribe, or completion of a verification step).
 */
export type RetentionWindow =
  | { kind: 'days'; days: number }
  | { kind: 'forever' }
  | { kind: 'until_event'; event: 'unsubscribe' | 'verification' };

/**
 * Return the primary retention window for a data category, verbatim from
 * ADR-0023's retention table.
 *
 * For 'id_document', this returns the pre-verification window (retain until
 * verification completes). Use getPostEventRetention('id_document') to get
 * the post-verification follow-on window (30 days).
 *
 * @param category - the data category to look up
 * @returns the primary RetentionWindow
 */
export function getRetentionWindow(category: RetentionCategory): RetentionWindow {
  switch (category) {
    case 'id_document':
      // Retain until ID verification completes, then an additional 30 days
      // (see getPostEventRetention). Primary window is until verification.
      return { kind: 'until_event', event: 'verification' };
    case 'audit_log':
      // Retain forever — compliance, dispute resolution.
      return { kind: 'forever' };
    case 'ledger':
      // Retain forever — financial record.
      return { kind: 'forever' };
    case 'payment':
      // 7 years — tax / IRS requirement.
      return { kind: 'days', days: 365 * 7 };
    case 'sentry':
      // 90 days — Sentry default.
      return { kind: 'days', days: 90 };
    case 'posthog':
      // 1 year — product analytics.
      return { kind: 'days', days: 365 };
    case 'session':
      // 30 days — security forensics.
      return { kind: 'days', days: 30 };
    case 'marketing_contact':
      // Until unsubscribed.
      return { kind: 'until_event', event: 'unsubscribe' };
    default: {
      // Exhaustiveness guard: this branch is unreachable if all
      // RetentionCategory values are handled above. A future engineer who
      // adds a new category to the union without updating this switch will
      // get a compile-time error here, not a silent runtime fallthrough.
      const _exhaustive: never = category;
      throw new Error(`getRetentionWindow: unhandled category ${String(_exhaustive)}`);
    }
  }
}

/**
 * Return the follow-on retention window after a lifecycle event, for
 * categories that have a two-phase retention schedule.
 *
 * Currently only 'id_document' has a post-event follow-on:
 *   - Primary: retain until verification (getRetentionWindow).
 *   - Follow-on: retain for 30 days post-verification, then purge.
 *
 * For all other categories, the primary window covers the full lifetime and
 * this function returns null (no follow-on phase).
 *
 * @param category - the data category to look up
 * @returns the follow-on RetentionWindow, or null if none
 */
export function getPostEventRetention(category: RetentionCategory): RetentionWindow | null {
  switch (category) {
    case 'id_document':
      // 30 days post-verification, per ADR-0023 retention table note.
      return { kind: 'days', days: 30 };
    default:
      return null;
  }
}
