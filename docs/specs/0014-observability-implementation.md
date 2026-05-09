---
adr: 0014
slice: 1
risk: low
acceptance_commands:
  - 'pnpm test tests/observability/'
  - 'pnpm test tests/consent/init-sentry.test.ts'
---

# Spec: Observability — Sentry init + structured logger (ADR-0014 slice 1)

- **ADR:** [0014](../adr/0014-observability.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Fill in the load-bearing observability primitives that other ADRs depend on:
real Sentry init (gated on DSN env var so the absence of a key is a no-op,
not an error), a server-side equivalent for API routes / server actions,
and a structured-log helper with PII redaction at the boundary. The Sentry
DSN is acquired by the owner via the Sentry dashboard (escalation:
SENTRY_DSN secret); when set, init becomes real; until then, the harness
no-ops gracefully.

## Acceptance criteria

1. `lib/sentry/init.ts` (existing shim) is updated so `_internals.doSentryInit`
   calls `Sentry.init` from `@sentry/nextjs` when `process.env.NEXT_PUBLIC_SENTRY_DSN`
   is set; when unset, it's a silent no-op (current behaviour). The
   idempotency contract from ADR-0024 stays intact (the existing
   `tests/consent/init-sentry.test.ts` still passes).
2. `lib/sentry/server-init.ts` exposes `initSentryServer()` with the same
   idempotency contract for server contexts (API routes, server actions).
   Reads `SENTRY_DSN` (server-only env var, no NEXT_PUBLIC prefix).
3. `lib/observability/log.ts` exposes `log.info(message, fields?)`,
   `log.warn(...)`, `log.error(...)`. Output is one-line JSON. `fields` is
   redacted before serialization: any key matching the PII redaction list
   (email, phone, dob, id_doc_path, stripe_*, password, token, secret) is
   replaced with the literal `'[redacted]'`.
4. The Sentry init `beforeSend` hook (per ADR-0014 privacy section)
   redacts the same PII fields from event payloads.
5. Vitest coverage at `tests/observability/`: (a) log redacts the listed
   field names; (b) log preserves non-PII fields; (c) log emits valid
   single-line JSON; (d) initSentryServer is idempotent; (e) initSentry on
   the client is idempotent (existing test passes).
6. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` pass.

## Out of scope

- Configuring the actual Sentry project + DSN (owner action — escalation:
  Sentry account access)
- Vercel log drain to long-term storage (deferred per ADR-0014; depends on
  retention policy decision)
- PostHog initialization (handled in the ADR-0028 PostHog-init follow-up
  slice once the API key is configured)
- Sampling-rate tuning (defaults from ADR-0014: 100% errors, 10% traces;
  hardcoded in this slice; tunable via env var when monitoring proves it
  matters)

## Touched-files inventory

- Modify: `lib/sentry/init.ts` (real init body, DSN-gated)
- Create: `lib/sentry/server-init.ts`
- Create: `lib/observability/log.ts`
- Create: `lib/observability/redact.ts` (the redaction helper)
- Create: `tests/observability/log.test.ts`
- Create: `tests/observability/redact.test.ts`
- Create: `tests/observability/server-init.test.ts`

## Risk flags

- **0023 (privacy/PII) cross-cutting:** the redaction helper is the
  enforcement point for "no PII in logs / errors." Mistakes here are
  silent compliance gaps. Test coverage is exhaustive on the field list.

## Open questions

None at planning time.
