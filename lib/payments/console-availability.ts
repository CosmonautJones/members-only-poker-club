import 'server-only';

/**
 * `PAYMENTS_CONSOLE_READY` — static boolean constant that the
 * `openRefundFlow` server action (ADR-0035 AC17) checks to decide
 * whether the payments-console route at `/admin/payments/[id]/refund`
 * exists yet. ADR-0036 (payment management console) is the in-flight
 * spec that ships the route; until that ADR lands and flips this
 * constant to `true`, `openRefundFlow` returns a degraded redirect
 * target (`/admin/members/[id]?refund=pending-adr-0036`) that the page
 * renders as a "refund flow not yet available" toast.
 *
 * Q4 default — see `docs/adr/0035-admin-operations-console.md`
 * §Open Questions Q4: this slice (ADR-0036 v1) ships
 * `PAYMENTS_CONSOLE_READY=true`. The `openRefundFlow` action now
 * redirects to `/admin/payments/[id]/refund` instead of the degraded
 * `/admin/members/[id]?refund=pending-adr-0036` target. Audit
 * breadcrumbs still fire in both cases (the breadcrumb is the whole
 * point of `openRefundFlow` even before ADR-0036 lands); only the
 * `redirectTo` target switches.
 *
 * ADR-0036 coordination note — see ADR-0035 spec S8 + the planner
 * coordination concern surfaced in
 * `.conductor/0035/dispatches/0002-critic-spec.md` S8: the conductor
 * session that drives ADR-0036 MUST verify the ADR-0036 spec contains
 * an explicit AC that flips this constant to `true` upon ship. Test
 * coverage for the flip lives in `tests/admin/open-refund-flow-action.test.ts`
 * (asserts degraded redirect when `false`); ADR-0036's spec should add
 * the inverse assertion (asserts canonical redirect when `true`).
 *
 * `import 'server-only'` is LOAD-BEARING: the constant must NEVER be
 * read from client bundles. The refund-flow button in the member-detail
 * UI is a plain link that POSTs to the server action; the client side
 * has no business knowing whether the payments console is ready —
 * that's the action's decision.
 */
export const PAYMENTS_CONSOLE_READY: boolean = true;
