# ADR-0030: SEO & content strategy

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1

## Context

The site needs to be discoverable for "<city> poker club", "private poker room <city>", and similar searches. Good SEO is mostly: fast pages, proper metadata, structured data, useful content.

## Decision

To be drafted in Slice 1. Direction:

### Technical SEO

- **Server-rendered.** Marketing routes are React Server Components — every page ships fully-rendered HTML. No client-side route gating for SEO content.
- **Metadata.** `app/(marketing)/layout.tsx` sets defaults; each page overrides title/description.
- **OpenGraph + Twitter cards.** Hero image (chip logo) + page-specific OG image (auto-generated via `app/og/route.tsx`).
- **Sitemap.** `app/sitemap.ts` lists all marketing routes + scheduled tournaments.
- **Robots.** `app/robots.ts` allows `/` and `/(marketing)/*`, disallows `/admin`, `/cashier`, `/dashboard`, `/api`.
- **Structured data (JSON-LD):**
  - `LocalBusiness` schema on `/contact` with address, hours, phone
  - `Event` schema on `/games/[slug]` for each tournament
  - `Organization` on `/` with logo, social, sameAs

### Content

- **Hours, address, phone** prominently on `/contact` and footer (NAP consistency for local SEO).
- **Photos** of the venue, room layout, signage (helps with image search and local panel).
- **FAQ** page (Slice 1, expanded in Slice 4) — surfaces common queries that map to long-tail keywords.

### Performance

- Lighthouse perf budget ≥90 in CI.
- LCP <2.5s, CLS <0.1, INP <200ms.
- Images via `next/image` with AVIF + WebP. Hero photo lazy-loaded below fold.
- Fonts: `next/font` with `display: swap` to avoid FOIT.

### Local SEO (out of code scope but documented)

- Google Business Profile claimed and verified.
- Apple Business Connect listing.
- Yelp / TripAdvisor presence.
- (Owner task — flagged in spec open questions.)

## Open questions

- Whether to build a blog (events recap, strategy articles) — defer to post-launch
- Whether to invest in paid search (Google Ads) at launch
