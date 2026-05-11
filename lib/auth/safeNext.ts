import 'server-only';

/**
 * Open-redirect defense for `?next=` redirect targets (ADR-0002, t4).
 *
 * Lifted out of `app/(auth)/login/actions.ts` per spec t4: "Open-redirect
 * validation is a shared helper at `lib/auth/safeNext.ts` (worth lifting to
 * its own file — login isn't the only future caller)." Magic-link callbacks,
 * OAuth callbacks (per route-map.md), and any future signup `?next=` flow
 * MUST import this helper rather than re-rolling the validator.
 *
 * The `import 'server-only';` directive on line 1 is LOAD-BEARING: this is
 * a security primitive whose semantics ("what counts as a safe redirect")
 * are defined by the server-side trust boundary. Pulling the function into
 * a client bundle (e.g. via a shared utils barrel re-export) would tempt
 * a future contributor to call it client-side, where the user agent can
 * already navigate anywhere — eroding the audit-grep that "any safeNext
 * call site is a server-side gate."
 *
 * Returns a safe same-origin path or `/dashboard` if the input is missing,
 * malformed, or attempts an open-redirect. The list of rejections is
 * intentionally explicit:
 *
 *   - empty / non-string                 → `/dashboard`
 *   - does not start with `/`            → `/dashboard`
 *   - starts with `//` (protocol-rel)    → `/dashboard`
 *   - starts with `/\` (backslash trick) → `/dashboard`
 *   - contains `://` anywhere            → `/dashboard`
 *
 * Inputs that pass all gates (e.g. `/dashboard`, `/profile?tab=2`,
 * `/admin/users#section`) are returned verbatim — query strings and hash
 * fragments are preserved so callers can deep-link.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return '/dashboard';
  if (typeof next !== 'string') return '/dashboard';
  if (!next.startsWith('/')) return '/dashboard';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  if (next.includes('://')) return '/dashboard';
  return next;
}
