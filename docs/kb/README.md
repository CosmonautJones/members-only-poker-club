# Knowledge base

Topic-keyed lessons accumulated across conductor runs. Each file holds dated bullets — gotchas, surprises, "next time avoid X" — written by the `knowledge-curator` agent at the end of each shift.

Workers, test-writers, and spec-writers read the relevant topic slice on every dispatch, so the KB compounds over time.

## Topics

| File | ADR(s) |
|---|---|
| [rls.md](rls.md) | 0003 |
| [pglite.md](pglite.md) | 0003, 0006, 0009 (test substrate, cross-cutting) |
| [money-handling.md](money-handling.md) | 0004 |
| [idempotency.md](idempotency.md) | 0005 |
| [audit-log.md](audit-log.md) | 0006 |
| [auth.md](auth.md) | 0002 |
| [pii.md](pii.md) | 0009, 0023 |
| [consent.md](consent.md) | 0009, 0023 |
| [seo.md](seo.md) | 0030 |
| [nextjs-app-router.md](nextjs-app-router.md) | 0030, 0009, 0023, 0017 (cross-cutting) |
| [ci-cd.md](ci-cd.md) | 0017, 0004, 0033 (cross-cutting) |

New topics: append a row above and create the file. Curator may propose new topics that don't fit existing ones.

## Bullet format

```markdown
- **YYYY-MM-DD** — short lesson. *Context:* what we were doing. *Why it matters:* why future-you cares.
```
