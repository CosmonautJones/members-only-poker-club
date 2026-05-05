# ADR-0014: Observability

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1 (skeleton — Sentry + Vercel logs) → 4 (full)

## Context

When something breaks in production, we need to know fast and have the data to diagnose. Three telemetry types: errors (exceptions, panics), logs (structured events), traces (request flows across systems).

## Decision

To be drafted in Slice 4. Direction:

- **Errors** — Sentry, both client (browser) and server (Vercel functions). Source maps uploaded at build time.
- **Logs** — Vercel function logs (already structured JSON via `console.log`) + Supabase logs for DB queries. Long-term retention via the Vercel log drain to a cheap storage (Logtail / Better Stack).
- **Traces** — Sentry Performance for HTTP + DB spans. p95 latency tracked per route; alert if degrades >2× baseline for 10 min.
- **Metrics** — Vercel Analytics (built-in) for traffic. Stripe webhook delivery rate monitored at Stripe dashboard.
- **Custom events** — PostHog for product analytics (signup_started, signup_completed, time_topup_completed, tournament_register_completed). Client-side, gated by cookie consent (ADR-024).

### Sampling

- 100% of errors
- 10% of traces in production (Sentry profiling cost)
- 100% of slow transactions (>3s)

### Privacy

- Sentry beforeSend hook redacts PII fields (email, phone, dob, id_doc_path, stripe_*) from event payloads.
- PostHog session replay disabled by default (re-enable on a per-screen basis if needed).

### Dashboards (Slice 4)

- Membership funnel: pageview → signup_started → email_verified → id_uploaded → agreement_signed → first_payment
- Time-bank funnel: portal visit → buytime page → tier selected → checkout completed
- Cashier reliability: redeem_attempt → redeem_success rate
- Webhook health: stripe events received vs processed, lag

## Open questions

- Cost of Sentry at our volume (probably free tier sufficient for v1)
- Long-term log retention duration (compliance vs cost)
- Whether to add Datadog/Honeycomb for higher-fidelity tracing later
