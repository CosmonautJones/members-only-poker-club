# Next.js App Router

Durable lessons for Next.js 14 App Router patterns — `metadata` exports,
`MetadataRoute.Sitemap`/`MetadataRoute.Robots`, edge-runtime image routes,
JSON-LD via `renderToString`, and the host/dev-server constraints we keep
tripping over.

## Lessons

- **2026-05-05** — Vitest `include` config for new test directories gets reverted between dispatches if the worker that adds the directory doesn't also lock the config in the same change. *Context:* multiple dispatches in the SEO run had to re-extend `vitest.config.ts`'s `include` array to pick up `tests/seo/**`. Either prettier/lint format on the config rolled it back, or test-writer prompts didn't surface the config dependency. *Why it matters:* project-wide config files (vitest.config.ts, tsconfig paths, eslint overrides) are quiet single-points-of-failure for test runs. When a task lands a new test directory, the same commit must update the config; downstream dispatches should grep the config before assuming their tests are being executed.
- **2026-05-05** — Default Next.js dev port 3000 collides with Hyper-V reserved range on Windows hosts; Playwright/Lighthouse runs that bind 3000 silently fail or hang. *Context:* the SEO slice's Lighthouse driver and Playwright e2e couldn't run locally because the host had Hyper-V reserving 3000; `netsh interface ipv4 show excludedportrange protocol=tcp` confirms the reservation. Workaround landed: defer those gates to CI and document the constraint in the dispatch. *Why it matters:* this surfaces every time a new e2e/lighthouse task lands. Either configure tests to use a non-3000 port via `PORT` env, or accept that local e2e is deferred to CI on Windows-with-Hyper-V dev hosts. Don't waste a dispatch debugging "the server didn't start."
- **2026-05-05** — Edge-runtime routes (`app/og/route.tsx` with `ImageResponse`) can't always be invoked under vitest's Node environment; soft-skip the runtime assertion and document why. *Context:* the OG image test exports the GET handler and asserts shape, but actually invoking it under vitest hit edge-runtime/WASM unavailability on the host. The test soft-skips the live-invocation assertion with an inline comment. *Why it matters:* edge-runtime code under Node-environment test runners is a known impedance mismatch. Don't fake the test; either skip honestly with a code comment, or move the assertion to a Playwright e2e where Next runs the route in its real runtime.
- **2026-05-05** — JSON-LD components are testable without a browser: render via `renderToString`, parse the `<script type="application/ld+json">` payload, assert against the parsed object. *Context:* LocalBusiness/Organization/Event JSON-LD components in this slice are tested entirely in vitest — render, regex-extract the JSON, `JSON.parse`, structural assertions. No Playwright needed for shape tests. *Why it matters:* keeps the fast inner-loop fast; Playwright is reserved for things that genuinely need a real DOM/runtime (link-crawling, performance budgets). Don't promote JSON-LD shape tests to e2e.

## Related ADRs

- ADR-0030 — SEO and content strategy (the run that produced these lessons).
