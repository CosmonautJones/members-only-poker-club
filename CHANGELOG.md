# Changelog

All notable changes to the Members Only Poker Social Club app are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-21

First versioned release. It covers everything merged to `main` up to
2026-07-31 ([#1](https://github.com/CosmonautJones/members-only-poker-club/pull/1) through [#58](https://github.com/CosmonautJones/members-only-poker-club/pull/58), plus the initial scaffold and the
direct-to-main fixes). `package.json` already said `0.1.0`, so this release
tags the current state.

### Added
- Project foundation: the spec, design system, route map and ADRs; a Next.js 14,
  Tailwind, Supabase and Vitest scaffold; and the batch-ratified ADRs
  ([#9](https://github.com/CosmonautJones/members-only-poker-club/pull/9), [#10](https://github.com/CosmonautJones/members-only-poker-club/pull/10)).
- Marketing site: the HomeScreen port with mobile fixes ([#1](https://github.com/CosmonautJones/members-only-poker-club/pull/1), [#3](https://github.com/CosmonautJones/members-only-poker-club/pull/3), [#4](https://github.com/CosmonautJones/members-only-poker-club/pull/4)), SEO
  ([#5](https://github.com/CosmonautJones/members-only-poker-club/pull/5)), cookie and consent banner ([#7](https://github.com/CosmonautJones/members-only-poker-club/pull/7)), an accessibility statement and
  axe checks ([#15](https://github.com/CosmonautJones/members-only-poker-club/pull/15)), and the 2026-05-15 site audit (content, mobile nav,
  favicon) with owner corrections.
- Auth and members: signup, login and a gated member layout ([#29](https://github.com/CosmonautJones/members-only-poker-club/pull/29)),
  profiles, a role enum and RLS ([#26](https://github.com/CosmonautJones/members-only-poker-club/pull/26)), and the portal dashboard v2 with
  client-side navigation and /profile.
- Admin and payments: the Admin Operations Console ([#33](https://github.com/CosmonautJones/members-only-poker-club/pull/33)), a payment
  management console with a refund route ([#34](https://github.com/CosmonautJones/members-only-poker-club/pull/34), [#35](https://github.com/CosmonautJones/members-only-poker-club/pull/35), [#36](https://github.com/CosmonautJones/members-only-poker-club/pull/36)), and the Luna
  execution board ([#49](https://github.com/CosmonautJones/members-only-poker-club/pull/49), [#58](https://github.com/CosmonautJones/members-only-poker-club/pull/58)).
- Tournaments: an admin-edited schedule on /games with a nightly cron
  materializer ([#45](https://github.com/CosmonautJones/members-only-poker-club/pull/45), [#47](https://github.com/CosmonautJones/members-only-poker-club/pull/47), [#51](https://github.com/CosmonautJones/members-only-poker-club/pull/51)).
- Platform: an audit_log with `withAudit` ([#27](https://github.com/CosmonautJones/members-only-poker-club/pull/27)), feature flags
  ([#12](https://github.com/CosmonautJones/members-only-poker-club/pull/12)), a typed, consent-gated analytics API ([#13](https://github.com/CosmonautJones/members-only-poker-club/pull/13)), an A/B testing
  harness ([#14](https://github.com/CosmonautJones/members-only-poker-club/pull/14)), Sentry with a structured logger and PII redaction
  ([#17](https://github.com/CosmonautJones/members-only-poker-club/pull/17)), alerting and incident-response docs ([#16](https://github.com/CosmonautJones/members-only-poker-club/pull/16)), rate limiting
  wired into the root middleware ([#18](https://github.com/CosmonautJones/members-only-poker-club/pull/18), [#46](https://github.com/CosmonautJones/members-only-poker-club/pull/46)), UTC storage with club-local
  display ([#30](https://github.com/CosmonautJones/members-only-poker-club/pull/30)), privacy/GDPR scaffolding ([#31](https://github.com/CosmonautJones/members-only-poker-club/pull/31)), and a migration
  safety scanner ([#11](https://github.com/CosmonautJones/members-only-poker-club/pull/11)).
- Database: a Postgres transaction runner and adapter ([#50](https://github.com/CosmonautJones/members-only-poker-club/pull/50), [#53](https://github.com/CosmonautJones/members-only-poker-club/pull/53)), atomic
  audited admin mutations ([#55](https://github.com/CosmonautJones/members-only-poker-club/pull/55)), atomic privacy and tournament audits
  ([#56](https://github.com/CosmonautJones/members-only-poker-club/pull/56)), and the LUNA-009 rollback gauntlet ([#57](https://github.com/CosmonautJones/members-only-poker-club/pull/57)).
- CI/CD ([#8](https://github.com/CosmonautJones/members-only-poker-club/pull/8), [#19](https://github.com/CosmonautJones/members-only-poker-club/pull/19)) and the conductor/run orchestration tooling
  ([#2](https://github.com/CosmonautJones/members-only-poker-club/pull/2), [#6](https://github.com/CosmonautJones/members-only-poker-club/pull/6), [#20](https://github.com/CosmonautJones/members-only-poker-club/pull/20), [#23](https://github.com/CosmonautJones/members-only-poker-club/pull/23), [#37](https://github.com/CosmonautJones/members-only-poker-club/pull/37), [#38](https://github.com/CosmonautJones/members-only-poker-club/pull/38), [#39](https://github.com/CosmonautJones/members-only-poker-club/pull/39), [#41](https://github.com/CosmonautJones/members-only-poker-club/pull/41), [#42](https://github.com/CosmonautJones/members-only-poker-club/pull/42), [#43](https://github.com/CosmonautJones/members-only-poker-club/pull/43)).

### Fixed
- /api/privacy/delete now actually anonymizes the data ([#32](https://github.com/CosmonautJones/members-only-poker-club/pull/32)).
- The middleware has a 3 s timeout on `supabase.auth.getUser`, which prevents
  504 invocation timeouts ([#48](https://github.com/CosmonautJones/members-only-poker-club/pull/48)).
- Auth now revalidates before redirecting, the signup date input is readable,
  and the app falls back cleanly when Supabase env vars are missing.

### Documentation
- Owner briefs ([#24](https://github.com/CosmonautJones/members-only-poker-club/pull/24), [#25](https://github.com/CosmonautJones/members-only-poker-club/pull/25)), the parked membership agreement ([#22](https://github.com/CosmonautJones/members-only-poker-club/pull/22)), the
  deployment-hygiene checklist ([#40](https://github.com/CosmonautJones/members-only-poker-club/pull/40)), docs-currency rules ([#44](https://github.com/CosmonautJones/members-only-poker-club/pull/44)), and
  production ownership gates ([#54](https://github.com/CosmonautJones/members-only-poker-club/pull/54)).

[Unreleased]: https://github.com/CosmonautJones/members-only-poker-club/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CosmonautJones/members-only-poker-club/releases/tag/v0.1.0
