# Cookie consent & privacy UX

Linked ADR(s): 0009, 0023.

Durable lessons for cookie banners, consent state, third-party SDK gating, and
legal-copy hand-off. See also `pii.md` for data-handling lessons and
`nextjs-app-router.md` for the SSR-safe conditional-render pattern that
underpins the banner.

## Lessons

- **2026-05-08** — Type-locked invariants beat runtime checks alone. *Context:* the consent state's `essential` field is a literal `true` in the TypeScript type, not just a runtime guard inside `writeConsent`. Attempts to write `{ essential: false }` fail at compile time, and the throw is defense-in-depth. *Why it matters:* when a value is invariant by policy (Essential cookies are always on; an Audit row's `created_at` is never user-editable; an Idempotency key is never null), encode it in the TS type, not just in a comment or a runtime assert. The compiler rejects the entire failure mode before it can reach test or prod.
- **2026-05-08** — Gate third-party SDK *initialization* at the consent boundary, not each event-send. *Context:* analytics SDK is dynamically imported only when `consent.analytics === true`; if consent is false, the module never loads, so no event-send call site can leak data even if a developer forgets a `if (consent)` check. *Why it matters:* the per-event-flag approach has an O(call-sites) attack surface and one missed branch leaks PII. Gating at SDK-load is O(1) and catches the leaks the per-event approach can't. Apply the same pattern to error reporters, session replay, A/B SDKs — anything that phones home.
- **2026-05-08** — Cross-tab cookie sync via `visibilitychange`, not polling. *Context:* consent state lives in a cookie and the user can open the preferences modal in any tab; tabs re-read on `visibilitychange` (focus) so a change in tab A is visible in tab B without a full reload. The non-obvious pitfall is the cleanup return from the effect — without it, long-lived tabs accumulate listeners. *Why it matters:* polling wastes cycles and still has a window of staleness; storage events don't fire for cookies (only `localStorage`); `visibilitychange` is the right primitive when state is cookie-backed and user-editable. Always pair `addEventListener` with the cleanup return in the same effect.
- **2026-05-08** — Atomic setter API: take a complete state argument, never a partial. *Context:* the consent setter accepts a full `ConsentState`, writes the cookie synchronously, then updates React state. There is no read of current state inside the setter, and the callback is wrapped in `useCallback([], …)` so its identity is stable. *Why it matters:* partial-state setters that read current state inside the closure are stale-closure bugs waiting to happen. A complete-state setter with no internal reads sidesteps the entire class of "merged state was wrong because the closure captured an old value." The empty-deps `useCallback` keeps downstream `useEffect` deps honest.
- **2026-05-08** — Counsel-review hook lives in a single typed copy module. *Context:* user-visible legal-exposure strings (banner copy, ToS notices, age-gate language) sit in one typed module with a `// TODO(counsel)` comment as the actionable gate. Engineering ships placeholder copy without blocking; counsel reviews exactly one file at launch; future copy edits touch only that file. *Why it matters:* legal copy scattered across components is impossible to audit and impossible to update atomically. A single module + a single TODO marker turns a coordination problem into a code-review checklist item. Same pattern applies to age-gate strings, alcohol/BYOB notices, and house-rules acknowledgements.

## Related ADRs

- ADR-0009 — PII handling and data minimization.
- ADR-0023 — Consent capture and audit.

## Cross-references

- `nextjs-app-router.md` — render-after-hydration-only pattern used by the banner.
- `pii.md` — broader data-handling lessons.
