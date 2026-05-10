---
adr: 0006
slice: 1
risk: high
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm migrate:check'
  - 'pnpm test tests/migrations/audit-log-shape.test.ts'
  - 'pnpm test tests/db/audit-log.test.ts'
  - 'pnpm test tests/audit/with-audit.test.ts'
  - 'pnpm test scripts/conductor/'
---

# Spec: Audit log — append-only table + role-change trigger integration + `withAudit` helper (ADR-0006 cycle 2)

- **ADR:** [0006](../adr/0006-audit-log-append-only.md)
- **Status:** Draft (revision 2)
- **Date:** 2026-05-09

## Goal

Land the `audit_log` substrate the rest of the app records to: an append-only
table with manager+ SELECT / authenticated INSERT RLS (no UPDATE / DELETE
policies), three indices for the canonical query patterns, a TypeScript
`withAudit(...)` helper that wraps a server-action's write + audit insert in
the same transaction, and the **first concrete audit integration** —
extending the cycle 1 `profiles_protect_role_change` trigger to write an
`audit_log` row in the same transaction as a permitted role change. No admin
viewer UI in this cycle (Slice 4 owns it). No additional auditable events
beyond role changes (each owning ADR — 0009, 0010, 0011, etc. — adds its own
`withAudit` calls in its own cycle using this helper).

**Test substrate:** continues with `@electric-sql/pglite` (in-process WASM
Postgres) plus `pg-query-emscripten` (AST shape assertions), already added in
cycle 1's `0003` spec — no devDependency changes required. Reuses cycle 1's
`tests/db/_fixtures/auth-stub.ts` and `tests/db/_fixtures/profiles.ts`. RLS
testing applies the same role-switching pattern (`CREATE ROLE
app_authenticated NOBYPASSRLS NOINHERIT` plus `SET ROLE` plus
`asAuthenticated()` / `asServiceRole()` helpers) — pglite's default user has
`BYPASSRLS` and silently shortcuts policies otherwise. SQLSTATE assertions,
never message text, per the cycle 1 KB pattern.

## Acceptance criteria

Numbered, testable. Each is verified by one of the acceptance commands
above. Numbering continues from cycle 1's mental model (each AC binds to a
runnable command).

1. Migration `supabase/migrations/0003_audit_log.sql` exists, follows the
   four-digit `NNNN_<snake_case>.sql` naming convention, and applies cleanly
   when its SQL text is fed (after cycle 1's `0002_profiles_and_roles.sql`)
   to a fresh pglite instance via `pg.exec()` — the multi-statement raw
   entrypoint per the pglite KB. Verified by
   `pnpm test tests/migrations/audit-log-shape.test.ts` and the `beforeAll`
   in `pnpm test tests/db/audit-log.test.ts`.

2. The migration creates the `audit_log` table with these columns and
   properties **verbatim from ADR-0006**:
   - `id            bigserial primary key`
   - `actor_id      uuid references auth.users(id)` (NULLABLE — system actions
     have no logged-in user; ADR-0023 anonymizes via `del:<hash>` token, NOT
     by setting NULL)
   - `action        text not null`
   - `target_type   text not null`
   - `target_id     text not null`
   - `before        jsonb` (nullable — INSERT events have no before snapshot)
   - `after         jsonb` (nullable — DELETE events have no after snapshot)
   - `ip            inet`
   - `user_agent    text`
   - `created_at    timestamptz not null default now()`

   No other columns. The `id` is `bigserial` (NOT `bigint generated …` —
   ADR-0006 specifies `bigserial` verbatim, and the shape test asserts the
   sequence-backed type). Verified by the migration shape test.

3. The migration creates exactly three indices, names verbatim from
   ADR-0006:
   - `audit_log_actor_idx` on `(actor_id, created_at desc)`
   - `audit_log_target_idx` on `(target_type, target_id, created_at desc)`
   - `audit_log_action_idx` on `(action, created_at desc)`

   Each index uses `created_at DESC` to match the canonical "most recent
   first" query pattern. Verified by the migration shape test (regex tier
   for index names; AST tier for column ordering and DESC direction).

4. `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY` is set, `ALTER TABLE
   audit_log FORCE ROW LEVEL SECURITY` is also set (defense-in-depth posture
   matching cycle 1's profiles convention; load-bearing under pglite's
   superuser-owned default), and exactly **two** named policies are present:
   - `audit_log_select_manager` — `for select using (auth.role_at_least('manager'))`
   - `audit_log_insert_authenticated` — `for insert with check (auth.uid() is not null)`

   **No UPDATE policy. No DELETE policy.** RLS denies both by default — the
   table is append-only. The audit table is INSERT-from-app + SELECT-for-
   admin-readers; service-role retains both via Postgres-role BYPASSRLS for
   webhook handlers and admin scripts (per ADR-0007). Verified by the
   migration shape test (policy presence + the absence of FOR UPDATE / FOR
   DELETE) and by the RLS test suite (sub-cases below).

   **INSERT-policy contract (load-bearing invariant — DO NOT WEAKEN):**
   the WITH CHECK clause `auth.uid() IS NOT NULL` **intentionally** denies
   anon (auth.uid() = NULL) inserts. This is not a bug to be "fixed."
   System-level / service-role inserts (e.g. Stripe webhook handlers, admin
   scripts, the `auth.uid() IS NULL` branch of the role-change trigger run
   as superuser) succeed via the **Postgres-role BYPASSRLS attribute** —
   the policy never evaluates for those callers. They do NOT succeed via
   policy weakening.

   Workers MUST NOT:
   - relax this clause to `WITH CHECK (true)` (would let anon inject
     forged audit rows);
   - add a second policy permitting `auth.uid() IS NULL` (same effect);
   - add an `OR auth.uid() IS NULL` disjunct to the existing policy (same
     effect).

   The apparent tension between AC4's `auth.uid() IS NOT NULL` predicate
   and AC7.12 / AC9.4 (which assert that NULL-actor INSERTs succeed under
   service-role) is resolved at the **Postgres-role layer, NOT the policy
   layer.** Service-role bypass is the documented mechanism per ADR-0006
   ("Service role bypasses RLS for system-level entries"). A worker who
   "fixes" the apparent contradiction by weakening the policy has broken
   the audit log's anti-forgery posture.

5. The migration extends `profiles_protect_role_change()` (originally
   shipped in cycle 1 / `0002_profiles_and_roles.sql`) via
   `CREATE OR REPLACE FUNCTION` so a permitted role change writes an
   `audit_log` row in the same transaction as the change. The function body
   semantics:

   - IF `auth.role_at_least('manager')` is true OR `auth.uid() IS NULL`,
     INSERT into `audit_log` with `actor_id = auth.uid()`,
     `action = 'profile.role_change'`, `target_type = 'profile'`,
     `target_id = NEW.id::text`,
     `before = jsonb_build_object('role', OLD.role)`,
     `after = jsonb_build_object('role', NEW.role)`, then RETURN NEW.
   - ELSE RAISE EXCEPTION USING ERRCODE = '42501'.

   Properties this AC pins:
   - The unauthorized branch (RAISE EXCEPTION 42501) is **structurally
     unchanged from cycle 1** — same SQLSTATE, same message string. Existing
     `tests/db/rls-profiles.test.ts` (cycle 1) MUST continue to pass with
     zero edits. Regression of cycle 1's AC8.10 (privilege-escalation
     variants A/B/C) is a hard fail.
   - The audit-write branch fires **only** on permitted changes. An
     unauthorized member self-update of role rolls back the txn before the
     INSERT runs (the IF branch is not entered) — no orphan audit rows.
   - `actor_id` is `auth.uid()` directly (no COALESCE, no fallback). For
     service-role bypass paths where `auth.uid()` is NULL, the INSERT
     records `actor_id IS NULL` — system-level changes are still tracked,
     consistent with ADR-0006 ("nullable: system actions").
   - `ip` and `user_agent` are intentionally **omitted** at trigger level
     (Postgres triggers cannot see HTTP context). Application-level audit
     events flow through the `withAudit` TS helper (AC6), which captures
     `ip` and `user_agent` from the request and passes them as INSERT
     columns. The trigger writes NULL for both — the table column is
     nullable.
   - The trigger declaration itself (`CREATE TRIGGER profiles_protect_role_change`)
     is **not re-issued** — only the function body changes via CREATE OR
     REPLACE FUNCTION. The trigger's timing (BEFORE), event (UPDATE), and
     column list (`role`) are preserved verbatim from cycle 1.

   Verified by the migration shape test (function body AST + the trigger's
   continued presence with the same metadata) and by the RLS test suite
   (positive write, negative non-write, service-role NULL actor_id sub-
   cases).

6. A TypeScript helper `lib/audit/withAudit.ts` wraps a server-action's
   write + audit-row INSERT in a single Postgres transaction. The exported
   API:

   ```typescript
   import 'server-only';

   export interface WithAuditParams {
     action: string;            // e.g. 'membership.cancel'
     targetType: string;        // e.g. 'membership'
     targetId: string;          // the row's id (string-coerced)
     actorId: string | null;    // null for system actions (e.g. webhook)
     ip?: string;               // optional — populated from request
     userAgent?: string;        // optional — populated from request
   }

   export interface WithAuditMutateResult<T> {
     before: unknown;           // snapshot before the change (or null for INSERT)
     after: unknown;            // snapshot after the change (or null for DELETE)
     result: T;                 // value returned to the caller
   }

   export type TransactionClient = /* see Open Questions §1 */;

   export async function withAudit<T>(
     params: WithAuditParams,
     mutate: (tx: TransactionClient) => Promise<WithAuditMutateResult<T>>,
   ): Promise<T>;
   ```

   Properties this AC pins:
   - The helper opens a transaction, invokes `mutate(tx)`, INSERTs a single
     `audit_log` row using the returned `{ before, after }` together with
     the `params` (action, targetType, targetId, actorId, ip, userAgent),
     commits the transaction, and returns `mutate`'s `result`.
   - **One-transaction invariant (load-bearing — DO NOT BREAK):** the
     helper opens **exactly ONE transaction** wrapping BOTH the
     `mutate(tx)` callback AND the audit INSERT. The required ordering
     inside that single txn is:
     `BEGIN → mutate(tx) → INSERT audit_log (using the same tx) → COMMIT`.
     On any throw inside the txn — whether from `mutate` OR from the
     audit INSERT — the helper **does NOT catch**. Rollback happens at
     the connection level (Postgres aborts the txn; the surrounding
     `pg.transaction(...)` / equivalent driver primitive propagates the
     error to the caller).
     Forbidden implementations (a worker who refactors for "cleanliness"
     can silently break atomicity — explicitly disallow these shapes):
     - two separate transactions (one for mutate, one for the audit
       INSERT) — even if both are awaited sequentially;
     - try/catch around the audit INSERT that swallows the error and
       commits the mutation anyway;
     - any "best-effort audit" pattern where the audit row is written
       outside the mutation's txn boundary (e.g. via a fire-and-forget
       async job, or after `COMMIT`).
     The helper is one txn or the contract is broken.
   - If `mutate` throws, the transaction rolls back. **No audit row is
     written for failed mutations** — atomicity guarantees state-without-
     history is impossible (positive direction: a committed change always
     has its audit row; negative direction: a rolled-back change has no
     audit row).
   - If the audit INSERT itself throws (e.g. CHECK constraint violation,
     `inet` parser rejection, or any other server-side error), the
     transaction rolls back. The mutation does NOT silently commit
     without its audit row. This is the load-bearing safety property of
     the helper. (RLS-denial as the trigger for this path is tested
     separately under a specific auth context — see AC9.3.)
   - The file MUST start with `import 'server-only'` per ADR-0007 — the
     audit-write path runs only on the server (uses the service-role-or-
     authenticated DB connection) and must not be tree-shaken into a
     client bundle.
   - **Open Question §1 (planner-resolved):** which transaction client type
     to use. Candidates: `@supabase/supabase-js` (no native txn API as of
     2026-05; rpcs are the documented escape hatch), the `pg` package, or
     a thin pglite-compatible interface. Cycle 3 (ADR-0002) introduces
     `lib/supabase/{server,admin}.ts`; that work doesn't exist yet. The
     planner picks an interface that (a) tests cleanly under pglite, and
     (b) maps to whatever cycle 3 ships without rewriting `withAudit`.

   Verified by `pnpm test tests/audit/with-audit.test.ts` and
   `pnpm typecheck`.

7. RLS unit tests at `tests/db/audit-log.test.ts` use **pglite** as the
   test DB (continuing the cycle 1 pattern). The contract:
   - **`beforeAll`:** construct `new PGlite()`, run `setupAuthStub(pg)`,
     stub `auth.users` (same minimal shape as cycle 1), apply BOTH
     migrations (cycle 1's `0002_profiles_and_roles.sql` followed by cycle
     2's `0003_audit_log.sql`) via `pg.exec()`, seed five fixtures
     (member-A, member-B, cashier, manager, owner) using cycle 1's
     `seedProfile()`, then create `app_authenticated` role with
     NOBYPASSRLS + GRANTs (now extended to include `audit_log` and the
     `audit_log_id_seq` sequence: `GRANT SELECT, INSERT ON audit_log TO
     app_authenticated; GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq
     TO app_authenticated`).
   - **`beforeEach`:** `resetAuthStub(pg)` then `SET ROLE
     app_authenticated`. Identical to cycle 1.
   - **`asServiceRole()` / `asAuthenticated()` helpers:** identical to
     cycle 1's pattern. The audit_log RLS test should LIFT these helpers
     into a shared `tests/db/_fixtures/rls-helpers.ts` per the cycle 1 KB
     ("once a second cycle reaches for them"); both rls-profiles.test.ts
     and audit-log.test.ts import from the shared module. (See Out of
     scope if the planner prefers to defer the lift — cost/benefit
     judgment, not a load-bearing decision.)
   - **`withRollback(body)` helper:** identical pattern (manual BEGIN +
     ROLLBACK, used for any test that mutates state).
   - **Sub-cases asserted (each must pass):**
     1. **Smoke:** beforeAll seeded the migration and 5 profiles; the
        `audit_log` table exists and is empty (count = 0 under service-
        role read).
     2. **SELECT denial — member:** member-A authenticated cannot SELECT
        any `audit_log` rows (manager+ only). Returns zero rows under RLS
        filtering — even if rows exist (positive control: seed one row
        via `seedAuditLog` from `tests/db/_fixtures/audit-log.ts`,
        confirm under service-role the row is visible, then under
        member-A the row is filtered out).
     3. **SELECT denial — cashier:** cashier authenticated also gets zero
        rows. The select policy gates on `manager+`, NOT `cashier+`.
     4. **SELECT permitted — manager:** manager authenticated CAN SELECT
        all audit rows. Same for owner (positive privilege ladder).
     5. **INSERT permitted — authenticated user:** member-A authenticated
        can INSERT a row directly (audit-from-app pattern). The
        `audit_log_insert_authenticated` policy permits any caller with
        non-NULL `auth.uid()`. Verify the row is readable under service-
        role afterwards with the expected column values.
     6. **INSERT denial — anon:** anon caller (test.uid cleared,
        app_authenticated role) attempting INSERT raises SQLSTATE 42501.
        The `auth.uid() is not null` WITH CHECK clause rejects it.
     7. **UPDATE denial — any authenticated user:** any caller (member,
        manager, owner under app_authenticated NOBYPASSRLS) attempting
        `UPDATE audit_log SET action = 'forged' WHERE id = $1` raises
        SQLSTATE 42501. RLS denies UPDATE outright (no policy permits
        it). Three privilege variants — member-A self, manager, owner —
        all rejected. Append-only invariant.
     8. **DELETE denial — any authenticated user:** same three privilege
        variants attempting `DELETE FROM audit_log WHERE id = $1` raise
        SQLSTATE 42501. Append-only invariant.
     9. **Service-role bypass:** `RESET ROLE` to superuser + clear
        `test.uid`. Service-role CAN SELECT, INSERT, UPDATE, DELETE on
        audit_log (BYPASSRLS at the Postgres-role level). This is the
        webhook-handler / admin-script path per ADR-0006 ("Service role
        bypasses RLS for system-level entries — Stripe webhook side
        effects"). The UPDATE/DELETE bypass is acknowledged as a
        legitimate escape hatch for emergency manual repair, NOT a
        normal-path operation; production policy is "service role does
        not UPDATE/DELETE audit_log" (enforced by code review, not RLS).
    10. **Profile role-change writes audit row (positive integration):**
        manager UPDATEs member-A's role from `'member'` to `'cashier'`.
        Wrap in `withRollback` so the seed isn't disturbed. Inside the
        rollback, after the UPDATE: SELECT under service-role from
        `audit_log` and confirm exactly one row with `action =
        'profile.role_change'`, `target_type = 'profile'`, `target_id =
        memberA`, `before = {"role": "member"}`, `after = {"role":
        "cashier"}`, `actor_id = manager`, `ip IS NULL`, `user_agent IS
        NULL`. The audit row is in the same transaction as the role
        change — both visible together inside the rollback, both gone
        after.
    11. **Failed role-change writes NO audit row (negative integration):**
        member-A authenticated attempts UPDATE of own role (variant A:
        simple SET role = 'manager'). The trigger raises SQLSTATE 42501;
        the txn aborts. After the SAVEPOINT rollback (same pattern as
        cycle 1's AC8.11), assert under service-role that NO audit_log
        row exists with `target_id = memberA AND action =
        'profile.role_change'` (count = 0). Atomicity invariant — failed
        mutations must not leave audit traces.
    12. **Service-role role-change writes audit row with NULL actor_id
        (system-level integration):** `RESET ROLE` to superuser + clear
        `test.uid`. UPDATE memberA's role to `'cashier'`. Confirm an
        audit row was written with `actor_id IS NULL` (system action),
        `before = {"role": "member"}`, `after = {"role": "cashier"}`.
        This proves the trigger doesn't trip on a NULL `auth.uid()`
        (e.g. doesn't have a NOT NULL constraint on actor_id INSERT
        path).
    13. **Trigger-firing-order regression (defense-in-depth):**
        introspect `pg_trigger` and re-confirm
        `profiles_protect_role_change` still sorts before `set_updated_at`
        on `public.profiles`, identical to cycle 1's AC8.11 introspection
        sub-case. CREATE OR REPLACE FUNCTION on the function does not
        change the trigger; this catches a worker who replaced the
        trigger and accidentally renamed it.

8. Migration shape tests at `tests/migrations/audit-log-shape.test.ts`
   parse `0003_audit_log.sql` and assert the structural properties below
   in two fidelity tiers (matches cycle 1's pattern).
   - **Regex / lexical tier:**
     - filename matches `/^0003_audit_log\.sql$/` and the generic
       `/^\d{4}_[a-z0-9_]+\.sql$/`;
     - `CREATE TABLE audit_log` present with the 10 v1 column names
       (`id`, `actor_id`, `action`, `target_type`, `target_id`, `before`,
       `after`, `ip`, `user_agent`, `created_at`);
     - presence of the literal `bigserial` (case-insensitive) on the `id`
       column — guards against a worker downgrading to `bigint generated`;
     - presence of all three index names: `audit_log_actor_idx`,
       `audit_log_target_idx`, `audit_log_action_idx`;
     - presence of the literal `enable row level security`
       (case-insensitive) on `audit_log`, AND the literal `force row
       level security`;
     - presence of policy name strings: `audit_log_select_manager`,
       `audit_log_insert_authenticated`;
     - presence of the literal `auth.uid() is not null`
       (case-insensitive, whitespace-tolerant) within or immediately
       following the `audit_log_insert_authenticated` policy block — the
       cheap first defense against a worker silently weakening the WITH
       CHECK clause to `(true)` or adding an `OR auth.uid() IS NULL`
       disjunct. The AST tier (below) covers the same property with
       higher fidelity; the regex tier catches obvious tampering before
       the parser even runs;
     - **absence** of any `for update` or `for delete` policy clause on
       `audit_log` (line- and block-comment-stripped first; same defense
       as cycle 1's no-FOR-INSERT check);
     - presence of `CREATE OR REPLACE FUNCTION profiles_protect_role_change`
       (replaces cycle 1's function);
     - presence of the literal `INSERT INTO audit_log` inside the
       migration text (the trigger function's audit-write call);
     - **absence** of any `CREATE TRIGGER profiles_protect_role_change`
       statement in the new migration (the trigger declaration stays in
       cycle 1's `0002_profiles_and_roles.sql`; only the function is
       replaced).
   - **AST / parser-fidelity tier (`pg-query-emscripten`):**
     - `CreateStmt` for `audit_log` exists with exactly 10 columns; the
       `id` column has a `Constraint` of type CONSTR_PRIMARY and the type
       reference resolves to `pg_catalog.bigserial` (or the libpg_query-
       emitted equivalent — accept either `bigserial` keyword or the
       sequence-backed equivalent the parser normalizes to);
     - `actor_id` column has an FK Constraint with pktable schemaname =
       `auth`, relname = `users`, AND the column is **not** marked NOT
       NULL (libpg_query: no `CONSTR_NOTNULL` constraint present);
     - `IndexStmt` × 3 with names `audit_log_actor_idx`,
       `audit_log_target_idx`, `audit_log_action_idx`. Each has the
       expected column list; each terminal column is `created_at` and
       its IndexElem `ordering` is DESC (libpg_query enum value: 1 in
       most versions; AST assertion uses bitfield/equality match per the
       pglite KB lesson — never JSON-stringify-substring on bitfields);
     - `CreatePolicyStmt` × 2: `audit_log_select_manager` (cmd_name =
       'select', qual references `auth.role_at_least` and `'manager'`),
       `audit_log_insert_authenticated` (cmd_name = 'insert', with_check
       references `auth.uid` and `IS NOT NULL`). NO `CreatePolicyStmt`
       with cmd_name 'update' or 'delete' for relation `audit_log`;
     - `CreateFunctionStmt` for `profiles_protect_role_change` exists
       (this migration replaces cycle 1's function). Function body
       (substring under `JSON.stringify`) contains: `INSERT INTO
       audit_log`, `'profile.role_change'`, `'profile'`, `auth.uid()`,
       `OLD.role`, `NEW.role`, `jsonb_build_object`, AND still contains
       `RAISE EXCEPTION` with `42501` (unauthorized branch preserved);
     - NO `CreateTrigStmt` with `trigname =
       'profiles_protect_role_change'` in this migration (the trigger
       lives in cycle 1; CREATE OR REPLACE FUNCTION is sufficient to swap
       the body). Defends against a worker who needlessly re-creates the
       trigger and accidentally drops the column-mention semantics.

9. Helper unit tests at `tests/audit/with-audit.test.ts` exercise the
   `withAudit` helper end-to-end against pglite. **Caller-axis discipline
   (load-bearing — read this before writing the sub-cases):** AC9.3 and
   AC9.4 exercise mutually exclusive auth contexts and must be set up
   accordingly. The helper's behavior depends on which Postgres role the
   surrounding session is running as:
   - **`app_authenticated` (NOBYPASSRLS):** RLS policies evaluate.
     `audit_log_insert_authenticated`'s WITH CHECK gates on
     `auth.uid() IS NOT NULL`. NULL `auth.uid()` (anon) hits SQLSTATE
     42501.
   - **service-role / superuser (BYPASSRLS):** RLS policies do NOT
     evaluate. NULL actor_id inserts succeed regardless of policy text.
   Each sub-case below pins which role its setup uses. **Mixing them in
   one sub-case is a fidelity bug** — the contradiction the prior
   revision had.
   Sub-cases asserted (each must pass):
   1. **Happy path:** Caller-axis: `app_authenticated` with `auth.uid()`
      set to a real seeded user (e.g., manager). `withAudit` calls
      `mutate`, mutate returns `{ before, after, result }`, the helper
      INSERTs the audit row using params + before + after, commits, and
      returns `result`. Assert the returned value equals `result`. Assert
      exactly one audit_log row was written under service-role read.
   2. **Mutate-throws rolls back AND writes no audit row:** Caller-axis:
      `app_authenticated` with `auth.uid()` set to a real seeded user.
      `mutate` throws an Error before returning. The helper propagates
      the error (does not catch). Under service-role read, audit_log
      count is 0. Atomicity invariant.
   3. **Audit-INSERT-throws rolls back the mutation:** **Caller-axis:
      `app_authenticated` with `auth.uid()` set to a real seeded user
      (NOT anon, NOT service-role).** Simulate an audit-INSERT failure
      via a **server-side constraint violation that is NOT an RLS
      denial** — RLS-denial is a different test path and would
      contradict AC9.4's setup. Recommended simulation: introduce a
      contrived CHECK constraint on a stub field (e.g. seed test setup
      adds `ALTER TABLE audit_log ADD CONSTRAINT
      audit_log_test_action_nonempty CHECK (action <> '__force_fail__')`
      in a `beforeAll`-installed test scaffold; the sub-case calls
      `withAudit({ action: '__force_fail__', ... })`). Equivalent
      alternative: stub the helper's audit-INSERT path (if Option C is
      chosen at t2) to throw a synthetic Error. **Either way, the
      caller's `auth.uid()` is non-NULL** — the failure is in the audit
      INSERT itself, not in policy evaluation. The mutation that ran
      inside `mutate` must be rolled back; under service-role read the
      mutated row is not present. Load-bearing safety property — a
      mutation cannot commit without its audit row.
   4. **`actorId: null` writes NULL actor_id (service-role / system
      path):** **Caller-axis: service-role (postgres superuser +
      BYPASSRLS attribute) with `test.uid` cleared so `auth.uid()`
      returns NULL.** The helper accepts `actorId: null` and the INSERT
      records `actor_id IS NULL`. RLS does NOT evaluate (BYPASSRLS), so
      the `auth.uid() IS NOT NULL` policy never fires. Confirms parity
      with the trigger's NULL-actor path (AC7.12). This is the documented
      service-role / system-action path per AC4's INSERT-policy contract
      invariant.
   5. **`ip` / `userAgent` are NULL when omitted:** if the params don't
      include `ip`/`userAgent`, the audit row's columns are NULL (NOT
      empty string, NOT '0.0.0.0').
   6. **`ip` / `userAgent` round-trip:** when provided, both are stored
      verbatim. `ip` is parsed as `inet` (Postgres rejects `'not-an-ip'`
      with SQLSTATE 22P02 — assert that an invalid IP throws and rolls
      back).
   7. **`before` and `after` accept any JSON-serializable value:**
      includes objects, arrays, strings, numbers, booleans, null.
      `jsonb_build_object`-equivalent serialization at the call site.
      Assert under service-role read the exact JSON shape is preserved.
   8. **`server-only` import present:** static-source-text assertion that
      `lib/audit/withAudit.ts` starts with `import 'server-only';` (per
      ADR-0007). Cheap defense-in-depth against a worker stripping the
      import.

10. `pnpm migrate:check` (the existing safety scanner at
    `scripts/check-migration-safety.mjs`) passes on the new migration file
    with no findings.

11. `pnpm typecheck` passes — including new TypeScript code (`lib/audit/
    withAudit.ts`, `tests/db/_fixtures/audit-log.ts`, the test files
    above). `tsc --noEmit` over the repo must be green.

12. `pnpm test scripts/conductor/` continues to pass — no conductor
    regression.

13. **Cycle 1 regression — zero edits, zero failures:**
    `pnpm test tests/db/rls-profiles.test.ts` and
    `pnpm test tests/migrations/profiles-shape.test.ts` MUST continue to
    pass without modification. The function-body change in cycle 2 is
    backward-compatible at the cycle-1 assertion surface (SQLSTATE 42501
    on unauthorized; trigger metadata preserved). If any cycle 1 test
    needs editing to accommodate cycle 2, that is a fidelity fail — flag
    it and re-scope before shipping. (One small permissible exception:
    if Open Question §2 resolves YES, cycle 1's `rls-profiles.test.ts`
    imports the `asAuthenticated` / `asServiceRole` / `withRollback`
    helpers from the new shared `tests/db/_fixtures/rls-helpers.ts` —
    this is a refactor with no semantic change. The cycle 1 test
    continues to pass without semantic edits.)

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Tests-first preferred —
the audit-log RLS tests + helper tests can be authored before the migration
& helper code lands and used to drive implementation.

- **t0 — Dev-dependency check (probably no-op).** Cycle 1 already added
  `@electric-sql/pglite` (0.4.5) and `pg-query-emscripten` (5.1.0) to
  `devDependencies`. No new packages are required by this cycle — verify
  via `package.json` and `pnpm install --frozen-lockfile` (no lockfile
  drift). If the planner finds a missing peer, add it. Validate with
  `pnpm typecheck`.

- **t1 — Migration: `audit_log` table + indices + RLS + policies + extended
  trigger function.** Author `supabase/migrations/0003_audit_log.sql`. In
  order:
  1. `CREATE TABLE audit_log` per AC2 (columns verbatim from ADR-0006).
  2. Three `CREATE INDEX` statements per AC3 (DESC on the trailing
     `created_at`).
  3. `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;` and
     `ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;`.
  4. Two `CREATE POLICY` statements per AC4. Comment block above the
     policies explaining the deliberate absence of UPDATE / DELETE
     policies (append-only invariant).
  5. `CREATE OR REPLACE FUNCTION profiles_protect_role_change()` — body
     per AC5 (audit-write branch + preserved RAISE-42501 unauthorized
     branch). Comment block referencing cycle 1's migration explaining
     why the trigger declaration is not re-issued.
  Validate with `pnpm migrate:check`.

- **t2 — TypeScript helper: `lib/audit/withAudit.ts`.** Per AC6. Open
  Question §1 (transaction-client interface) MUST resolve before this
  task starts — the planner picks the type contract; the worker
  implements it. The planner's options analysis:
  - **Option A (recommended for cycle 2):** define a thin internal
    `TransactionClient` interface that exposes `query(sql, params)` only;
    cycle 2 implements it directly against pglite for tests AND directly
    against `pg`-style connection in production (cycle 3 wires the real
    driver). Cleanest; defers the Supabase-client coupling decision.
  - **Option B:** type-alias to `@supabase/supabase-js`'s `SupabaseClient`
    and use `.rpc(...)` for the audit insert. Tighter Supabase coupling;
    forces tests to mock the SDK. Cycle 1 didn't introduce a
    SupabaseClient yet (cycle 3 owns `lib/supabase/{server,admin}.ts`).
  - **Option C:** export a higher-order TS function that takes a "DB
    runner" callback, and let the call site provide whatever transaction
    primitive its driver exposes. Most flexible; least concrete.
  Default recommendation: **Option A.** The planner overrides if cycle
  3's planner has already committed to a different driver shape.
  Validate with `pnpm typecheck` and
  `pnpm test tests/audit/with-audit.test.ts`.

- **t3 — Test fixture: `tests/db/_fixtures/audit-log.ts` `seedAuditLog`
  helper.** Mirrors `tests/db/_fixtures/profiles.ts` structure:
  column-permissive seed with sensible defaults for every v1 column,
  service-role seed path (caller MUST clear `test.uid` first, OR run
  before any per-test identity is set, OR run as superuser). Defaults:
  random UUID-derived strings for `target_id` / `action` /
  `target_type`, NULL `before` / `after` / `ip` / `user_agent`, NULL
  `actor_id`. The helper returns the inserted row (read-back). Same
  index-signature trick (`[extra: string]: unknown`) for forward-
  compatibility with downstream column additions.

- **t4 — Audit-log RLS tests: `tests/db/audit-log.test.ts`.** Per AC7.
  13 sub-cases. Reuses cycle 1's `auth-stub.ts` and `profiles.ts`
  fixtures. Establishes the same role-switching boilerplate (SET ROLE
  app_authenticated, asAuthenticated/asServiceRole helpers). The planner
  decides whether to lift the helpers into a shared
  `tests/db/_fixtures/rls-helpers.ts` now (RECOMMENDED — second cycle
  reaches for them, per the cycle 1 KB lesson) or keep them inline for
  this cycle.

- **t5 — Migration shape tests: `tests/migrations/audit-log-shape.test.ts`.**
  Per AC8. Two tiers: regex and pg-query-emscripten AST. Identical
  structure to `tests/migrations/profiles-shape.test.ts` — copy-and-
  adapt. AST assertions use bitfield equality / bitwise-AND for trigger
  / index ordering metadata per the cycle 1 KB lesson.

- **t6 — Helper unit tests: `tests/audit/with-audit.test.ts`.** Per AC9.
  8 sub-cases. The planner picks: pure unit tests with a mock
  TransactionClient, OR pglite-backed end-to-end tests for higher
  fidelity. Recommendation: **pglite-backed.** Cycle 1 already has the
  pglite scaffolding; the marginal cost is small and the fidelity
  benefit (real RLS, real txn semantics) is high. Pure-mock tests
  cannot catch the load-bearing "audit-INSERT-throws rolls back the
  mutation" property — only a real txn does.

- **t7 — `pnpm migrate:check` clean against the new migration.** Read
  `scripts/check-migration-safety.mjs`'s rule catalog before authoring
  to avoid tripping a forward-only-incompatible pattern. The audit_log
  migration is purely additive (CREATE TABLE / CREATE INDEX / CREATE
  POLICY / CREATE OR REPLACE FUNCTION) — no DROPs, no ALTER COLUMN
  destructive changes — so it should pass without acknowledgement
  comments.

- **t8 — Final gauntlet pass.** Run all 6 acceptance commands in order;
  also confirm cycle 1's tests still pass (AC13 regression). Capture any
  fidelity findings (e.g. pglite returning slightly different metadata
  than expected) and surface them in the dispatch summary so the curator
  can update the audit-log + pglite KB.

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create:** `supabase/migrations/0003_audit_log.sql`
- **Create:** `lib/audit/withAudit.ts`
- **Create:** `tests/db/audit-log.test.ts`
- **Create:** `tests/db/_fixtures/audit-log.ts` (column-permissive
  `seedAuditLog`)
- **Create:** `tests/migrations/audit-log-shape.test.ts`
- **Create:** `tests/audit/with-audit.test.ts`
- **Create (recommended; planner decides):**
  `tests/db/_fixtures/rls-helpers.ts` (lifts `asAuthenticated`,
  `asServiceRole`, `withRollback` from `tests/db/rls-profiles.test.ts`
  so audit-log tests reuse them; if the planner defers, both files
  inline the same pattern). If lifted, also **modify**
  `tests/db/rls-profiles.test.ts` to import from the shared module —
  the imports are minimal and the diff stays surgical.
- **Modify:** `docs/kb/audit-log.md` (curator-owned post-cycle; not in
  worker scope unless lessons surface during t1/t4).
- **Modify:** none for `package.json` (cycle 1 added the deps already);
  only if t0 surfaces a missing peer.
- **Modify:** none for application code besides `lib/audit/withAudit.ts`
  — no UI, no server actions.

If the planner lands a TypeScript ambient declaration for an existing
package whose types aren't bundled, that's in scope.

## Risk flags

This is the project's high-risk auto-flag list per the spec-writer template
(linked ADRs in {0003, 0004, 0005, 0006, 0009, 0023}). Phase 1 is expected
to auto-trigger `premortem(mode=task)` on this spec.

- **0006 (this ADR — audit log integrity):** the audit log is the
  forensic record-of-record. A bug class to actively defend against:
  state-without-history (a state change that fails to write its audit
  row) and history-without-state (an audit row written for a change that
  was rolled back). Both are silent. The acceptance criteria deliberately
  include the negative-direction sub-case — failed role-change writes NO
  audit row (AC7.11) — and the helper's atomicity sub-case (AC9.3 —
  audit-INSERT-throws rolls back the mutation). Premortem mandatory.
- **0003 (RBAC + RLS) — coupling:** this cycle EXTENDS cycle 1's
  `profiles_protect_role_change` function via CREATE OR REPLACE. The
  unauthorized branch (RAISE 42501) MUST remain structurally identical
  so cycle 1's tests continue passing without edits. AC13 makes this a
  hard requirement; a worker who "cleans up" the function and changes
  the SQLSTATE / message has broken cycle 1 silently. The shape-test
  AST assertion that the RAISE EXCEPTION 42501 branch is still present
  is the structural guard; the cycle 1 regression run is the behavioral
  guard.
- **0023 (privacy / GDPR data deletion) — anonymization, not deletion:**
  ADR-0023 specifies that account deletion replaces actor data with
  `del:<hash>` tokens but the audit log row itself is **NEVER** deleted.
  This cycle does NOT implement the anonymization (Slice 4 / cycle 6
  owns it). What this cycle MUST avoid: any FK constraint or trigger
  that would CASCADE-delete audit_log rows when an actor is deleted.
  The `actor_id` FK to `auth.users(id)` must NOT have `ON DELETE
  CASCADE` (default is NO ACTION — that's correct; an explicit ON
  DELETE SET NULL would also work but is a drift surface). AC2 asserts
  the column is nullable with a plain FK; AST assertion in AC8 confirms
  no CASCADE.
- **0007 (secrets) — `lib/audit/withAudit.ts` is server-only:** the
  audit-write path runs against the database connection that holds the
  service-role key (or, post-cycle-3, the request-scoped authenticated
  client). The file MUST start with `import 'server-only'` per ADR-0007;
  AC9.8 asserts this with a static source-text check.
- **pglite vs production-Supabase fidelity gap (continued):** cycle 1's
  documented gap continues. The `auth.uid()` stub is the source of
  truth for which session is "service role." AC7.9 (service-role
  bypass) and AC7.12 (system-level role-change writes NULL actor_id)
  rely on this matching production semantics. Cycle 3 (ADR-0002 auth)
  re-validates the predicate against real Supabase; nothing this cycle
  ships changes that posture.
- **Trigger-firing-order regression:** cycle 1's AC8.11 introspection
  asserted `profiles_protect_role_change` sorts before `set_updated_at`.
  This cycle's CREATE OR REPLACE FUNCTION does NOT change the trigger
  declaration, so the ordering invariant should hold. AC7.13 re-asserts
  it as defense-in-depth — catches a worker who "helpfully" rewrote the
  trigger and inadvertently inverted the alphabetical order.
- **`bigserial` vs `bigint generated always as identity`:** Postgres
  prefers `GENERATED ALWAYS AS IDENTITY` for new tables (since v10), but
  ADR-0006 specifies `bigserial` verbatim. This cycle ships `bigserial`
  to match the ADR; AC8 asserts the keyword. A future migration that
  modernizes to `IDENTITY` is acceptable but is OUT OF SCOPE for this
  slice — the test would need updating in the same change.
- **Append-only enforcement at the RLS layer is necessary but not
  sufficient:** RLS denies UPDATE/DELETE for the
  `app_authenticated`-equivalent role, but service-role bypasses RLS at
  the Postgres-role level. AC7.9 documents this as a legitimate-but-
  guarded escape hatch. Production policy is "service-role does not
  UPDATE/DELETE audit_log" — enforced by code review and by the lint
  rule the ADR mentions (`audit-policy` lint, deferred to ADR-0006
  Slice 4 / cycle owning the lint). This cycle does NOT implement the
  lint; that's an explicit Out of scope item.
- **Idempotency is OUT OF SCOPE for the audit row itself:** ADR-0005
  (idempotency) is the canonical pattern for money-touching server
  actions and webhook handlers, with idempotency keys stored alongside
  the mutation. The audit row INSERTed by `withAudit` does NOT carry an
  idempotency key — the caller's mutation does (e.g. the membership
  cancel action holds the key; the audit row records the cancel
  happened). Two webhook deliveries of the same event both write audit
  rows because both attempt the mutation; the idempotency key in the
  mutation prevents the second mutation from succeeding, which (via
  AC9.2 mutate-throws-rolls-back) prevents the second audit row. This
  is the correct behavior; do NOT add an idempotency_key column to
  audit_log this cycle.

## Out of scope

What this cycle deliberately does **not** do. Each item is bound to a
future ADR cycle.

- **Admin audit-log viewer UI (`/admin/audit`).** ADR-0006's
  `Slice: 1 (table + first writes), 4 (admin viewer UI)` puts the viewer
  in Slice 4 / the cycle owning the admin dashboard. Routes, filters,
  search, pagination, CSV export — none of it ships in cycle 2. The
  schema and policies that cycle 2 lands MUST be sufficient for the
  cycle-N viewer to work without further migration; that's the contract.
- **Audit writes for events outside role-change.** ADR-0006 enumerates:
  membership state transitions, refunds, manual time-bank
  adjustments, ID verifications, member-initiated data export /
  deletion, staff sign-ins. Each of those ships in its **owning ADR's
  cycle** using the `withAudit` helper this cycle delivers:
  - Membership state transitions → ADR-0010 (cycle 3)
  - Refunds → ADR-0010 (cycle 3) and ADR-0011 (cycle TBD)
  - Manual time-bank adjustments → ADR-0011
  - ID verifications → ADR-0009 (cycle 4)
  - Data export / deletion → ADR-0023 (cycle 6)
  - Staff sign-ins → ADR-0002 (cycle 3)
  Cycle 2 ships ONE concrete integration: the role-change trigger.
  Adding more here steals scope from those cycles.
- **The `audit-policy` ESLint rule.** ADR-0006 mentions a lint rule that
  flags writes to audit-required tables outside `withAudit`. That's a
  Slice 4 hardening item, not cycle 2. The mitigation in cycle 2 is
  test coverage for the ONE integration we ship + code review for the
  helper's call sites in subsequent cycles.
- **Partitioning the audit_log table.** ADR-0006: "we'll partition by
  month if it ever exceeds 10 GB." Not now.
- **Audit-row anonymization on account deletion.** ADR-0023's
  `del:<hash>` token replacement of `actor_id` (or rather, of the
  associated auth.users row that `actor_id` references) is owned by
  ADR-0023's cycle 6. Cycle 2 MUST ensure no FK CASCADE / trigger
  CASCADE deletes audit rows when an actor is deleted (Risk Flags
  above).
- **Soft-delete or any deletion of audit rows.** Forever-retain per
  ADR-0006. The append-only RLS posture (no UPDATE/DELETE policies) is
  the load-bearing enforcement.
- **MFA / aal claim checks for audit-log SELECT access.** ADR-0003
  specifies `aal=aal2` middleware for staff routes. The
  `audit_log_select_manager` policy gates on role only (manager+); the
  middleware-level MFA gate is deferred to ADR-0027 (cycle 5, admin
  dashboard) where the staff routes are introduced.
- **Real-Supabase integration tests.** Continues cycle 1's posture —
  pglite is the test substrate; CI integration with a real Supabase
  project lands in Slice 4 once API keys are available.
- **Idempotency-key column on audit_log rows.** Out (per Risk flags
  above). The idempotency key lives on the mutation, not the audit
  record.
- **Audit row for the audit-log table's own mutations.** Recursion-trap
  out — we do not audit the audit log.

## Open questions

Surfaced for resolution during planning. **Defaults are the spec
author's recommendation; the planner confirms before t-zero.**

1. **`TransactionClient` interface for `lib/audit/withAudit.ts`** —
   **PROMOTED to t2 prerequisite.** Status: must-resolve before t2 lands.
   Action: planner reads the cycle 3 (ADR-0002) plan to see what driver
   shape that cycle commits to (likely `@supabase/ssr` server client +
   service-role admin client). Picks one of the three options enumerated
   in t2:
   - **A (default):** thin internal `TransactionClient` interface (just
     `query(sql, params)`); cycle 2 implements it for pglite (tests) and
     for production (cycle 3 wires the real driver).
   - **B:** type-alias to `SupabaseClient`; use `.rpc(...)` for the
     INSERT.
   - **C:** higher-order function over an arbitrary "DB runner"
     callback.
   **Default: A.** Cleanest cycle-2-only contract; cycle 3 adapts.
2. **Should `tests/db/_fixtures/rls-helpers.ts` lift now?** Cycle 1's KB
   says "lift the helpers into a shared `tests/db/_fixtures/rls-helpers.ts`
   once the second cycle reaches for them." Cycle 2 IS the second cycle.
   Default: **YES, lift now** — t4 imports from the shared module;
   `tests/db/rls-profiles.test.ts` is updated to import from the same.
   The diff is small (3 helpers, ~60 lines), the future cycles 4 / 5 / 6
   will appreciate not re-litigating, and lifting now exposes any subtle
   coupling between the helpers and the cycle 1 fixtures while we still
   have the context fresh.
3. **`bigserial` keyword vs `bigint generated always as identity` in
   the AST assertion.** ADR-0006 says `bigserial` verbatim. libpg_query
   may normalize `bigserial` to a `pg_catalog.int8` + sequence under the
   hood — the AST assertion should accept either the raw `bigserial`
   token (if libpg_query preserves it) or the normalized form. Default:
   accept either; assert via subtree-substring match for the literal
   `bigserial` first, fall back to checking for a `Constraint` of type
   CONSTR_PRIMARY plus a serial-equivalent type ref. Worker decides at
   t5 implementation time based on what the parser actually emits.
4. **`actor_id` ON DELETE behavior for the FK.** ADR-0006 says
   "references auth.users(id)" with no ON DELETE clause. Postgres
   default is NO ACTION (synonymous with RESTRICT for FKs in the typical
   use case — the delete is rejected if any audit row references the
   user). ADR-0023's anonymization model implies the auth.users row is
   eventually deleted but the audit row's `actor_id` becomes stale-but-
   referenced via the `del:<hash>` token mechanism (which lives on
   profiles, not audit_log directly). Default: ship with the implicit
   NO ACTION. Cycle 6 (ADR-0023) decides whether to ALTER the FK to ON
   DELETE SET NULL when it implements anonymization. Worker MUST NOT
   add ON DELETE CASCADE — that would silently delete audit history on
   account deletion (privacy law violation).

## Iteration history

- **Revision 1 (2026-05-09):** initial spec authored. No prior critic
  concerns. Inputs: ADR-0006 (Accepted), cycle 1 outputs (migration
  0002, fixtures, RLS test, shape test, KB lessons in pglite.md /
  rls.md), ADR-0003 / 0007 / 0023 cross-refs, `docs/spec.md` topology,
  `docs/route-map.md` server-action audit map. 13 acceptance criteria
  (extends cycle 1's 12 with AC13 = cycle-1 regression). 9 task cuts.
  4 open questions (1 promoted to t2 prerequisite). Reuses cycle 1
  fixtures + role-switching boilerplate; recommends lifting shared RLS
  helpers into `tests/db/_fixtures/rls-helpers.ts` now (Open Q §2).

- **Revision 2 (2026-05-09):** address 4 critic concerns from
  `.conductor/0006/dispatches/0002-critic-spec.md` (verdict: revise).
  All four addressed in one pass; no AC removed; acceptance commands
  unchanged; risk/slice/ADR frontmatter unchanged.
  1. **AC9.3 vs AC9.4 contradiction resolved.** Pinned the executing
     role per sub-case explicitly. AC9.3 (audit-INSERT-throws rolls
     back) now runs as `app_authenticated` with `auth.uid()` set to a
     real seeded user; the failure is simulated via a contrived CHECK
     constraint violation on a stub field, NOT an RLS denial — RLS
     denial would be a different test path. AC9.4 (actorId NULL writes
     NULL actor_id) is pinned to service-role / BYPASSRLS with cleared
     `test.uid`. Added a "caller-axis discipline" preamble to AC9
     calling out that mixing the two roles in one sub-case is a
     fidelity bug.
  2. **AC6 one-transaction invariant added.** New explicit invariant:
     the helper opens exactly ONE transaction wrapping BOTH
     `mutate(tx)` and the audit INSERT, with required ordering
     `BEGIN → mutate → INSERT audit_log → COMMIT`. The helper does NOT
     catch on any throw — rollback is at the connection level.
     Forbidden implementations enumerated: two separate transactions,
     try/catch around the audit INSERT, or any "best-effort" /
     fire-and-forget audit pattern. Updated the audit-INSERT-throws
     bullet to remove the misleading RLS-denial example (now covered
     correctly under AC9.3).
  3. **AC4 INSERT-policy contract clarification added.** New invariant
     spelling out that `auth.uid() IS NOT NULL` intentionally denies
     anon, system / service-role inserts succeed via Postgres-role
     BYPASSRLS (NOT via policy weakening), and explicitly forbidding
     three drift patterns: relaxing to `WITH CHECK (true)`, adding a
     second permissive policy, or adding an `OR auth.uid() IS NULL`
     disjunct. Resolves the apparent tension with AC7.12 / AC9.4 at
     the contract level.
  4. **AC8 regex tier hardened.** Added regex assertion for the
     literal `auth.uid() is not null` (case-insensitive,
     whitespace-tolerant) within the `audit_log_insert_authenticated`
     policy block. AST tier already covers this; regex is the cheap
     first defense.
  Critic acceptance items preserved unchanged: cycle 1 regression
  contract (AC13 / AC5 unauthorized branch / AC8 RAISE 42501 AST), FK
  no-CASCADE guard, append-only RLS posture (AC4 / AC7.7-8 / AC8
  no-FOR-UPDATE/DELETE), trigger-vs-helper boundary on ip/user_agent,
  index scope, out-of-scope discipline, and the four open questions.
