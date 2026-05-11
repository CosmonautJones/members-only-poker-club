/**
 * Shared types for the auth surface (ADR-0002, t1).
 *
 * Single source of truth for the role ladder + the `Profile` interface that
 * mirrors cycle-1's `profiles` schema (supabase/migrations/0002_profiles_and_roles.sql).
 *
 * Forward-compat seam (per spec AC6): cycle 4 will extend `Profile` with
 * `id_verified_at` and friends. Keeping the type in this file means the
 * extension is one diff against `lib/auth/types.ts` — consumers that import
 * from here pick up the wider shape automatically.
 *
 * NO `import 'server-only';` here — types are erased at compile time and
 * carry no runtime payload that could leak to a client bundle. Only files
 * that ship runtime code referencing privileged data (e.g. errors.ts,
 * safeNext.ts, getCurrentProfile.ts, requireRole.ts) carry the directive.
 */

/**
 * The four-role ladder defined in ADR-0003 and enforced at the DB layer by
 * the `role_t` enum + `auth.role_at_least()` helper. Names MUST stay in
 * lockstep with the SQL enum values — adding a role requires both a
 * migration AND an update to `ROLE_RANK` below.
 */
export type Role = 'member' | 'cashier' | 'manager' | 'owner';

/**
 * Numeric ranks that mirror the SQL `auth.role_at_least()` precedence:
 * member < cashier < manager < owner. Used by `requireRole` to compare
 * `have` vs `need` without hand-rolling string comparisons.
 *
 * Adding a new role requires inserting it at the correct rank AND adding
 * the matching enum value to the cycle-1 migration. DO NOT renumber
 * existing ranks — the numeric values themselves are not load-bearing,
 * but the ORDER is.
 */
export const ROLE_RANK: Record<Role, number> = {
  member: 0,
  cashier: 1,
  manager: 2,
  owner: 3,
};

/**
 * Mirrors the `profiles` table columns from
 * supabase/migrations/0002_profiles_and_roles.sql:
 *
 *   id          UUID         PRIMARY KEY (auth.users.id)
 *   full_name   TEXT         NOT NULL
 *   dob         DATE         NOT NULL
 *   phone       TEXT         NULL
 *   email       TEXT         NOT NULL UNIQUE
 *   role        role_t       NOT NULL DEFAULT 'member'
 *   created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
 *   updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
 *
 * Date-typed columns (`dob`, `created_at`, `updated_at`) come back from
 * Supabase as ISO strings — keep them typed as `string` here. Callers that
 * need Date objects parse at the call site.
 *
 * `phone` is nullable in the schema; mirror that with `string | null`.
 */
export interface Profile {
  id: string;
  full_name: string;
  dob: string;
  phone: string | null;
  email: string;
  role: Role;
  created_at: string;
  updated_at: string;
}
