---
adr: 0015
slice: 1
risk: low
acceptance_commands:
  - 'pnpm test tests/ops/'
---

# Spec: Alerting & incident-response docs (ADR-0015 slice 1)

- **ADR:** [0015](../adr/0015-alerting-and-incident-response.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Ship the alerting docs surface so on-call has a reference: severity ladder,
channels, source-of-alerts catalog, and the post-incident postmortem
template. The actual Sentry alert-rule configuration in the Sentry dashboard
is owner work (escalation: Sentry account access required); this slice
documents what those rules MUST be so they're checkable by anyone
auditing the alert posture.

## Acceptance criteria

1. `docs/ops/alerting.md` exists with: severity ladder (SEV1/2/3),
   channels per severity, source-of-alerts catalog (Sentry / Vercel /
   Supabase / Stripe / synthetic), and the on-call expectation per ADR-0015.
2. `docs/runbooks/runbook-incident-response.md` exists with the SEV1/SEV2
   first-response procedure (acknowledge alert → triage → comms → fix →
   postmortem).
3. `docs/incidents/_template.md` exists as the postmortem template
   (timeline, impact, root cause, action items, owner of each).
4. Cross-consistency vitest at `tests/ops/alerting-docs.test.ts` asserts:
   (a) the alerting doc exists and contains all three severity tiers;
   (b) every source-of-alerts mentioned in the ADR appears in the doc;
   (c) the postmortem template contains the required sections.
5. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.

## Out of scope

- Sentry alert-rule configuration (owner work in Sentry dashboard)
- Twilio paging integration (deferred to ADR-0025 SMS slice + A2P
  registration)
- PagerDuty (declined for v1 per ADR-0015 ratification)
- Synthetic uptime check setup (UptimeRobot / Better Stack — owner work,
  external service)

## Touched-files inventory

- Create: `docs/ops/alerting.md`
- Create: `docs/runbooks/runbook-incident-response.md`
- Create: `docs/incidents/_template.md`
- Create: `tests/ops/alerting-docs.test.ts`

## Open questions

None at planning time.
