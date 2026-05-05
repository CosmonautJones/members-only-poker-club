# ADR-0003: Authorization model — roles + Row-Level Security

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1 (schema + skeleton) → 2 (full enforcement)

## Context

Different surfaces have different permission models:

- A **member** sees only their own profile, membership, time-bank, ledger, payments, tournament regs.
- A **cashier** sees the same fields for any member but can write only redemption ledger entries.
- A **manager** can issue refunds, override membership state, and read the audit log.
- An **owner** can do everything plus assign roles.

We could enforce all of this in application code, but RLS at the database layer is more secure (defense in depth, no possibility of forgotten checks in a new endpoint) and matches Supabase's idiomatic pattern.

## Decision

A `role` enum on `profiles`: `member | cashier | manager | owner`.

All tables have **RLS enabled by default** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). Policies are written per-table, reviewed in PR.

### Role precedence

```sql
create or replace function auth.role_at_least(target text)
returns boolean language sql stable security definer as $$
  select case
    when target = 'member'  then true  -- everyone authenticated
    when target = 'cashier' then exists (select 1 from profiles p
                                          where p.id = auth.uid()
                                          and p.role in ('cashier','manager','owner'))
    when target = 'manager' then exists (select 1 from profiles p
                                          where p.id = auth.uid()
                                          and p.role in ('manager','owner'))
    when target = 'owner'   then exists (select 1 from profiles p
                                          where p.id = auth.uid()
                                          and p.role = 'owner')
    else false
  end;
$$;
```

### Policy patterns

- **Member-owned rows:** `using (profile_id = auth.uid())`, with separate select/insert/update policies.
- **Staff-readable rows:** `using (auth.role_at_least('cashier'))`.
- **Manager-only writes:** `using (auth.role_at_least('manager'))` on `update`/`delete`.
- **Audit log:** select restricted to `manager+`. **No** `update`/`delete` policies (table is append-only).
- **Service-role bypass:** Supabase service-role key bypasses RLS; used only in webhook handlers and admin maintenance scripts.

### MFA enforcement

Staff routes are gated at middleware level by checking a `aal=aal2` claim on the JWT (Supabase Auth's MFA assertion level). If `aal < aal2`, redirect to `/login/mfa-challenge`.

### Audit

Every role change writes an `audit_log` row in the same transaction (enforced via a Postgres trigger on `profiles`).

## Consequences

**Positive:**

- A bug in our application code can't expose another member's data — RLS catches it.
- Policies are colocated with schema in migrations, reviewed alongside.
- New developers don't need to memorize "always check this user.id matches" — RLS does it.

**Negative:**

- RLS policies are easy to write incorrectly (e.g., forgetting the `update` clause and leaving members able to write any row). Mitigation: require an `RLS-CHECK` line in every PR description that touches schema, plus a unit test suite that asserts denial for cross-tenant reads.
- Service-role key is a foot-gun. Mitigation: confined to `lib/admin/`, `app/api/webhooks/*`, all marked with `import 'server-only'`. ADR-007 covers secret hygiene.
- RLS adds query overhead. Negligible at our scale (<10K members), measure in Slice 4.

## Alternatives considered

- **App-layer-only authorization** (no RLS). Faster queries, but every endpoint must remember to filter. One forgotten `where profile_id = ...` and a member sees another member's data. Rejected.
- **Hand-rolled `view_*` for each role.** Less flexible than policies; we'd need to maintain views in lockstep with tables. Rejected.
- **Permit-based** (Cerbos, Oso). Powerful but adds a new dependency for a relatively simple permission model. Reconsider if multi-location support arrives.
