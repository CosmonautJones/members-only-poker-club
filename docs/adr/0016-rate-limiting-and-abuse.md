# ADR-0016: Rate limiting & abuse

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1 (basic on contact form + login) → 4 (full)

## Context

Public endpoints need throttling. Without rate limits: contact form gets spammed, login endpoint gets credential-stuffed, signup gets abused for ID-doc-storage exhaustion, cashier console double-fires.

## Decision

To be drafted in Slice 4. Direction:

- **Vercel Edge Middleware** runs first on every request, applies per-IP and per-user buckets via Upstash Redis (free tier sufficient initially).
- **Buckets:**
  - Anonymous: 60 req/min per IP across all routes
  - Login: 5 attempts per 15min per IP, lockout after 10 failures
  - Signup: 3 starts per hour per IP (no need for more honest signups)
  - Contact form: 3 per hour per IP
  - Authenticated member: 600 req/min (generous; legit usage shouldn't hit it)
  - Authenticated staff: 1200 req/min (cashier flows are bursty)
  - Webhook endpoints (`/api/webhooks/*`): no rate limit, signature is the gate
- **Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` returned per RFC.
- **Response:** 429 with retry-after, structured JSON `{ error: 'rate_limited', retry_after_seconds: N }`.
- **Bot detection:** Cloudflare Turnstile (not reCAPTCHA — privacy posture) on signup and contact forms.
- **Anti-abuse for ID upload:** max 5 uploads per user account, must be within signup flow, file scanned for known malware via Supabase Storage's built-in scanner.

## Open questions

- Upstash Redis cost at scale (probably negligible)
- Whether to enable Vercel's bot protection (paid feature) on top
- Whether Turnstile is enough or we need an honeypot field too
