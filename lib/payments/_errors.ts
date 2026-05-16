import 'server-only';

/**
 * `StripeNotConfiguredError` — fail-loud sentinel thrown at the Stripe
 * boundary in Slice 1 of ADR-0036.
 *
 * The class is split out into its own module (rather than co-located
 * with `stripe-client.ts`) so consumers can `import type` the class for
 * typed `catch` narrowing without dragging in the env-probe side effect.
 *
 * ## Information-disclosure posture (fail-loud premortem risk 3)
 *
 * - `userMessage` is the ONLY string `error.tsx` should render. It is a
 *   stable literal that does NOT mention the env-var name, stack, or
 *   ADR-0010 activation guidance — a manager seeing it learns "this
 *   surface is pending" and nothing else.
 * - `Error.prototype.message` is shaped for SERVER LOGS (manager-side
 *   forensics + Sentry); it cites ADR-0010 but explicitly does NOT
 *   include the env-var name. Sentry captures `error.message` verbatim
 *   without redaction, so the constructor argument NEVER appears here.
 * - `missingEnvVar` is defined as a NON-ENUMERABLE own property via
 *   `Object.defineProperty`. Consequences:
 *     1. `JSON.stringify(err)` omits it (no env-var-name disclosure in
 *        any serialized logging that uses `JSON.stringify`).
 *     2. Sentry's `beforeSend` walker (which enumerates own keys via
 *        `Object.entries`-equivalent) omits it.
 *     3. Typed-catch handlers can STILL read it (`err.missingEnvVar`)
 *        because non-enumerable does not mean inaccessible.
 *     4. The companion redaction pattern `/^missingEnvVar$/i` in
 *        `lib/observability/redact.ts` is belt-and-suspenders for any
 *        future code path that manually serializes the property.
 *
 * Slice 2 of ADR-0010 (Stripe activation) replaces all throw sites
 * with real `Stripe` SDK calls; this class survives to model OTHER
 * future "Stripe is not yet wired" surfaces (e.g. test-mode probes
 * against a missing `STRIPE_WEBHOOK_SECRET`).
 */
export class StripeNotConfiguredError extends Error {
  // Use `readonly` + literal-typed initializers so a future contributor
  // cannot accidentally rebind these to a leaky variant.
  public override readonly name = 'StripeNotConfiguredError' as const;

  /**
   * Stable, render-safe string for `error.tsx` boundaries. This is the
   * ONLY field that should ever appear in client-visible UI for a
   * StripeNotConfiguredError. Pin in tests + boundary + class so drift
   * requires three coordinated edits.
   */
  public readonly userMessage = 'Stripe integration pending — see ADR-0010' as const;

  /**
   * The env var whose absence triggered the throw. Defined as a
   * non-enumerable own property via the constructor — see class JSDoc
   * for why. Typed as `string` here for autocomplete; the actual
   * property descriptor (set by the constructor) makes it
   * non-enumerable + non-writable + non-configurable.
   *
   * Do NOT initialize this as a class field — that would create an
   * ENUMERABLE own property at construction time, defeating the
   * redaction posture.
   */
  declare public readonly missingEnvVar: string;

  constructor(missingEnvVar: string) {
    // The `super(...)` message is the SERVER-LOG string. It cites
    // ADR-0010 (so log-diggers find the activation runbook) but does
    // NOT name the env var (so Sentry's `error.message` field cannot
    // leak it without explicit handling).
    super('Stripe is not configured (env var missing). See ADR-0010 for activation steps.');

    // Restore prototype chain for `instanceof` to work after `super(...)`
    // when targeting ES2015+ class semantics (standard pattern for
    // custom Error subclasses).
    Object.setPrototypeOf(this, new.target.prototype);

    // Define `missingEnvVar` as a non-enumerable own property. This is
    // the single load-bearing line for the Sentry/PII redaction
    // posture: enumerable=false makes JSON.stringify and Sentry's
    // own-key walker skip the field, while writable=false +
    // configurable=false make tampering impossible from caller code.
    Object.defineProperty(this, 'missingEnvVar', {
      value: missingEnvVar,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}
