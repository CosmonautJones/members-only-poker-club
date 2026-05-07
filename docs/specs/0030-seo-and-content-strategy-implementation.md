---
adr: 0030
slice: 1
risk: medium
---

# Spec: SEO & content strategy — Slice 1 implementation

- **ADR:** [0030](../adr/0030-seo-and-content-strategy.md)
- **Status:** Draft (v2 — addresses critic iter1 concerns)
- **Date:** 2026-05-05

## Goal

Ship the on-site technical-SEO surface (metadata, OG, sitemap, robots, JSON-LD, FAQ page, and a Lighthouse perf budget) for every Slice-1 marketing route so the public site is crawlable, share-friendly, and rich-result eligible on first byte. This v2 also lands the test infrastructure (Playwright config, e2e directory, Lighthouse driver) and minimal route stubs that the SEO work attaches to, so the planner is not blocked on undeclared preconditions.

## Acceptance criteria

Numbered, testable. Each is verifiable by `pnpm test`, `pnpm test:e2e`, or a named acceptance command.

1. `app/(marketing)/layout.tsx` exports a `metadata` object with default `title.template`, `description`, `openGraph`, and `twitter` fields, and every page under `app/(marketing)/*` either inherits the default or exports its own `metadata` override; verifiable by a Playwright e2e crawl that asserts `<title>` and `<meta name="description">` are non-empty on `/`, `/club`, `/games`, `/membership`, `/contact`, `/faq`, `/privacy`, `/terms`, `/member-agreement` (`pnpm test:e2e seo-metadata`). T0 guarantees every route resolves (placeholder pages where real content has not landed) so the crawl has nine targets.
2. `app/og/route.tsx` returns a 1200x630 image (HTTP 200, `content-type: image/png`) for any `?title=...&subtitle=...` query, and at least one marketing page references it via its per-page `openGraph.images`; verifiable by a vitest test that fetches the route handler and a Playwright e2e check on the page's rendered `<meta property="og:image">` URL.
3. `app/sitemap.ts` returns a `MetadataRoute.Sitemap` enumerating, at minimum, every static marketing route in the route map for Slice 1 (`/`, `/club`, `/games`, `/membership`, `/contact`, `/faq`, `/privacy`, `/terms`, `/member-agreement`); verifiable by a vitest test that imports the default export and asserts each path is present with a valid `lastModified`.
4. `app/robots.ts` returns a `MetadataRoute.Robots` that allows `/` and disallows `/admin`, `/cashier`, `/dashboard`, and `/api`; verifiable by a vitest test asserting the `disallow` array contains those four prefixes and no Slice-1 marketing path.
5. The `/contact` page renders a JSON-LD `<script type="application/ld+json">` block whose parsed payload has `@context: "https://schema.org"`, `@type: "LocalBusiness"`, and an `address.streetAddress` value of exactly `"16525 North Fwy"` (the real venue address from `lib/content/nap.ts`), plus non-empty `name`, `telephone`, and `openingHoursSpecification` fields (telephone/hours may be TODO placeholders that the owner replaces during PR review); verifiable by a Playwright e2e test that parses the JSON-LD blob and asserts on the literal street-address string (`pnpm test:e2e seo-jsonld`).
6. The `/` page renders a JSON-LD block with `@type: "Organization"` containing `name`, `url`, `logo`, and `sameAs`; verifiable by the same Playwright suite.
7. `/games/[slug]` emits a JSON-LD `Event` block on the rendered HTML for any tournament slug, sourced from a typed fixture (`lib/tournaments/fixtures.ts`) shaped against the shared `Tournament` interface in `lib/tournaments/types.ts`; verifiable by a Playwright e2e test that visits at least one fixture slug and parses the JSON-LD `@type: "Event"` payload, plus a vitest test that asserts the fixture data satisfies the `Tournament` interface (typecheck-only).
8. A `/faq` route exists at `app/(marketing)/faq/page.tsx` with at least 6 question/answer pairs covering Slice-1 topics (membership, age, BYOB, time-bank intro, hours, location); verifiable by a Playwright e2e test that asserts the page renders and counts `<details>` (or equivalent) elements.
9. A vitest test asserts all raster images in `app/(marketing)/**` and `components/marketing/**` use `next/image` (rather than raw `<img>`); the test passes initially against the empty set (no images yet) and gates future regressions as photography lands. The test recursively walks the two directories, scans `.tsx`/`.jsx` files, and fails if any JSX `<img>` element is found that is not the `Image` component imported from `next/image`.
10. A Lighthouse run via `pnpm lighthouse` produces a performance score ≥90 for `/`, `/games`, `/contact`, and `/faq` against a local production build; verifiable by the `pnpm lighthouse` acceptance command, which fails the run with non-zero exit if any page scores below 90 on `categories.performance`.

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Sized at 2-8 hours each unless noted. **12 tasks total** (was 11 in v1; T0 added at front, T11.5 folded into T9).

- **T0 — Test infrastructure scaffolding (NEW, prerequisite for T1-T11).**
  - Create `playwright.config.ts` at repo root: `testDir: 'tests-e2e'`, `use: { baseURL: 'http://localhost:3000' }`, `webServer: { command: 'pnpm build && pnpm start', port: 3000, reuseExistingServer: !process.env.CI }`. Verify `@playwright/test@^1.49.0` is already in devDependencies (it is, per `package.json`).
  - Create `tests-e2e/` directory with one sanity test `tests-e2e/smoke.spec.ts` asserting `/` returns HTTP 200 and the page title is non-empty. Proves the harness works before any AC-driven e2e is written.
  - Add `lighthouse` and `chrome-launcher` to devDependencies. Implement `scripts/lighthouse.mjs`: spawn `pnpm build && pnpm start`, run Lighthouse against `/`, `/games`, `/contact`, `/faq`, exit non-zero if any page scores <90 on `categories.performance`, write JSON report to `lighthouse-report.json`. Add `"lighthouse": "node scripts/lighthouse.mjs"` to `package.json` scripts. The `test:e2e` script is already present; verify it runs after the config lands.
  - Create **minimal placeholder pages** for any Slice-1 marketing route that does not yet exist on this branch (`/club`, `/games`, `/games/[slug]`, `/membership`, `/contact`, `/faq`, `/privacy`, `/terms`, `/member-agreement`): bare `export default function Page() { return <main>{slug}</main> }` stubs so subsequent metadata tasks have files to attach `metadata` exports to. Full marketing copy is owned by the parent slice work (`slice-1/marketing-home-mvp`); T0 only ensures the routes resolve.
  - Optional `lighthouserc.json` if the driver script needs config; otherwise skip.
  - T0 commits as its own commit at Phase 5.
- **T1 — Marketing layout metadata defaults.** Add a `metadata` export to `app/(marketing)/layout.tsx` with title template, description, OG, and Twitter card defaults. Root `app/layout.tsx` already sets `metadataBase`; do not duplicate.
- **T2 — Per-page metadata overrides.** Add a `metadata` export (or `generateMetadata`) to each Slice-1 marketing page that needs a distinct title or description: `/club`, `/games`, `/membership`, `/contact`, `/faq`, `/privacy`, `/terms`, `/member-agreement`. The home page (`/`) inherits defaults. T0 has already created any missing route stubs, so T2 only attaches metadata.
- **T3 — Dynamic OG image route.** Implement `app/og/route.tsx` using `next/og` `ImageResponse`, rendering a branded 1200x630 image driven by `?title` and `?subtitle` query params. Wire at least the home page's `openGraph.images` to it.
- **T4 — Sitemap.** Implement `app/sitemap.ts` enumerating Slice-1 marketing routes. Tournament pages enumerate the fixture slugs from `lib/tournaments/fixtures.ts` for now; the listing swaps to the real data source when ADR-0012 ratifies.
- **T5 — Robots.** Implement `app/robots.ts` with the allow/disallow rules from acceptance criterion 4.
- **T6 — LocalBusiness JSON-LD on `/contact` (+ NAP source-of-truth module).** Add a small `<JsonLd>` server component (e.g. `components/seo/json-ld.tsx`) and emit a `LocalBusiness` payload on `/contact`. Create `lib/content/nap.ts` with the exact shape below — real address (owner-supplied: `16525 North Fwy, Houston, TX 77090, US`), placeholder phone/hours that are TODO-flagged for the owner to replace during PR review.

  ```typescript
  export const NAP = {
    name: "Members Only Social Club",
    address: {
      streetAddress: "16525 North Fwy",
      addressLocality: "Houston",
      addressRegion: "TX",
      postalCode: "77090",
      addressCountry: "US",
    },
    // TODO(travis): replace placeholder before merge
    telephone: "+1-000-000-0000",
    // TODO(travis): replace placeholder before merge
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "00:00", closes: "00:00" },
    ],
  } as const;
  ```

  The footer (`components/marketing/public-footer.tsx`) reads NAP from the same module so the address is single-sourced.
- **T7 — Organization JSON-LD on `/`.** Reuse the `<JsonLd>` component to emit an `Organization` payload on the home page (name, url, logo, sameAs).
- **T8 — Event JSON-LD on `/games/[slug]` (with typed fixture).** Create `lib/tournaments/types.ts` exporting a shared `interface Tournament { slug: string; name: string; startsAt: string; buyInCents: number; capacity: number; venueName: string; venueAddress: string; }`. Create `lib/tournaments/fixtures.ts` exporting an array of 1-2 placeholder tournaments typed as `Tournament[]`, with a `// TODO(adr-0012): replace with real data source when ADR-0012 ratifies` marker. Implement `<EventJsonLd>` accepting a `Tournament` prop and emitting the JSON-LD `Event` payload. The page at `app/(marketing)/games/[slug]/page.tsx` (created as a stub by T0) renders `<EventJsonLd>` with the matched fixture. AC7 e2e hits `/games/<fixture-slug>` and validates the JSON-LD blob; the typed fixture means an ADR-0012 schema swap surfaces at typecheck rather than silently breaking.
- **T9 — `/faq` page + route-map update.** New route at `app/(marketing)/faq/page.tsx` with the Slice-1 question set (≥6 Q/A pairs covering membership, age, BYOB, time-bank intro, hours, location). Use a styled `<details>` accordion or shadcn `Accordion`. Slice-4 expansion is explicitly out of scope. Also: update `docs/route-map.md` Slice-1 row to include `/faq` (folded in here since it's the same logical change — adding `/faq` to the slice's surface area).
- **T10 — `next/image` regression test.** Implement `tests/seo/next-image-usage.test.ts` that recursively walks `app/(marketing)/**` and `components/marketing/**`, scans `.tsx`/`.jsx` files (string-scan or AST), and asserts every JSX `<img>` element is the `Image` component from `next/image` (no raw `<img>` tags). The test passes today against zero images and gates regressions as photography lands. Real image swaps are owner-content-dependent and explicitly out of scope.
- **T11 — Lighthouse perf budget + CI gate.** The `pnpm lighthouse` driver landed in T0; T11 ensures the budget is enforced. CI wiring is conditional on ADR-0017 ratification status at the time of Phase 5: if 0017 has ratified, T11 adds a Lighthouse step to the GitHub Actions workflow; otherwise the gate is the manual `pnpm lighthouse` acceptance command (acceptance criterion 10 holds either way).
- **T12 — Update `docs/route-map.md` to include `/faq` in Slice-1 row.** Doc-only edit; folded with T9 above (T9 owns this change). T12 is listed here as a checkpoint in the count but ships as part of T9's commit. (If the planner prefers, T12 can stand alone — the work is the same single edit.)

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create**
  - **T0 (test infra + route stubs):**
    - `playwright.config.ts`
    - `tests-e2e/smoke.spec.ts`
    - `scripts/lighthouse.mjs`
    - `lighthouserc.json` (optional, only if the driver script needs config)
    - `app/(marketing)/club/page.tsx` (stub — full content owned by parent slice)
    - `app/(marketing)/games/page.tsx` (stub)
    - `app/(marketing)/games/[slug]/page.tsx` (stub — T8 attaches JSON-LD)
    - `app/(marketing)/membership/page.tsx` (stub)
    - `app/(marketing)/contact/page.tsx` (stub — T6 attaches JSON-LD + NAP)
    - `app/(marketing)/privacy/page.tsx` (stub)
    - `app/(marketing)/terms/page.tsx` (stub)
    - `app/(marketing)/member-agreement/page.tsx` (stub)
  - **T3-T9 (SEO surfaces):**
    - `app/og/route.tsx`
    - `app/sitemap.ts`
    - `app/robots.ts`
    - `app/(marketing)/faq/page.tsx`
    - `components/seo/json-ld.tsx`
    - `components/seo/local-business-jsonld.tsx` (or co-located in the contact page)
    - `components/seo/organization-jsonld.tsx`
    - `components/seo/event-jsonld.tsx`
    - `lib/content/nap.ts` (single source of truth for hours/address/phone, real address + TODO placeholders for phone/hours)
    - `lib/tournaments/types.ts` (shared `Tournament` interface)
    - `lib/tournaments/fixtures.ts` (typed fixture data, marked TODO for ADR-0012 swap)
  - **Tests:**
    - `tests/seo/sitemap.test.ts`
    - `tests/seo/robots.test.ts`
    - `tests/seo/og-route.test.ts`
    - `tests/seo/next-image-usage.test.ts`
    - `tests/seo/tournament-fixture.test.ts` (typecheck assertion that fixture satisfies `Tournament[]`)
    - `tests-e2e/seo-metadata.spec.ts`
    - `tests-e2e/seo-jsonld.spec.ts`
    - `tests-e2e/seo-event-jsonld.spec.ts`
- **Modify**
  - `app/(marketing)/layout.tsx` — add `metadata` export (T1)
  - `app/(marketing)/page.tsx` — embed `<OrganizationJsonLd>` and reference OG route (T7)
  - `app/(marketing)/club/page.tsx` — `metadata` override (stub created by T0)
  - `app/(marketing)/games/page.tsx` — `metadata` override (stub created by T0)
  - `app/(marketing)/membership/page.tsx` — `metadata` override (stub created by T0)
  - `app/(marketing)/contact/page.tsx` — `metadata` + `<LocalBusinessJsonLd>` (stub created by T0)
  - `app/(marketing)/games/[slug]/page.tsx` — `<EventJsonLd>` + fixture lookup (stub created by T0)
  - `app/(marketing)/privacy/page.tsx` — `metadata` override
  - `app/(marketing)/terms/page.tsx` — `metadata` override
  - `app/(marketing)/member-agreement/page.tsx` — `metadata` override
  - `components/marketing/public-footer.tsx` — read NAP from `lib/content/nap.ts`
  - `package.json` — add `lighthouse` script + `lighthouse` and `chrome-launcher` devDeps (T0)
  - `docs/route-map.md` — add `/faq` to the Slice-1 row (T9/T12)
  - `.github/workflows/*.yml` — add Lighthouse step (T11, only if ADR-0017 has ratified; otherwise no workflow edit)

## Risk flags

None of the auto-flag ADRs ({0003, 0004, 0005, 0006, 0009, 0023}) are linked from this slice. Sub-task risks called out individually:

- **T0 (Test infrastructure scaffolding) — risk: low.** Adds Playwright config, e2e directory, Lighthouse driver, and route stubs. Low risk because each component is isolated and the smoke test verifies the harness works end-to-end before any AC-driven test depends on it. Failure mode is "the scaffolds don't run," which is caught at T0 time, not later.
- **T8 (Event JSON-LD) — risk: medium.** Couples marketing rendering to ADR-0012's tournament data model. ADR-0012 is currently Stub. Mitigation: ship behind a typed fixture (`lib/tournaments/types.ts` + `lib/tournaments/fixtures.ts`) so the JSON-LD shape is locked and tested now, and the eventual ADR-0012 swap is typecheck-visible. If 0012 ratifies with a different `Tournament` shape, the `interface Tournament` updates and the consumer surface (the JSON-LD component + the page) gets a typecheck error that points exactly at the swap site.
- **T11 (Lighthouse CI gate) — risk: medium.** Depends on ADR-0017 (CI/CD, currently Stub). If 0017 is not ratified before this slice ships, the gate is the manual `pnpm lighthouse` acceptance command rather than CI-enforced. Acceptance criterion 10 stands either way; only the enforcement venue changes.
- **T3 (OG route) — risk: low.** Edge-runtime cost is real (per ADR-0030 Negative consequences) but bounded; not a slice-blocker.

## Out of scope

What this slice deliberately does not do.

- Off-site local SEO listings (Google Business Profile, Apple Business Connect, Yelp, TripAdvisor) — owner task tracked in `docs/spec.md` open questions.
- A blog or any content-marketing surface (deferred per ADR-0030 Open questions).
- Paid search (Google Ads) (deferred per ADR-0030 Open questions).
- Slice-4 FAQ expansion to long-tail queries (Slice 1 lands the route and a base question set only).
- PostHog SEO-funnel dashboards beyond what ADR-0028 already specifies; consent gating (ADR-0024) makes that data partial and is acknowledged in the ADR.
- Per-tournament dynamic routes (`/games/[slug]`) full content — only the JSON-LD `Event` emit is in scope (against the fixture); the listing/registration UI is owned by ADR-0012's slice.
- Cookie banner / consent implementation (ADR-0024) — separate slice; this spec does not block on it.
- A11y audit beyond what the Lighthouse ≥90 perf budget happens to surface (ADR-0026 owns the a11y floor; the perf budget reinforces but does not duplicate it).
- **Real photography swaps.** AC9 / T10 land regression-prevention infrastructure only; actual venue photography is owner-supplied and lands in a follow-up slice. The `next/image` test passes today against the empty set and fails fast as soon as a raw `<img>` lands.
- **Full marketing-page content for stub routes.** T0 creates minimal `export default function Page()` stubs for `/club`, `/games`, `/membership`, `/contact`, `/privacy`, `/terms`, `/member-agreement`, `/games/[slug]` so the SEO surfaces have files to attach to. The full marketing copy and design for those pages is owned by `slice-1/marketing-home-mvp` (the parent slice this branch hangs off of); this spec does not deliver it.
- **Real telephone and opening-hours values.** `lib/content/nap.ts` ships with the real venue address (`16525 North Fwy, Houston, TX 77090, US`) but TODO-flagged placeholder phone (`+1-000-000-0000`) and hours (Monday 00:00-00:00). The owner replaces these during PR review; the ADR's NAP-consistency promise is partially delivered by Slice 1 and finalised by the owner-input step at merge.

## Open questions

Resolved during planning where possible; remaining items flagged for owner input.

1. **Lighthouse CI venue.** If ADR-0017 (CI/CD) ratifies before this slice ships, T11 wires the gate into the GitHub Actions workflow. If not, T11 lands `pnpm lighthouse` as a manual acceptance command and the CI wiring becomes a follow-up task in the slice that ratifies 0017. Acceptance criterion 10 holds either way.
2. **A11y unification with ADR-0026.** ADR-0026 is Stub but shares the Lighthouse ≥90 threshold. If 0026 ratifies during or before this slice, the budget config in `scripts/lighthouse.mjs` should run both `categories.performance` and `categories.accessibility` rather than duplicating the run; if 0026 stays Stub, this slice ships perf-only and 0026's eventual slice extends the existing config. Future-tightening question; not a blocker for this slice.

(Open Question 1 from v1 — Event JSON-LD vs ADR-0012 readiness — was resolved by the orchestrator to the fixture-now path; see T8. Open Question 3 from v1 — Lighthouse driver choice — was resolved to vanilla `lighthouse` package via Node script; see T0. Open Question 5 from v1 — NAP module location — was resolved by the owner; `lib/content/nap.ts` is final; see T6.)
