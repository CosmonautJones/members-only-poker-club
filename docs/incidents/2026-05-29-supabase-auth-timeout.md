# Incident — Supabase auth middleware timeout

- **Severity:** SEV2
- **Date:** 2026-05-29
- **Status:** Resolved; provisional guard retained
- **Owner:** Developer on-call

## Summary

Supabase authentication did not answer within the middleware execution window, causing
`MIDDLEWARE_INVOCATION_TIMEOUT` responses on routes covered by the root middleware. A
three-second guard now degrades an unanswered auth check to an anonymous request so public
pages can continue to render and gated routes can redirect to login.

The 2026-07-30 closeout check found production healthy. The original upstream cause is not
proven: the retained evidence does not establish whether Supabase was paused, degraded, or
unreachable for another reason. Treat those possibilities as hypotheses, not root cause.

## Current operating posture

- Keep `SUPABASE_AUTH_TIMEOUT_MS` at 3000 provisionally.
- Successful checks emit the PII-free structured event
  `{"event":"supabase_auth_ok","duration_ms":<number>}`.
- Timeout and error events remain available for correlation.
- Do not log user identifiers, tokens, cookies, request URLs, or query values while
  investigating auth latency.

## Follow-ups

| Owner                          | Action                                                                                                                                     | Gate / due                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Developer on-call              | On recurrence, capture the exact UTC window and review Supabase Auth and API logs for that window before changing the timeout or assigning cause. | Next recurrence; requires Supabase dashboard access.             |
| Club owner + developer on-call | Run a production smoke with the designated test member: sign in, open one gated route, sign out, and confirm `supabase_auth_ok` is present without PII. | Before closing LUNA-005; requires human-held test credentials.    |
| Developer on-call              | Review successful-auth latency after enough production samples exist; retain 3 seconds unless measured evidence supports a different budget. | After the first representative production observation window.    |

## Verification

For each authenticated smoke:

1. Record only the UTC start/end time and deployment identifier.
2. Confirm sign-in, a gated page, and sign-out succeed.
3. Search runtime logs for `supabase_auth_ok` within the recorded window.
4. Confirm `duration_ms` is numeric and the emitted object contains no additional fields.
5. If a timeout or error occurs, correlate the same UTC window in Supabase logs and attach
   redacted findings here or in the tracking ticket.

## References

- [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts)
- [Runbook — Incident response](../runbooks/runbook-incident-response.md)
- [ADR-0014 — Observability](../adr/0014-observability.md)
