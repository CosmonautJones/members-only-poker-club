/**
 * Migration shape regression test — `profiles_protect_role_change`
 * trigger function (ADR-0035 AC29, premortem R3, WD.T20 / t21).
 *
 * Run locally:    pnpm test tests/migrations/role-change-trigger-shape.test.ts
 * Prerequisites:  none — pure source-text scan.
 *
 * Contract:
 *   - The cycle-1 migration `0002_profiles_and_roles.sql` declares the
 *     `profiles_protect_role_change` trigger.
 *   - The cycle-2 migration `0003_audit_log.sql` rewrites the trigger's
 *     function body to ALSO emit `INSERT INTO audit_log (...)` on the
 *     authorized branch (the "two audit rows per role change" invariant).
 *   - This test pins the regression-safety contract: the latest migration
 *     owning the trigger function (`0003_audit_log.sql`) must contain the
 *     literal `INSERT INTO audit_log` inside the trigger function body.
 *   - If a future "cleanup" migration drops the trigger's audit emission
 *     (e.g. by reverting the CREATE OR REPLACE), the second-audit-row
 *     leg of premortem R3 fails — the application action's audit row
 *     would still fire, but the trigger's matched row would not, breaking
 *     forensic parity. This shape test is the first line of defense.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIGRATIONS_DIR = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations');

/**
 * Find the most-recent migration that owns (CREATE / CREATE OR REPLACE)
 * the `profiles_protect_role_change` function. Migrations are
 * conventionally numbered `NNNN_*.sql`; we sort lexicographically and
 * pick the last match.
 */
function findLatestTriggerOwner(): string | null {
  const entries = readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort();
  let latest: string | null = null;
  for (const name of entries) {
    const full = join(MIGRATIONS_DIR, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    const src = readFileSync(full, 'utf8');
    if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+profiles_protect_role_change/i.test(src)) {
      latest = full;
    }
  }
  return latest;
}

describe('profiles_protect_role_change trigger shape (AC29 R3 regression)', () => {
  it('a migration declares (or REPLACEs) profiles_protect_role_change', () => {
    const f = findLatestTriggerOwner();
    expect(f, 'no migration declares profiles_protect_role_change').not.toBeNull();
  });

  it('latest owning migration contains INSERT INTO audit_log inside the trigger body', () => {
    const f = findLatestTriggerOwner();
    expect(f).not.toBeNull();
    if (!f) return;
    const src = readFileSync(f, 'utf8');
    // The trigger function body must contain the audit emission. We
    // require BOTH the function declaration AND the INSERT to coexist
    // in the same file — the cycle-2 migration is a CREATE OR REPLACE
    // FUNCTION whose body declares the INSERT, so they are colocated.
    expect(src).toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+profiles_protect_role_change/i);
    expect(src).toMatch(/INSERT\s+INTO\s+audit_log/i);
  });

  it('latest owning migration emits action="profile.role_change" from the trigger body', () => {
    const f = findLatestTriggerOwner();
    expect(f).not.toBeNull();
    if (!f) return;
    const src = readFileSync(f, 'utf8');
    // The audit action string is the cycle-2 contract — DB-emitted rows
    // use `profile.role_change` (note the dot, not `admin.member....`).
    // Strip SQL comments before checking so a doc comment doesn't
    // satisfy this test by accident.
    const stripped = src.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).toMatch(/['"]profile\.role_change['"]/);
  });

  it('the unauthorized branch retains SQLSTATE 42501 (cycle-1 contract preserved)', () => {
    const f = findLatestTriggerOwner();
    expect(f).not.toBeNull();
    if (!f) return;
    const src = readFileSync(f, 'utf8');
    // The function's ELSE arm must `RAISE EXCEPTION ... USING ERRCODE = '42501'`.
    expect(src).toMatch(/ERRCODE\s*=\s*['"]42501['"]/);
  });
});
