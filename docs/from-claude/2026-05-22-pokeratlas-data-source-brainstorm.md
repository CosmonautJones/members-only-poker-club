# PokerAtlas-as-data-source for `/games` — no-API architecture brainstorm

**Date:** 2026-05-22
**Status:** Pre-ADR research (not yet ratified)
**Scope:** Consuming the *public* `pokeratlas.com` website as a live-data source for our marketing `/games` page tournament + cash-game schedule. **Distinct from ADR-0013** (PokerAtlas TableCaptain in-room ops integration), which is about the room software we license, not the discovery site.

> **Important caveats:** This brainstorm was authored from direct knowledge without web verification (3 research agents dispatched in parallel all returned `529 Overloaded` from Anthropic). The architecture claims are stable across whatever PokerAtlas is actually doing; the **ToS/legal claims and anti-bot posture claims are unverified guesses** to be confirmed before any code ships. Items marked **[UNVERIFIED]** below.

## Context

The `/games` page (`app/(marketing)/games/page.tsx`) currently renders tournament schedules from a hardcoded `lib/tournaments/fixtures` module. Travis wants this to reflect live data — what's actually being spread tonight, real waitlist counts, current tournament status — without manual content updates.

Two distinct concerns drive this:

1. **Display freshness** — the `/games` page should show today's actual schedule, not a static snapshot.
2. **Cross-reference for SEO** — appearing on PokerAtlas (as a listed room) is itself a discovery win, but that's separate (it's their listing of *us*, not us pulling from them).

This brainstorm covers #1 only — pulling FROM PokerAtlas into our display surface.

## Assumption: no API access

ADR-0013 already established (verified 2026-05-04) that PokerAtlas does not publish a partner API. The "discovery first" plan there is about TableCaptain (in-room software). Even if a TableCaptain partnership eventually exposes some API, that's our own data going through our own contract — different from pulling the *public* listings page.

Therefore the architecture below assumes scrape-only.

## The four-layer architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: scraper                                            │
│   playwright headless → extract.ts → Zod.safeParse          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: drift detection (3 tiers)                          │
│   tier 1 smoke shape · tier 2 extraction · tier 3 fields    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: two cron loops                                     │
│   sync (every 15 min, autonomous) · recon (daily, PR-gated) │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: graceful degradation                               │
│   snapshot test · last-known-good cache · manual flip       │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1 — Scraper

**Stack: Playwright.** We already ship it for e2e tests; one less thing to maintain. Cheerio is cheaper but PokerAtlas almost certainly hydrates live game state client-side (typical for any "live waitlist" widget) **[UNVERIFIED — must fetch a representative URL and confirm]**, so cheerio would miss the live fields.

**Selector strategy — layered, in order of preference:**

1. JSON-LD / microdata if present (SEO-conscious sites embed `schema.org/Event`, `schema.org/Place` — survives redesigns because Google reads it)
2. ARIA roles + accessible names (`getByRole('listitem', { name: /Tournament/ })`) — survives CSS class refactors
3. Stable text anchors ("find the header 'Tonight'", read next sibling)
4. `data-testid` / `data-*` attributes (only if PokerAtlas ships them; consumer sites usually don't)
5. CSS class selectors (last resort — CSS-Modules-hashed classes are the most volatile thing on the web)

**Code lives at:** `lib/poker-atlas/extract.ts` with a typed schema.

```typescript
// Zod schema is the contract. If extraction can't produce data matching it,
// that's the drift signal — not a low-level "selector returned null" check.
export const TournamentRow = z.object({
  starts_at_utc: z.string().datetime(),
  name: z.string().min(1),
  buy_in_cents: z.number().int().positive(),
  game_type: z.enum(['nlhe', 'plo', 'mixed', 'other']),
});
```

### Layer 2 — Drift detection (three tiers)

| Tier | Check | Fires when | Routes to |
|---|---|---|---|
| 1 | Smoke shape (fingerprint of `<main>` landmarks, page title pattern) | Page entirely redesigned | Full Claude rebind of `extract.ts` |
| 2 | Extraction-level (Zod `safeParse` per row, row count ≥ expected min) | Items list moved or changed shape | Targeted selector update + re-verify |
| 3 | Field-level sanity (dates parse + in next 60 days, buy-ins > $0 < $100k, game types in enum) | Selector returns plausible-but-wrong column | Retry; only fix if persistent (could be flaky source data) |

### Layer 3 — Two cron loops

**Sync loop** — `.github/workflows/poker-atlas-sync.yml` — runs every 15 min:
- checkout, install playwright, run `pnpm scrape:poker-atlas`
- if Zod parse passes → upsert to Supabase `live_games` / `tournament_schedule` tables via service-role key
- if drift detected → open issue, exit non-zero (do NOT proceed to upsert)

**Recon loop** — `.github/workflows/poker-atlas-recon.yml` — runs daily at 9am Central:
- checkout, install playwright, run `pnpm scrape:poker-atlas --recon-only`
- if last 24h had any drift issues, invoke `anthropics/claude-code-action` with a focused prompt: "PokerAtlas selectors broke. Read the new HTML at <URLs>, the Zod schema at `lib/poker-atlas/schema.ts`, and the current `lib/poker-atlas/extract.ts`. Rewrite the selectors. Run `pnpm scrape:poker-atlas --dry-run` to verify. If Zod parses, commit + push. If you can't fix it, exit non-zero with a diagnostic."
- if Claude commits a fix → bot opens PR, Travis reviews + merges
- if Claude gave up → bot opens an issue instead with the failure diagnostic

**Why two loops, not one:** the sync is autonomous (mechanical data update, safe to fully automate). Recon is PR-gated (code changes are NOT safe to auto-merge — selectors could be silently wrong-but-plausible).

### Layer 4 — Graceful degradation

Three safeguards against silent breakage:

1. **Snapshot test in CI** (`tests/scrape/poker-atlas-snapshot.test.ts`) — runs `extract.ts` against a checked-in HTML fixture (last-known-good page snapshot). When extract.ts changes, this test MUST still pass against the fixture. Prevents Claude from "fixing" selectors in a way that breaks the historical contract.
2. **Last-known-good cache** in Supabase — `live_games` table keeps `last_verified_at` timestamp. If sync fails 3× in a row, the `/games` page renders cached data with a banner: "Schedule last verified <date> — may be stale, verify on PokerAtlas."
3. **Manual flip** — a `POKER_ATLAS_ENABLED` feature flag (or env var) instantly reverts `/games` to hardcoded `lib/tournaments/fixtures`. Used if PokerAtlas sends a C&D or anything else goes sideways.

## Scheduled Claude — where it runs

**Use `anthropics/claude-code-action` in a GitHub Action.** Not the `/schedule` skill (that's a desktop primitive — won't run when Travis isn't at the computer). Reasons:

- Well-trodden path; many reference implementations exist
- Clean auth: `ANTHROPIC_API_KEY` + `GITHUB_TOKEN` secrets
- Bot author appears as the GitHub App (e.g. `claude[bot]`), not Travis
- Cost predictable: per-session billing, not per-minute
- Concurrency / idempotency are GH-native (the `concurrency:` block)

**Estimated cost:** Sonnet tier, no drift detected ~$0.05–0.15 per daily run; with drift + rebind ~$0.30–1.00. Monthly: under $10 even at constant drift.

## Legal / ToS guardrails (UNVERIFIED — verify before shipping)

**Default working assumption:** scraping public HTML pages once every 15 min from a single IP, with a polite User-Agent identifying us (`Members Only Poker SC scraper / contact: <email>`), is probably tolerated for a small TX private club use case.

**Required verification before any code ships:**

1. Read `pokeratlas.com/robots.txt` — if it disallows `/poker-room/*`, that's a hard "no" without partner agreement
2. Read PokerAtlas ToS — quote and cite any explicit scraping clause
3. Send a polite intro email to PokerAtlas business contact: "we're a small TX private club, here's what we pull and at what rate, this is what we display." Gets us a paper trail and possibly a partner discussion.

If they say no: revert to manual fixtures + embedded widget if they offer one. The architecture above is built so swapping the data source is a one-file change (`lib/games-data/source.ts` reads from either `poker-atlas` or `manual-fixtures`).

## What this would cost in time

Rough estimates assuming the legal path is clear:

| Slice | Scope | Time |
|---|---|---|
| **A** | ADR-0037 ratification + paired spec | 1 cycle (~1 hour) |
| **B** | Scraper + extract.ts + Zod schema + snapshot test fixture | 1 cycle (~2-3 hours) |
| **C** | Sync GitHub Action + Supabase tables + RLS for service-role write | 1 cycle (~1-2 hours) |
| **D** | `/games` page rewrite to read from Supabase + last-known-good banner | 1 cycle (~1 hour) |
| **E** | Recon GitHub Action + Claude-code-action integration | 1 cycle (~2 hours) |
| **F** | Graceful degradation feature flag + snapshot test | 1 cycle (~1 hour) |

Total: ~8-10 hours across 6 `/run` cycles. Could be compressed but the slice structure gives clean checkpoints.

## Concrete next moves

Pre-implementation gates (Travis-owned):

1. **Read PokerAtlas robots.txt + ToS** — answers "is this even allowed"
2. **Send courtesy email** to PokerAtlas business contact — establishes paper trail; may unlock partner conversation that changes the entire architecture (API access would obsolete the scraper)
3. **Decide rate** — every 15 min is the proposed default; 60 min may be more polite

Once those are answered, the implementation cycles above are well-scoped.

## Open questions for Travis

- Do you want me to retry the 3 research agents once Anthropic load clears, to verify the `[UNVERIFIED]` claims above before you commit to this architecture?
- If PokerAtlas says no, what's plan B — manual updates forever, or build a different data source (e.g. let staff edit tonight's schedule via the admin console, which has the bonus of also fixing the "no live schedule editing" gap in our own admin tooling)?
- The MCP-server idea Travis raised in conversation is intentionally not architecturally featured here — see brainstorm in chat for the "build the data pipeline first; wrap in MCP only if a clear use case materializes" reasoning. Bring it back as a phase-4 add-on after phases B–F land.
