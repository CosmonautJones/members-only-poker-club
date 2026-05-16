import 'server-only';
import { ROLE_RANK, type Role } from './types';

/**
 * Typed role-ladder comparator (ADR-0003 + ADR-0036 t6).
 *
 * **Parameter order is LOAD-BEARING.** The first argument is the actor's
 * role; the second is the role required by the gate. Inverting them
 * silently collapses owner-only gates to "always allow" at every
 * callsite that inlines this helper — see authority premortem R5.
 *
 * Lives in its OWN module (separate from `lib/auth/types.ts`) because
 * `types.ts` is a types-only file whose JSDoc explicitly forbids the
 * `import 'server-only';` directive — types are erased at compile time
 * and carry no runtime payload. Adding a runtime export there would
 * break that invariant, so we ship the runtime helper here. The
 * `import 'server-only';` directive above is REQUIRED: the
 * authority-matrix logic ranks roles and SHOULD NOT be inspectable
 * client-side (defense-in-depth — see authority premortem R10).
 *
 * Confusion-with-DB-helper warning (premortem R5(c)): the
 * Postgres-side `auth.role_at_least(text)` function (declared in
 * `supabase/migrations/0002_profiles_and_roles.sql`) reads the
 * CURRENT SESSION'S role; this TypeScript helper compares two role
 * strings supplied by the caller. They are NOT equivalent — do not
 * refactor a `requireRole` callsite to inline the SQL helper's
 * semantics on top of this one.
 *
 * @param have - the actor's role (typically `actor.role` from `requireRole`)
 * @param need - the role required by the gate
 * @returns `true` iff `have`'s rank is ≥ `need`'s rank per ROLE_RANK
 */
export function roleAtLeast(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}
