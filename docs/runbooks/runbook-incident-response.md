# Runbook — Incident response (SEV1 / SEV2)

You have been paged. This runbook is the first thing to open. Drives ADR-0015.

## Step 0 — Acknowledge

- Reply to the page (SMS / Slack / call) within 15 minutes for SEV1, 4 business hours for SEV2.
- Acknowledging does not mean fixing — it means "I am the responder for this incident."

## Step 1 — Triage (5 minutes)

Decide the severity and confirm the scope. Don't rush to a fix; confirm what's actually broken first.

- Open the alert source (Sentry / Vercel / Supabase / Stripe).
- Read the alert payload. What's the affected route, region, customer cohort?
- Cross-check the synthetic uptime monitor. Is the homepage actually 500-ing, or is the alert noisy?
- If the alert is noisy or duplicate, downgrade and document; close the page.

## Step 2 — Communicate

For SEV1, communicate before fixing:

- Post a message in `#alerts` (Slack): "SEV1 confirmed: <one-line summary>. Investigating. Next update in 15 minutes."
- If member-facing, update the public status page with a brief acknowledgement (no speculation about cause).

Set a 15-minute repeating timer. Even if you have nothing new, post "still investigating" at each tick. Silent debugging during a SEV1 erodes trust.

## Step 3 — Diagnose

- What was the most recent deploy? Roll back is the cheapest first move when deploy time correlates with alert time.
  - `vercel rollback <deployment-id>` (Vercel dashboard) — reverts the production alias to the prior deployment in ~10 seconds.
- If the alert is a database issue, check Supabase dashboard for CPU / connection saturation. Connection-pool exhaustion is the most common DB SEV1; restart the function pool by triggering a new deploy.
- If the alert is a Stripe webhook issue, check the Stripe dashboard's webhook attempts panel. Failed-signature errors usually mean a secret rotation desync.

## Step 4 — Fix or mitigate

- **Fix** when the root cause is clear and small (config tweak, env var fix, single-line revert).
- **Mitigate** otherwise — toggle the relevant kill-switch flag (per ADR-0020), put up a maintenance banner, narrow the impact. Then schedule the real fix.

Mitigations always carry a follow-up issue with an owner and a deadline.

## Step 5 — Resolve

- Confirm the alert source is green again.
- Post a final message to `#alerts`: "Resolved at <time>. Cause: <one-liner>. Postmortem to follow."
- Update the status page if you posted there.

## Step 6 — Postmortem

Within 48 hours of resolution, file `docs/incidents/YYYY-MM-DD-<slug>.md` from the [`_template.md`](../incidents/_template.md). The postmortem is blameless: focus on the system. Action items must have a named owner and a deadline.

## Quick reference

| Symptom                          | First check                                    | Cheapest mitigation                |
| -------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Homepage 500                     | Recent deploy?                                 | Vercel rollback                    |
| Stripe webhooks failing          | Signature mismatch on recent secret rotation?  | Toggle `kill-stripe-webhook` flag  |
| Database unreachable             | Supabase status page; connection pool          | Trigger new deploy to recycle pool |
| Sentry error spike on one route  | Recent deploy?                                 | Vercel rollback                    |
| Suspected PII leak               | Stop. Open `runbook-suspected-pii-leak.md`     | Don't log into the leaked surface  |

## References

- [ADR-0015 — Alerting & incident response](../adr/0015-alerting-and-incident-response.md)
- [`docs/ops/alerting.md`](../ops/alerting.md) — severity ladder + channels.
- [`docs/incidents/_template.md`](../incidents/_template.md) — postmortem template.
