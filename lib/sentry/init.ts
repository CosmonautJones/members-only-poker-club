/**
 * T6 — `initSentry()` idempotent stub per ADR-0024 + Slice-1 spec AC9.
 *
 * Module-level idempotency flag is the load-bearing detail (concern 6):
 * two calls within a single module lifetime invoke the underlying init
 * exactly once. ADR-0014's slice swaps `_internals.doSentryInit`'s body
 * for the real `Sentry.init({ dsn, ... })` call without changing this
 * contract — the flag stays, the seam stays.
 *
 * The exported `_internals` seam exists so vitest can spy on the
 * underlying init body and assert call-count contractually. The real
 * idempotency assertion is therefore: "no matter how many times the
 * outer `initSentry()` is called, `_internals.doSentryInit` runs
 * exactly once."
 *
 * We use an exported object (rather than a self-import or a free
 * function) because spying on an object property always works under any
 * module-format transpilation: `vi.spyOn(_internals, 'doSentryInit')`
 * replaces the property on the same object reference that `initSentry`
 * reads at call time, so the spy fires regardless of CJS/ESM live-binding
 * semantics.
 */

let initialized = false;

/**
 * Test-only seam — the underlying init body lives on this object so
 * `vi.spyOn(_internals, 'doSentryInit')` is reliably observed by
 * `initSentry`'s call site.
 *
 * ADR-0014 replaces `doSentryInit`'s body with the real
 * `Sentry.init({ dsn, ... })`; the seam stays so this slice's idempotency
 * test continues to bind.
 */
export const _internals = {
  doSentryInit(): void {
    // TODO(adr-0014): real Sentry.init({ dsn, ... }) when ADR-0014 ratifies.
  },
};

/**
 * Idempotent Sentry init — multiple calls run the underlying init exactly once.
 *
 * Real init lives in `_internals.doSentryInit` (currently a no-op stub).
 * The flag here is the contract (concern 6, AC9): two invocations within
 * a single module lifetime cause exactly one `_internals.doSentryInit` call.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  _internals.doSentryInit();
}

/** Test-only — reset the module-level idempotency flag. */
export function __resetSentryInitForTests(): void {
  initialized = false;
}
