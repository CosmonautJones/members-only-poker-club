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
