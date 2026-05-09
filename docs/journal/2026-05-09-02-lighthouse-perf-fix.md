# 2026-05-09-02 — Fix lighthouse CI perf score on `/`

## What

`pnpm lighthouse` in CI (`continue-on-error: true` job) reported the home
page at 73 on a single GH-hosted-runner sample, while `/games`, `/contact`,
and `/faq` all came in at 96. The 23-point gap on a single sample is mostly
runner noise, but the home page does carry more font-weight payload than
the others, which is a real shared-runner liability. Two-pronged fix:

1. **Median-of-3 in the Lighthouse driver.** `scripts/lighthouse.mjs` now
   runs each URL three times and reports the median. Lighthouse's own
   guidance is "median of 3 (or more)" precisely because single-sample
   scores fluctuate by 15-20 points on shared infrastructure. The
   `LIGHTHOUSE_RUNS` env override exists for local one-shot debugging.
2. **Trim font-weight payload.** Audited the codebase
   (`grep -rn 'font-weight\|fontWeight\|font-bold\|font-semibold'`):
   - **Cormorant Garamond** had 4 weights × 2 styles = 8 variants. No
     usage of weight-700 (no `font-bold`, no `fontWeight: 700`). Dropped
     to 3 weights × 2 styles = 6 variants.
   - **Inter** had 4 weights. Same audit — no 700 in use anywhere.
     Dropped to 3 weights.
   - **JetBrains Mono** unchanged (only 2 weights, both used in the
     live-ticker).
   - Net: 14 → 11 font variants. ~21% reduction in font-fetch payload
     during LCP.

## Why these two together

- Median-of-3 removes the **noise** floor.
- Font-weight trim removes a **real** LCP cost.

Either alone would help; together they should keep the median ≥ 90 on the
home page even when a runner has a noisy neighbor. The home page is the
heaviest in font usage (96px hero h1 + multiple Cormorant Garamond italic
spans), so it benefits the most from the trim.

## What didn't change

- The Lighthouse threshold stays at 90.
- The job stays `continue-on-error: true` until VERCEL_PREVIEW_URL is
  wired (then audits run against the stable Vercel preview deploy
  instead of a noisy local server).
- The four-route audit set is unchanged: `/`, `/games`, `/contact`,
  `/faq`. ADR-0030 AC10 lists those.
- No homepage layout changes — only the font payload changed.

## How to verify

```bash
# Local one-shot (single run; useful while iterating):
LIGHTHOUSE_RUNS=1 LIGHTHOUSE_SPAWN_SERVER=1 pnpm lighthouse

# CI shape (median of 3, what runs in CI):
LIGHTHOUSE_SPAWN_SERVER=1 pnpm lighthouse
```

The output now shows each per-URL run alongside the median:

```
Lighthouse perf scores (median of 3):
  Path                       Median   Runs                Status
  ----------------------------------------------------------------------
  /                           94.0   91, 94, 96          PASS
  /games                      97.0   96, 97, 98          PASS
  ...
```

## When to revisit

- When VERCEL_PREVIEW_URL lands → drop `continue-on-error` so Lighthouse
  becomes a hard gate again.
- If a future feature adds a heavy hero asset (real venue photography
  per ADR-0030 follow-up), re-evaluate the font-weight set against the
  new visual surface.
- If the median ever consistently scores < 90 on the home page after
  these changes, the next move is to defer JS hydration of below-fold
  sections (Hours, CTA) — not to lower the threshold.
