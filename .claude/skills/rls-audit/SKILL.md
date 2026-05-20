---
name: rls-audit
description: Use when writing or reviewing Row-Level Security policies and the tests that assert their behavior. Triggers on RLS policy bodies, USING/WITH CHECK clauses, FORCE ROW LEVEL SECURITY, BYPASSRLS roles, SQLSTATE 42501 assertions, or RLS-denied SELECT/UPDATE/DELETE/INSERT assertions. Critical for spec-writers, test-writers, and code reviewers touching `supabase/migrations/*.sql` or `tests/db/rls-*.test.ts`.
---

# rls-audit — RLS contract authoring + testing discipline

This skill loads when you're about to write or assert RLS behavior. It exists because the 42501-vs-rowCount=0 distinction is non-obvious and repeatedly caught real cycles by surprise.

## The headline rule

**Postgres does NOT throw on USING-filter denial. It silently filters.**

| Operation | Denied by | Result |
|---|---|---|
| `INSERT` | `WITH CHECK` clause fails | `SQLSTATE 42501` thrown (loud error) |
| `UPDATE` | `USING` clause filters no row | `rowCount = 0` (silent — NO 42501) |
| `DELETE` | `USING` clause filters no row | `rowCount = 0` (silent — NO 42501) |
| `SELECT` | `USING` clause filters | empty result set (silent — NO 42501) |
| ANY operation | missing GRANT at table level | `SQLSTATE 42501` thrown |
| ANY operation | explicit `RAISE EXCEPTION USING ERRCODE = '42501'` in trigger | `SQLSTATE 42501` thrown |

The ONLY ways to get 42501 from an RLS-related path are: (a) INSERT's WITH CHECK fails, (b) the GRANT itself is missing, or (c) a trigger explicitly raises it.

**If the spec asserts `42501` on UPDATE/DELETE/SELECT, the spec is wrong.** Push back at critic-spec time. Either change the policy shape (e.g. separate UPDATE policy with permissive USING + restrictive WITH CHECK can produce 42501) or change the assertion to `rowCount === 0`.

## FORCE vs BYPASSRLS — which one is checked first?

**BYPASSRLS wins. Always.** It's a role attribute checked BEFORE policy evaluation. FORCE ROW LEVEL SECURITY only matters for table-OWNER connections (it prevents the owner from being implicitly exempt).

If you're testing in pglite or fresh Postgres, the default `postgres` role has `BYPASSRLS`. Adding `FORCE` to your migration will NOT make your tests detect policy violations — every operation succeeds because BYPASSRLS short-circuits.

**Required test scaffolding:**

```sql
-- in beforeAll (or _fixtures/rls-helpers.ts setup)
CREATE ROLE app_authenticated NOBYPASSRLS NOINHERIT;
GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO app_authenticated;
-- per-test:
SET ROLE app_authenticated;
-- ...exercise...
RESET ROLE; -- for service-role positive sub-cases
```

In production Supabase, `anon` and `authenticated` already have NOBYPASSRLS. FORCE is still worth shipping as defense-in-depth — costs nothing, documents intent.

## Test assertion shape (the only correct form)

```ts
// INSERT-deny (WITH CHECK fails or trigger raises)
await expect(asAuthenticated.from('table').insert({...})).rejects.toMatchObject({ code: '42501' });
expect.assertions(1); // pin so silent-pass on rejected promise is impossible

// UPDATE-deny (USING filters)
const { error, count } = await asAuthenticated.from('table').update({...}).match({ id });
expect(error).toBeNull();
expect(count).toBe(0); // or affectedRows on the underlying driver
// THEN confirm the row didn't change via service role:
const { data } = await asServiceRole.from('table').select().eq('id', id).single();
expect(data.field).toBe(originalValue);

// DELETE-deny (USING filters) — same shape as UPDATE
// SELECT-deny (USING filters)
const { data } = await asAuthenticated.from('table').select().eq('id', id);
expect(data).toEqual([]); // empty, not error
```

Never assert on `EXCEPTION` message text. Only assert on SQLSTATE codes. Message strings can change with localization or migration edits.

## Variant C (no-op SET) catches BEFORE UPDATE OF column triggers

`BEFORE UPDATE OF role` fires on `SET role = 'member'` whether or not the new value equals the old. Test all three variants:

- Variant A: `SET role = 'manager'` (different value)
- Variant B: `SET role = 'manager', full_name = 'X'` (multi-column)
- Variant C: `SET role = role` (no-op)

Variant C catches drift if a future migration switches the trigger to "value actually changed" semantics — A and B alone would still pass.

## Fix-forward, never rewrite shipped migrations

If a shipped migration is missing RLS, add a NEW migration (`NNNN_<table>_rls.sql`) that does `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY;` + new policies. **Do not edit the original migration.** Editing breaks every downstream `migrate:check` hash and every dev's local pglite state.

The new migration's header comment block carries the reasoning that would otherwise live in the original. Also `COMMENT ON TABLE <name>` to update the table-level documentation.

## Service-role positive sub-cases are mandatory

Every RLS test file must include a service-role-bypass positive sub-case. Without it, you can't distinguish "the policy correctly blocked the operation" from "the policy is wrong AND the table grant is also wrong AND nothing works." `RESET ROLE` to drop back to superuser, run the same operation, assert it succeeds.

## Spec-writer mandate

When writing a spec that touches RLS, you MUST:

1. State the POLICY SHAPE explicitly (`FOR ALL` vs separate `FOR SELECT`/`FOR UPDATE`/`FOR INSERT` with WITH CHECK).
2. Match assertion shape to operation per the table above.
3. Never combine "FOR ALL with restrictive USING" + "asserts 42501 on UPDATE" — that's contradictory.
4. Cite this skill in the spec's Touched-files inventory under "Linked KB topics".

## Cited evidence

- ADR-0003 cycle 1 — pglite BYPASSRLS short-circuit; `NOBYPASSRLS NOINHERIT` test role established
- ADR-0006 cycle 2 — discovered UPDATE/DELETE silently return rowCount=0, not 42501
- ADR-0035 cycle 4 — spec asserted 42501 on UPDATE, worker pushed back, spec amended
- All cycles — `expect.assertions(N)` discipline; never assert on message text
