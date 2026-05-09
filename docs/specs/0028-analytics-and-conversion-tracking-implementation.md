---
adr: 0028
slice: 1
risk: low
acceptance_commands:
  - 'pnpm test tests/analytics/'
---

# Spec: Analytics event taxonomy + tracking surface (ADR-0028 slice 1)

- **ADR:** [0028](../adr/0028-analytics-and-conversion-tracking.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Ship the typed event taxonomy + `track()` API surface that respects the
ADR-0024 consent gate. No PostHog SDK initialization in this slice — the
driver is a swappable interface; the real PostHog client init lands in a
follow-up slice when the API key is configured (escalation: PostHog API
key required).

## Acceptance criteria

1. `lib/analytics/events.ts` exports an `Events` discriminated-union type
   covering every event in ADR-0028's taxonomy: `landing_page_viewed`,
   `membership_page_viewed`, `signup_*` (5 variants),
   `membership_billing_kind_switched`, `membership_canceled`,
   `time_topup_*` (3 variants), `tournament_*` (3 variants),
   `cashier_redeem_completed`. Each event has a typed `props` shape per the
   ADR (e.g., `time_topup_completed` carries `{ tier, gross_cents,
   bonus_cents }`).
2. `lib/analytics/track.ts` exports `track<E extends Events>(event: E):
   void`. Client-side: if `analytics` consent is `true`, forwards to the
   active driver; if `false` or `null`, drops the event silently (the
   ADR-0028 "buffer until consent" path is documented but deferred to the
   PostHog-init slice). Server-side: forwards to a server driver
   regardless of consent (server-side tracking is not subject to the
   browser consent gate; it cannot read browser cookies and PII redaction
   per ADR-0014 happens at the driver level).
3. `lib/analytics/driver.ts` exports a `Driver` interface (`capture(event,
   props)` + `identify(id, traits)`) and a `noopDriver` implementation
   that records calls to a buffer. The active driver is exported via
   `getDriver()`; in this slice it returns `noopDriver` (the PostHog
   driver swap is a follow-up).
4. `lib/analytics/index.ts` re-exports the public surface: `track`,
   `Events`, the typed event names, and a `clearBuffer()` test helper
   that resets the noop driver's buffer.
5. Vitest coverage at `tests/analytics/`: (a) every event shape compiles
   and the typed payload narrows correctly; (b) client-side `track` drops
   events when consent is null/false and forwards when true; (c) server-side
   `track` always forwards; (d) the noop driver records events and the
   helper clears the buffer.
6. Backstop grep added: no direct `import 'posthog-js'` outside
   `lib/analytics/`. Catches stray PostHog imports that would bypass the
   consent gate. Runs in the existing CI backstop-greps job.
7. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.

## Task decomposition hints

- t0 — `events.ts` (typed taxonomy)
- t1 — `driver.ts` (Driver interface + noopDriver)
- t2 — `track.ts` (consent-aware client + server entry points)
- t3 — `index.ts` (public surface)
- t4 — vitest coverage
- t5 — CI backstop grep

## Touched-files inventory

- Create: `lib/analytics/events.ts`
- Create: `lib/analytics/driver.ts`
- Create: `lib/analytics/track.ts`
- Create: `lib/analytics/index.ts`
- Create: `tests/analytics/events.test.ts`
- Create: `tests/analytics/track.test.ts`
- Create: `tests/analytics/driver.test.ts`
- Modify: `.github/workflows/ci.yml` (add posthog-import backstop grep)

## Risk flags

- **0024 (consent) cross-cutting:** mistakes here mean analytics events
  fire before consent. The consent-gating logic lives in `track.ts` and
  has dedicated test coverage.

## Out of scope

- PostHog SDK initialization (needs API key — escalation)
- Buffered-on-consent flush (sub-feature of the PostHog init slice)
- Server-side cashier redemption events (lands with ADR-0011 time-bank)
- Funnel definitions in PostHog dashboard (admin-side; not code)
- Stripe Sigma revenue attribution (deferred to Slice 4 per ADR-0028)

## Open questions

None at planning time.
