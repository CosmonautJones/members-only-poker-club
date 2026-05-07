# SEO

Durable lessons for the SEO/marketing-content surface area: metadata,
sitemap, robots, JSON-LD (Organization / LocalBusiness / Event), OG image
routes, and NAP (name/address/phone) consistency.

## Lessons

- **2026-05-05** — Brand/name strings on public SEO surfaces need a single source-of-truth module *and* a critic spot-check. *Context:* the spec writer drafted `name: "Members Only Social Club"` (close-but-wrong) into `lib/content/nap.ts` and the worker landed it verbatim; LocalBusiness + Organization JSON-LD and the `/contact` H1 all rendered the wrong brand because they correctly read `NAP.name`. The validator gauntlet (typecheck/lint/tests) was green — only the diff-mode critic caught it. *Why it matters:* schema-shape tests can't catch semantic drift in load-bearing identity strings. Treat brand/legal-name fields like enums: assert their literal value somewhere, or have a human/critic review every PR that touches the NAP module.
- **2026-05-05** — When introducing an env var for "the canonical site URL," grep for cousins first. *Context:* `app/sitemap.ts` reached for `NEXT_PUBLIC_SITE_URL` while `app/robots.ts` and `app/layout.tsx` (`metadataBase`) used the already-documented `NEXT_PUBLIC_APP_URL`. With only the documented var set in any environment, the sitemap fell through to `https://example.com` while robots advertised `https://membersonlypoker.com/sitemap.xml` — a sitemap of example.com URLs. *Why it matters:* fragmented env-var names produce silently broken cross-file behavior that suffix-only URL tests won't catch. Before adding a new `NEXT_PUBLIC_*`, grep `app/`, `.env.local.example`, and `app/layout.tsx` for any var that already encodes the same intent, and reuse it.
- **2026-05-05** — Sitemap fallback URLs must be the real canonical host, never `https://example.com`. *Context:* the default sitemap fallback emitted `https://example.com/club`, `https://example.com/games`, etc. when the env var was unset — a malformed signal to crawlers, and undetectable by tests that only suffix-match paths. *Why it matters:* sitemap host-correctness is invisible to most assertion styles (`.endsWith('/club')`). Either assert the host explicitly in tests, or make the fallback the production canonical so a misconfigured environment fails loudly rather than silently poisoning the sitemap.
- **2026-05-05** — `lib/content/nap.ts` is the right shape for keeping NAP consistent across surfaces; wire every brand-bearing surface (footer, JSON-LD, contact H1) to it on first land. *Context:* the spec called for the footer to read NAP from the same module, but the footer shipped without an address block and was never wired. No drift hazard *yet* (only one surface displays the address), but the moment a second surface adds it without sourcing from `nap.ts`, NAP-consistency for off-site listings starts drifting. *Why it matters:* NAP drift is the textbook local-SEO bug; the cheap insurance is to wire every potential surface to one module before any of them ship copy.

## Related ADRs

- ADR-0030 — SEO and content strategy (the run that produced these lessons).
