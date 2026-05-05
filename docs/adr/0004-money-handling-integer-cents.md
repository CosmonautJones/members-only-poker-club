# ADR-0004: Money handling — integer cents, currency

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1 (schema), 2 (subscriptions), 3 (time-bank purchases & redemptions)

## Context

The system handles money in three places: monthly membership ($30 / $25), one-time time-bank top-ups ($50 / $100 / $200 / $500), and tournament entry fees (variable). Time consumption is also denominated in money implicitly ($12/hr) but stored as minutes.

Floating-point dollars are a known source of bugs (`0.1 + 0.2 !== 0.3`). PostgreSQL `numeric(10,2)` works but is awkward across language boundaries (TypeScript has no native decimal type).

## Decision

**All money is stored and computed as integer cents** (`bigint` in Postgres, `number` in TypeScript with a branded type to prevent accidental mixing with cent-as-decimal values).

**All time is stored as integer minutes.**

Conversion to dollars happens only at the **rendering boundary** via a single `formatMoney(cents: Cents): string` helper.

### Schema rules

- Columns named `*_cents` for money.
- Columns named `*_minutes` for time.
- Never `decimal`, never `float`, never `numeric` for money. Compile-time `tsc` check would catch this; we add a CI grep rule as a backstop.

### Currency

- All amounts are USD. The schema does **not** carry a currency column in v1 — encoding the assumption explicitly.
- Stripe transactions are all created with `currency: 'usd'`. A reconciliation job checks Stripe events for currency mismatch and alerts; if a non-USD payment ever arrives, it's an incident.
- If multi-currency arrives later, we add `currency_code` to `payments`, `time_ledger`, and adapt the renderer. This ADR will be superseded.

### Math

- All arithmetic on money happens in cents. No `cents / 100` until the render boundary.
- Discounts (the autopay $5/mo, the $200→$300 promo bonus) are stored as **separate ledger entries**, not as a discounted amount. The audit trail shows the gross transaction and the bonus transaction independently.
- Tax (TX state sales tax on memberships if the CPA so advises) is computed at checkout and stored as its own line item on the Stripe invoice; the local `payments` row stores the `amount_cents` that reflects the total charged.

### Branded type

```ts
// lib/money/types.ts
export type Cents = number & { readonly __brand: 'Cents' };
export const cents = (n: number): Cents => Math.round(n) as Cents;
export const dollars = (cents: Cents): number => cents / 100;
export const formatMoney = (c: Cents): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
```

## Consequences

**Positive:**

- No rounding bugs. `25 + 5 = 30`, never `30.0000001`.
- The branded type catches `cents + dollars` mistakes at compile time.
- Append-only ledger entries make reconciling against Stripe trivial.

**Negative:**

- Display logic always has to call `formatMoney`. Forgotten conversions show users "$3000 due" when they owe $30. Mitigation: lint rule that flags `\$\{.*_cents` template literals.
- Multi-currency support is a future migration (probably easy, but a migration nonetheless).
- Time stored as integer minutes means we can't render fractional minutes (5.5 minutes is impossible). Acceptable — the cashier UI only redeems whole minutes.

## Alternatives considered

- **`numeric(10,2)` in Postgres, `Decimal.js` in TypeScript.** More expressive (fractional minutes possible), but adds a dependency, slows arithmetic, and we still need the render-boundary helper. Rejected — the simplicity win of integer cents outweighs the flexibility loss.
- **`float`/`number` for dollars.** No. See [Wikipedia: Floating-point arithmetic § Accuracy problems](https://en.wikipedia.org/wiki/Floating-point_arithmetic#Accuracy_problems).
- **Stripe's smallest currency unit always (no local storage of cents).** Then we'd need to query Stripe to compute a member's available balance. Rejected — Stripe is source of truth for *subscription state*, not for our own ledger.
