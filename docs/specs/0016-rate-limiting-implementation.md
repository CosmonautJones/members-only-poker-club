---
adr: 0016
slice: 1
risk: medium
acceptance_commands:
  - 'pnpm test tests/rate-limit/'
---

# Spec: Rate limiting (ADR-0016 slice 1)

- **ADR:** [0016](../adr/0016-rate-limiting-and-abuse.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Establish the rate-limiting primitives + wire them into the Edge
Middleware. Slice 1 ships in *monitor-only* mode by default — the limiter
runs and emits the rate-limit headers (`X-RateLimit-*`) but does not 429.
Promotion to enforcement is a one-config-flip when monitoring confirms the
buckets are sized correctly. The Upstash Redis store is the production
target; slice 1 ships an in-memory store that's the right shape for the
Upstash adapter to swap in later (escalation: UPSTASH_REDIS_REST_URL +
UPSTASH_REDIS_REST_TOKEN).

## Acceptance criteria

1. `lib/rate-limit/types.ts` defines `Bucket` (`limit`, `window_ms`,
   `description`), `BucketKey` (`anonymous` | `login` | `signup` |
   `contact_form` | `member` | `staff`), `Decision` (`{ allowed: boolean;
   limit: number; remaining: number; reset_at_ms: number }`).
2. `lib/rate-limit/buckets.ts` exports `BUCKETS: Record<BucketKey, Bucket>`
   per the ADR-0016 numbers (anonymous: 60/min, login: 5/15min, signup:
   3/hour, contact_form: 3/hour, member: 600/min, staff: 1200/min).
3. `lib/rate-limit/store.ts` exports a `Store` interface (`hit(bucket_key,
   subject, now_ms): Promise<Decision>`) and an `InMemoryStore` that
   implements it via a ring-buffer Map. The Upstash adapter is a follow-up
   slice; the interface is stable here.
4. `lib/rate-limit/middleware.ts` exports `applyRateLimit(request,
   bucketKey, subject)` returning a `Decision` and the response headers to
   set. Subjects are typically `ip:<addr>` for anonymous, `user:<id>` for
   authenticated.
5. `middleware.ts` (project root) calls `applyRateLimit` with the
   `anonymous` bucket per IP for every matched route, attaches the
   `X-RateLimit-*` headers to the response, and (when `RATE_LIMIT_MODE !==
   'enforce'`) does NOT 429. When `RATE_LIMIT_MODE = 'enforce'`, returns
   429 with the structured JSON body `{ error: 'rate_limited',
   retry_after_seconds: N }`.
6. `lib/rate-limit/headers.ts` exports `rateLimitHeaders(decision)` →
   `Record<string, string>` returning the three RFC-style headers.
7. Vitest coverage at `tests/rate-limit/`: (a) every bucket from the ADR
   has an entry; (b) the in-memory store correctly counts hits within and
   across windows; (c) the Decision shape matches the type; (d) headers
   reflect the decision; (e) middleware monitor-mode never 429s.
8. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` pass.

## Out of scope

- Upstash Redis adapter (needs API keys — escalation)
- Cloudflare Turnstile bot detection (deferred; ADR-0016 says yes but
  needs site key + secret, escalation)
- Per-route bucket assignment (every matched route uses `anonymous` for
  v1; the per-route map is added when login / signup pages exist)
- Honeypot field (declined per ADR-0016 ratification)

## Touched-files inventory

- Create: `lib/rate-limit/types.ts`
- Create: `lib/rate-limit/buckets.ts`
- Create: `lib/rate-limit/store.ts`
- Create: `lib/rate-limit/headers.ts`
- Create: `lib/rate-limit/middleware.ts`
- Modify: `middleware.ts` (project root) — chain rate-limit before Supabase session update
- Create: `tests/rate-limit/store.test.ts`
- Create: `tests/rate-limit/headers.test.ts`
- Create: `tests/rate-limit/middleware.test.ts`
- Create: `tests/rate-limit/buckets.test.ts`

## Risk flags

- **0017 (CI/CD) downstream:** rate limiting in front of every request
  affects CI smoke tests if e2e runs concurrently. Slice 1 monitor-only
  posture mitigates: tests can never be 429'd. When promoted to enforce,
  CI must use `?ratelimit=skip` query (set in tests-e2e setup) or a
  carve-out for the e2e user-agent.

## Open questions

None at planning time.
