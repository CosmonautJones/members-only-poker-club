/**
 * Feature-flag types — ADR-0020.
 *
 * The evaluator consumes a `FlagDefinition` + `FlagContext` and returns a
 * boolean. `FlagKey` is a union — when a new flag is added to the
 * registry, its key must also appear here so callers get type-safe keys.
 */

/**
 * Currently-known flag keys. Add new entries when registering a new flag in
 * `registry.ts`. Kill-switches use a `kill-` prefix per ADR-0020.
 */
export type FlagKey = 'kill-stripe-webhook';

/**
 * Roles in the role-gate targeting mode. Mirrors the ADR-0003 role taxonomy
 * (cashier+, manager+, owner+). When an actual auth/role module ships, this
 * type can be replaced with the imported role union.
 */
export type FlagRole = 'member' | 'cashier' | 'manager' | 'owner';

/**
 * The shape of one flag's definition. Mirrors the future `feature_flags`
 * table columns; the in-code registry uses the same shape so the DB read
 * path can swap in transparently.
 */
export interface FlagDefinition {
  /** Stable identifier; kebab-case per ADR-0020. */
  readonly key: FlagKey;
  /**
   * Master switch. `false` short-circuits the evaluator (kill-switch
   * semantics) regardless of any other targeting. `true` passes through to
   * the targeting modes below.
   */
  readonly enabled: boolean;
  /**
   * Percent rollout, 0–100. `0` disables for everyone (unless allowlisted /
   * role-gated). `100` enables for everyone. `50` enables for a deterministic
   * 50% of profiles.
   */
  readonly percent: number;
  /**
   * Specific profile IDs that always evaluate to enabled (regardless of
   * percent). Used for staff dogfooding.
   */
  readonly allowlist: readonly string[];
  /**
   * If set, only profiles whose role is at-or-above this rank evaluate to
   * enabled. `undefined` means no role gate. Rank is fixed: member < cashier
   * < manager < owner.
   */
  readonly roleGate?: FlagRole;
  /** Human owner — for the 90-day stale-flag review cadence. */
  readonly owner: string;
  /**
   * ISO date string. After this date, the flag should be either fully
   * rolled out (100%) and removed, or rolled back (0%) and removed.
   * `undefined` = no expiry, but the registry should be reviewed quarterly.
   */
  readonly expiresAt?: string;
}

export interface FlagContext {
  /** Authenticated profile ID, if any. Anonymous traffic is `undefined`. */
  readonly profileId?: string;
  /**
   * The profile's role, if known. Used for role-gate evaluation. Anonymous
   * = undefined.
   */
  readonly role?: FlagRole;
}

/**
 * Role rank for role-gate comparisons. Higher number = more privileged.
 */
export const ROLE_RANK: Record<FlagRole, number> = {
  member: 0,
  cashier: 1,
  manager: 2,
  owner: 3,
};
