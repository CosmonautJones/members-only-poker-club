# Production ownership and launch hygiene

Audit snapshot: 2026-07-30. This note records non-secret facts visible from the
repository, GitHub, Vercel, live HTTP responses, and the authenticated Supabase
CLI. It does not grant or change access.

## Confirmed

- The application declares `https://membersonlypokersocial.com` as its
  canonical production URL in `app/layout.tsx`, `app/robots.ts`, and
  `app/sitemap.ts`. The apex domain is attached to the Vercel project and
  returns `200`.
- Vercel also has `www.membersonlypokersocial.com`, the public
  `members-only-poker-club.vercel.app` alias, and team-scoped deployment
  aliases attached. The team-scoped aliases require Vercel authentication.
- The Vercel project is `members-only-poker-club` under the team named
  `cosmonautjones' projects`. The available account can list the project,
  domains, and deployments. The visible production deployments are created by
  the `cosmonautjones` account.
- GitHub reports `CosmonautJones/members-only-poker-club` as public. Secret
  scanning and push protection are enabled, but Dependabot security updates are
  disabled.
- The authenticated Supabase CLI can see `members-only-poker-club-prod` in
  `CosmonautJones's Org`. The checkout is not linked to a cloud project, and
  the CLI reported that production-named project as inactive at audit time.
- No launch-grade SVG, AI, EPS, or vector PDF master is present. The repository
  contains `_design/project/assets/chip-logo.png` and dynamically generated
  raster icons. A vector master is explicitly deferred for the web launch and
  remains required before print or signage production.

## Owner-only gates

- [ ] Confirm `membersonlypokersocial.com` as the primary domain and choose the
      redirect hostname. At audit time, both `www.membersonlypokersocial.com`
      and `members-only-poker-club.vercel.app` return `200` instead of
      redirecting to the apex, so no canonical host redirect is enforced.
- [ ] After that decision, configure the selected redirects and verify one
      permanent hop to the primary HTTPS URL. Update the stale domain entries
      in `docs/spec.md` after the owner confirms the decision.
- [ ] Change the repository to private, as already required by `docs/spec.md`,
      or explicitly accept the risk of keeping auth and payment implementation
      public. Recheck the Vercel Git connection after any visibility change.
- [ ] Name the primary and backup administrators for GitHub and the Vercel
      team. Current tool access proves operability, not the complete owner or
      recovery roster.
- [ ] Confirm that `members-only-poker-club-prod` is the database used by the
      production deployment, restore or upgrade it from inactive status, and
      name primary and backup Supabase organization administrators. Link local
      CLI state only when an operator intentionally needs migration access.
- [ ] Supply or approve a launch-grade vector logo before print/signage work;
      the web launch may continue under the documented raster-only deferral.

## Acceptance status

- Primary and redirect domains: **partial** — the code declares an apex primary,
  but the owner decision and redirect configuration remain open.
- Repository visibility: **not satisfied** — it remains public contrary to the
  existing pre-sensitive-code plan.
- Deployment and database owners: **partial** — platform/team context is
  documented, but named primary and backup owners are not visible.
- Vector assets: **satisfied by explicit deferral** for the web launch.
