# ADR-0015: Alerting & incident response

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 4

## Context

Some failures are silent until a user complains. Some failures should page someone at 3am. Most are in between. We need a severity ladder, on-call rotation (even if it's just one person), and runbooks.

## Decision

To be drafted in Slice 4. Direction:

### Severity ladder

- **SEV1** (page immediately, any time): production down (homepage 500), Stripe webhooks failing for >5min, database unreachable, security incident in progress.
- **SEV2** (notify within business hours): elevated error rate, payment failures spike, single function 500ing, Sentry p95 >2× baseline.
- **SEV3** (review at next standup): non-critical bugs, user-reported issues, design polish.

### Channels

- **Page** (SEV1): SMS + phone call to on-call via PagerDuty (or Vercel's incident webhooks → Twilio for v1).
- **Notify** (SEV2): Slack channel + email.
- **Log** (SEV3): GitHub issue auto-created from Sentry.

### Sources of alerts

- Sentry: error rate spike, slow transaction, new error fingerprint
- Vercel: deploy failure, function timeout
- Supabase: DB CPU >80%, connection pool exhaustion
- Stripe: webhook delivery failure
- Synthetic uptime check (UptimeRobot or Better Stack) hitting `/api/health` every minute

### Runbooks

`docs/runbooks/` (Slice 4):

- `runbook-stripe-webhook-down.md`
- `runbook-database-down.md`
- `runbook-suspected-pii-leak.md`
- `runbook-rotate-secrets.md`
- `runbook-restore-from-backup.md`
- `runbook-payment-dispute.md`
- `runbook-refund-flow.md`

Each runbook: When does this fire? What's the user impact? First 5 things to check. Who to escalate to.

### On-call

For v1, the owner + the developer share on-call. Pair-level redundancy via owner's secondary number.

### Post-incident

Every SEV1/2 gets a written postmortem in `docs/incidents/YYYY-MM-DD-slug.md`. Blameless. Action items tracked.

## Open questions

- PagerDuty cost vs hand-rolled Twilio paging (decide in Slice 4)
- SLOs / error budgets (probably defer to multi-developer phase)
