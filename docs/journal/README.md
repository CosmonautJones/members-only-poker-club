# Project journal

A per-shift log of forward motion on this project. Each entry captures one meaningful step — design, implementation, decision, fix, or retrospective — so we can look back, learn, and stay coherent across long stretches of work.

The journal is **descriptive**, not prescriptive. ADRs decide *what we will do*; the journal records *what we did, why, and what surprised us*.

## Filename convention

`YYYY-MM-DD-NN-<short-slug>.md`

- `YYYY-MM-DD` is the date the entry was written.
- `NN` is the entry number for that day, two digits, zero-padded (`01`, `02`, …).
- `<short-slug>` is kebab-case, ≤6 words.

Example: `2026-05-05-01-adr-0001-ratification.md`

## Entry template

```markdown
---
date: YYYY-MM-DD
adrs: [0001, 0002]   # ADRs this entry advances. [] if infra/meta.
slice: 1              # Slice from the README phasing.
type: ratification | design | implementation | decision | fix | infra | retro
status: complete | partial | blocked
---

# <title>

## Context
Why this shift happened. What state we were in. What prompted it.

## Changes
Concrete things that changed in the repo or the plan.

## Decisions
Non-obvious choices made — *why we picked this and not the obvious alternative*. Future-you will thank present-you.

## Tests
What we added or ran. If none, say "none added — <reason>".

## Next
What the next shift should pick up. One line per item.

## Notes for future me
Anything surprising, any gotchas, anything that would have saved time today.
```

## When to write an entry

- After ratifying or designing an ADR.
- After shipping a meaningful slice of code (one PR's worth).
- After a notable decision *between* PRs (e.g., changing approach, dropping an option).
- After a retrospective or learning moment.
- **Not** after every commit, every test run, or every typo fix. The journal is for shifts, not heartbeats.

## Index

| Date | Entry | ADRs | Type |
|---|---|---|---|
| 2026-05-05 | [01 — ADR-0001 ratification + journal infra](2026-05-05-01-adr-0001-ratification.md) | 0001 | ratification |
| 2026-05-05 | [02 — Foundation ADRs 0002–0008 ratification](2026-05-05-02-foundation-adrs-0002-0008.md) | 0002–0008 | ratification |
| 2026-05-05 | [03 — About Us copy refresh on ClubScreen](2026-05-05-03-about-us-content-update.md) | — | implementation (corrected by 04) |
| 2026-05-05 | [04 — Brand correction + BYOB ratification + domain cascade](2026-05-05-04-brand-correction-byob-domain-cascade.md) | 0009, 0033 | fix |
| 2026-05-05 | [05 — Conductor harness scaffolding](2026-05-05-05-conductor-harness.md) | — | infra |
| 2026-05-05 | [06 — Conductor amendment: ratifier role for Stub ADRs](2026-05-05-06-conductor-amendment-ratifier.md) | — | infra |
| 2026-05-06 | [01 — Marketing home MVP shipped to Vercel preview](2026-05-06-01-marketing-home-mvp.md) | 0002 | implementation |
| 2026-05-08 | [01 — ADR-0024 cookie & consent banner conductor run](2026-05-08-01-conductor-run-adr-0024-consent.md) | 0024 | implementation |
| 2026-05-09 | [03 — ADR-0003 roles + RLS conductor run](2026-05-09-03-conductor-run-adr-0003-rls.md) | 0003 | implementation |
| 2026-05-10 | [01 — ADR-0006 audit log conductor run](2026-05-10-01-conductor-run-adr-0006-audit-log.md) | 0006 | implementation |
| 2026-05-10 | [02 — ADR-0002 auth signup/login + gated member layout conductor run](2026-05-10-02-conductor-run-adr-0002-auth.md) | 0002 | implementation |
| 2026-05-15 | [01 — ADR-0035 admin operations console conductor run](2026-05-15-01-conductor-run-adr-0035-admin-operations-console.md) | 0035 | feature |
