# PII & privacy

Linked ADR(s): 0009, 0023.

## Lessons

- **2026-05-08** — Risk:high + ADR-0023 cross-link should auto-trigger a mandatory premortem before implementation. *Context:* T1 (`<ConsentProvider>`) for ADR-0024 hit the auto-flag because of its ADR-0023 (privacy/GDPR) cross-reference. The premortem surfaced 12 distinct failure modes — 4 spec-fed (banner copy misrepresentation, SDK pre-consent leak, edge-cache cross-user replay, Essential→auth lockout) and 8 surface-specific (hydration mismatch, cross-tab desync, listener leak, stale closure, re-render cascade, mount→write loop, cookie write race, used-outside-provider). Each mitigation became a code/test contract the worker honored one-for-one. *Why it matters:* privacy/PII surfaces fail silently — the validator can be green at 134/134 while every visitor is being tracked pre-consent, because the test never had the right shape to catch the leak. The premortem is the artifact that turns "what could go wrong" into a checklist of mitigations the implementation is bound to. Keep the auto-flag default for any task that touches ADR-0023, ADR-0009, or consent/auth/PII state.

See also `consent.md` for cookie-banner-specific lessons (SDK-load-time gating, type-locked Essential, atomic setter, `visibilitychange` cross-tab sync, counsel-review hook in copy module).
