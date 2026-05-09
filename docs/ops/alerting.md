# Alerting & incident response

Operational runbook anchor for alert handling. See [ADR-0015](../adr/0015-alerting-and-incident-response.md) for the underlying decision document.

This file is the source of truth for "what fires what, who handles it, and how fast."

## Severity ladder

### SEV1 — page immediately

Fires anytime, including 3am. Person paged is expected to acknowledge within 15 minutes and start triage within 30.

Triggers:

- Production homepage returns 500 (Vercel synthetic check).
- Stripe webhook delivery failing for >5 min (Stripe dashboard alert).
- Database unreachable (Supabase health probe).
- Security incident in progress (suspected PII leak, credential compromise).

### SEV2 — notify within business hours

Acknowledged within 4 business hours; resolved or downgraded within one business day.

Triggers:

- Elevated error rate on a single function (Sentry threshold rule).
- Payment failure spike (Stripe dashboard).
- Sentry p95 latency >2× baseline for 10 minutes.
- Vercel deploy failure on `main`.
- Supabase DB CPU sustained >80% for 30 minutes, OR connection pool exhaustion.

### SEV3 — review at next standup

No paging, no notifications outside the issue tracker. Reviewed at the next standup or async catch-up.

Triggers:

- New error fingerprint with low frequency (Sentry).
- User-reported bugs filed via support email.
- Design polish, content typos, copy adjustments.

## Channels

| Severity | Channel                                                                                   |
| -------- | ----------------------------------------------------------------------------------------- |
| SEV1     | SMS + voice call to on-call (Twilio when ADR-0025 ships; manual phone-tree until then)    |
| SEV2     | Slack channel `#alerts` + email to on-call                                                |
| SEV3     | GitHub issue auto-created from Sentry; reviewed in standup                                |

For v1, the owner + the developer share on-call. Pair-level redundancy via the owner's secondary phone number. PagerDuty is declined (per ADR-0015 ratification); Twilio paging via the existing ADR-0025 SMS infrastructure is the long-term plan.

## Sources of alerts

| Source                | What it watches                                              | Severity ranges |
| --------------------- | ------------------------------------------------------------ | --------------- |
| Sentry                | Error rate spikes, slow transactions, new error fingerprints | SEV1–SEV3       |
| Vercel                | Deploy failures, function timeouts, build errors             | SEV1–SEV2       |
| Supabase              | DB CPU, connection-pool saturation, replication lag          | SEV1–SEV2       |
| Stripe                | Webhook delivery failure, dispute spike, payout problems     | SEV1–SEV2       |
| Synthetic uptime      | UptimeRobot or Better Stack hitting `/api/health` every 60s | SEV1            |

## On-call schedule

For v1 (single-developer phase): the developer is primary on-call 09:00–21:00 CT, the owner is secondary outside those hours. Both keep their phones reachable; SEV1 escalation rings the secondary if primary doesn't acknowledge in 10 minutes.

Re-evaluate when the team grows beyond one developer.

## Post-incident

Every SEV1 and SEV2 incident gets a written postmortem, owned by whoever was on-call:

1. File a copy of [`docs/incidents/_template.md`](../incidents/_template.md) at `docs/incidents/YYYY-MM-DD-<slug>.md`.
2. Fill in the timeline, impact, root cause, and action items within 48 hours of resolution.
3. Track each action item to closure; never leave them as bare bullets.

Postmortems are blameless. The goal is the system, not the person.

## Verifying

Programmatic check (no UI):

```bash
gh api repos/CosmonautJones/members-only-poker-club/actions
```

Manual cross-check:

- Sentry dashboard `https://sentry.io/organizations/<org>/alerts/rules/` should match the SEV1/SEV2 rules above.
- Vercel project notifications should include the deploy-failure rule.
- Stripe webhook endpoint failure-rate alert configured in the Stripe dashboard.

## References

- [ADR-0015 — Alerting & incident response](../adr/0015-alerting-and-incident-response.md)
- [ADR-0014 — Observability](../adr/0014-observability.md) — what we collect that the alerts trigger off of.
- [`runbook-incident-response.md`](../runbooks/runbook-incident-response.md) — the first-response procedure when an alert fires.
- [`_template.md`](../incidents/_template.md) — postmortem template.
