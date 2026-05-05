# ADR-0001: Tech stack & deployment

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1
- **Supersedes:** —
- **Superseded by:** —

## Context

A new web app for a Texas private poker club needs to ship a marketing site, a member portal (signup, billing, time-bank, tournaments), a cashier console, and an admin in roughly 12–16 weeks. The team is small (effectively 1–2 developers). Production-readiness expectations are non-trivial: real money flows through Stripe, real PII (ID documents, DOB) flows through the database, and SMS/email require regulatory compliance.

The chosen stack must minimize ops overhead, support preview environments per PR, give us Postgres with RLS for tenant-style isolation between members, and integrate cleanly with Stripe and the existing visual identity (gold/ink/ivory, Cormorant Garamond + Inter).

## Decision

**Single Next.js 14 (App Router) application** in TypeScript, deployed to **Vercel**, talking to **Supabase** (Postgres + Auth + Storage) and **Stripe** for payments.

UI built with **Tailwind CSS** + **shadcn/ui**. Client-side data with **TanStack Query**. Server-side data fetching with React Server Components and Supabase server clients.

Auxiliary services:
- **Resend** — transactional email
- **Twilio** — SMS (with A2P 10DLC registration)
- **Sentry** — error monitoring
- **PostHog** — product analytics + feature flags

No microservices. No separate API server. No separate marketing CMS — content lives in MDX or a `content_blocks` table editable from admin.

## Consequences

**Positive:**

- One deployment surface. One source repo. One auth session shared across marketing → portal → admin.
- Vercel preview deploys per PR give us free staging environments and a built-in review URL.
- Supabase RLS replaces hand-rolled authorization in 90% of cases. The other 10% (cross-tenant admin reads, audit log) we handle in server actions with the service-role key.
- Stripe + Resend + Twilio are all well-documented industry standards. No exotic vendor risk.
- shadcn/ui gives us copy-pasted, owned components — we don't take a runtime library dependency that could be deprecated.

**Negative:**

- Vendor concentration: Vercel + Supabase + Stripe = three SaaS dependencies that could each have outages, price changes, or policy shifts. ADR-031 addresses this.
- Vercel Edge functions have a cold-start latency cost on regional Postgres. We'll measure in Slice 4 and consider Edge Runtime vs Node Runtime per route.
- Next.js App Router still has rough edges (caching, server actions). We accept the churn risk because the alternative (Pages Router, or a separate Express API) is more code for less benefit.
- Supabase free tier auto-pauses after 7 days of inactivity. We'll move to the paid tier before any production traffic.

## Alternatives considered

- **Next.js + Clerk + Neon Postgres + Stripe.** Clerk has stronger organization/RBAC primitives than Supabase Auth, but at $25/mo + $0.02/MAU after the free tier. Neon is excellent but adds a vendor. Net: more flexibility, more ops, more cost. Rejected for project-size fit.
- **Python (FastAPI) backend + Next.js frontend.** Matches the team's existing Python comfort but doubles deploy targets and slows iteration. Rejected — the backend logic here is not Python-specific.
- **Remix + Postgres + Stripe.** Remix has nice mutations and progressive enhancement, but the ecosystem is smaller, the Cloudflare-Workers-first deploy story is awkward for our use, and the design handoff is structured around React-isn't-Remix-specific patterns. Rejected as a marginal preference call.
- **Static site (Astro) for marketing + separate dashboard app.** Cleaner separation but doubles the auth/session work. Rejected — the cohesion of one app outweighs the static-site perf win for a marketing site that's already going to score high.
