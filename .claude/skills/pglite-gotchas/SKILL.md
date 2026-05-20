---
name: pglite-gotchas
description: Use when writing or debugging tests that use `@electric-sql/pglite` as the in-process WASM Postgres substrate. Triggers on pglite client API patterns (exec / query / transaction), migration shape tests, RLS suites, `auth.uid()` stubs, `pgcrypto` extension references, `inet::text` formatting, or "tests pass against pglite but fail against real Postgres" debugging. Critical for test-writers and migration authors.
---

# pglite-gotchas — substrate-fidelity discipline

pglite is real Postgres 16 compiled to WASM. It is NOT a mock. But it has a smaller contrib catalog, connects as superuser by default, and has client-API quirks that bite. Load this skill before writing pglite-using tests.

## The seven gotchas

### 1. NEVER `CREATE EXTENSION pgcrypto` in pglite

pgcrypto is not bundled. `IF NOT EXISTS` does NOT suppress "extension not available" errors. Drop the line entirely. `gen_random_uuid()` is in pg_catalog since Postgres 13 — no extension needed. For test code, use Node's `crypto.randomUUID()` and pass as a parameterized value.

### 2. Default user has BYPASSRLS — every RLS test must `SET ROLE`

pglite connects as `postgres` (superuser, table owner, BYPASSRLS). RLS is silently bypassed. Even FORCE ROW LEVEL SECURITY cannot override BYPASSRLS — it is checked first.

**Mandatory scaffolding** for every RLS test:

```sql
CREATE ROLE app_authenticated NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO app_authenticated;
GRANT EXECUTE ON FUNCTION <fn>(...) TO app_authenticated;
SET ROLE app_authenticated;
-- ...exercise...
RESET ROLE; -- for service-role positive sub-cases
```

See also: `rls-audit` skill (loads alongside this one for RLS work).

### 3. Seed BEFORE `SET ROLE`, not after

Production Supabase seeds via service-role key (has BYPASSRLS). Mirror this: migration → role + grants → seeds (still as superuser) → `SET ROLE` for per-test. If you seed after `SET ROLE`, your seeds get rejected by the very policies you are testing.

### 4. Two pglite client methods: batch DDL vs parameterized statement

- The **batch** method (named `exec` on the pglite client) takes a single SQL string that may contain multiple statements (CREATE TABLE + CREATE POLICY + CREATE TRIGGER + ...). Migrations go through this method.
- The **statement** method (named `query` on the pglite client) takes one SQL string PLUS a params array. It rejects multi-statement input with a parse error. Use it ONLY when you have one statement with parameters.

Reaching for the statement method on a multi-statement migration produces a confusing parse error; reach for the batch method instead.

### 5. Use the callback transaction API — NOT manual `BEGIN`/`COMMIT`

Calling the statement method with the literal string `'BEGIN'` followed by `'COMMIT'` is NOT a real transaction in pglite. Rolled-back mutations persist; the connection lands in `current transaction is aborted, commands ignored until end of transaction block` state. Use the callback form:

```ts
await pg.transaction(async (tx) => {
  await tx.query('INSERT ...');
  await tx.query('INSERT ...');
  // auto-commits on resolve, rolls back on reject
});
```

**Helpers that need atomicity should NOT manage transactions internally.** Make the helper assume it is already inside a tx-scoped context (caller passes `tx`); the caller wraps in `pg.transaction(async (tx) => helper(tx, ...))`. Caller-owns-tx works idiomatically across pglite, supabase-js, postgres-js, and `pg`. See `withAudit` reference in `docs/kb/audit-log.md`.

For test isolation: a `withRollback(body)` helper that does manual `BEGIN` + body + `ROLLBACK` (so rolled-back mutations do not leak between sub-tests on the SAME pg session) is OK — but it is a different pattern from production transaction-atomicity and should not be used for helper code.

### 6. INSERT vs UPDATE/DELETE behave DIFFERENTLY under FORCE RLS

This is the cycle-3 ADR-0034 finding:

| Operation | No policy + GRANT present | Behavior |
|---|---|---|
| `INSERT` | denied | **SQLSTATE 42501** (strong contract, matches production) |
| `UPDATE` | denied | `affectedRows === 0` (silent, no error) |
| `DELETE` | denied | `affectedRows === 0` (silent, no error) |

Tests asserting INSERT denial under no-policy MUST wrap in a SAVEPOINT so the next statement does not hit "current transaction is aborted":

```ts
await pg.transaction(async (tx) => {
  await tx.query('SAVEPOINT sp');
  try {
    await asAuth.from('clubs').insert({...});
    fail('expected RLS denial');
  } catch (e) {
    expect(e.code).toBe('42501');
    await tx.query('ROLLBACK TO SAVEPOINT sp');
  }
});
```

### 7. `inet::text` includes mask in pglite; real Postgres omits it

pglite returns `'203.0.113.5/32'`; real Postgres returns `'203.0.113.5'`. Use `host(inet)::text` to get the canonical unmasked form on both engines. The stored bytes are identical — this is a rendering quirk only.

## GUC visibility quirk inside RLS WITH CHECK

`auth.uid()` returning the expected uuid at the top level does NOT guarantee it is visible inside `WITH CHECK` clause evaluation on every code path. Cycle 2 ADR-0006 AC7.5 found one case where the probe succeeded but the same connection's INSERT was rejected by `WITH CHECK (auth.uid() IS NOT NULL)` with "new row violates row-level security policy."

When asserting positive-INSERT-under-RLS-with-non-trivial-WITH-CHECK:
- Either defer to a real-Supabase staging test
- Or split into structural positive control (service-role INSERT + `pg_policies` count) + negative WITH-CHECK control (anon → 42501)

## pg-query-emscripten companion (AST shape tests)

When asserting trigger metadata via libpg_query bindings:
- Trigger `events` is a numeric bitfield, NOT keyword strings. `(events & 16) === 16` for UPDATE, `(events & 4) === 4` for INSERT.
- Trigger `timing` is also numeric: `timing === 2` for BEFORE, `timing === 1` for AFTER.
- Do NOT `JSON.stringify(node).toContain('UPDATE')` — the string is not there; the bitfield is.
- pg-query-emscripten ships without TypeScript types — write a minimal ambient at `tests/db/_fixtures/pg-query-emscripten.d.ts` declaring just `parse(sql: string): { parse_tree: PgParseTree; error: PgParseError | null }`. Do not use `@ts-ignore`.

## Smoke-test the substrate stub at setup

`setupAuthStub(pg)` should check four invariants (GUC session-scoping, NULL-on-clear, default 'authenticated' role, return-type signature) before returning. If pglite's GUC scoping or function-resolution model regresses in a future version, the setup throws with a pointed error message instead of letting downstream RLS tests pass under a silently-broken stub.

## Cited evidence

- ADR-0003 cycle 1 — pgcrypto missing, BYPASSRLS default, batch vs statement APIs, manual BEGIN/COMMIT autocommit, smoke-test invariants
- ADR-0006 cycle 2 — `withAudit` transaction redesign (caller-owns-tx), `inet::text` mask quirk, GUC-inside-WITH-CHECK quirk
- ADR-0034 cycle 3 t5 — INSERT-vs-UPDATE-vs-DELETE asymmetry under no-policy + FORCE RLS
- libpg_query constants reference: `src/postgres/include/nodes/parsenodes.h` in the libpg_query repo
