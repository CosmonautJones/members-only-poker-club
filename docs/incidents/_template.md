# Incident — <slug>

- **Severity:** SEV1 | SEV2
- **Date:** YYYY-MM-DD
- **Duration:** <minutes from first impact to resolution>
- **On-call:** <name>
- **Postmortem owner:** <name>

## Summary

One paragraph. What happened, when, who was affected, what the resolution was. No speculation.

## Timeline

All times in CT.

| Time  | Event                                                                |
| ----- | -------------------------------------------------------------------- |
| HH:MM | First alert fires (source: Sentry / Vercel / Supabase / Stripe)      |
| HH:MM | On-call acknowledges                                                 |
| HH:MM | <key diagnostic step>                                                 |
| HH:MM | Root cause identified                                                 |
| HH:MM | Mitigation applied (link to commit / config change / flag toggle)    |
| HH:MM | Alert clears, monitoring confirms                                     |
| HH:MM | Status page updated to resolved                                       |

## Impact

- **Affected surface:** <route(s) / function(s) / member cohort>
- **Members impacted:** <count or "all" / "none observed">
- **Money at risk:** <yes/no — if yes, link to the audit-log query that confirms the count of affected transactions>
- **Compliance impact:** <PII exposure? — if yes, this becomes a privacy incident, see ADR-0023>

## Root cause

What actually went wrong. Be specific. "Stripe webhooks failed" is not a root cause — "the STRIPE_WEBHOOK_SIGNING_SECRET was rotated in the dashboard but the Vercel env var was not updated, so signature verification failed for 7 minutes" is a root cause.

## What worked

What in the response went well? (We learn from successes too — keep doing these.)

## What didn't

What slowed us down? Missing alert? Missing runbook? Misleading dashboard? Bad rollback path?

## Action items

| #   | Owner | Action                                                  | Due        |
| --- | ----- | ------------------------------------------------------- | ---------- |
| 1   | <name> | <specific, verifiable change>                          | YYYY-MM-DD |
| 2   | <name> | ...                                                     | YYYY-MM-DD |

Track each item to closure in the issue tracker. Action items are not optional and not aspirational — if it's not assigned to a name and a date, it's not an action item.

## Lessons (one paragraph)

What's the durable takeaway for the next on-call? This is what gets pasted into the on-call handbook or `docs/kb/` if it's broadly applicable.

## References

- Original alert(s): <links>
- Vercel deployment(s): <links>
- Sentry issue(s): <links>
- Stripe events / webhook attempts (if relevant): <links>
- Mitigation commit / PR: <link>
