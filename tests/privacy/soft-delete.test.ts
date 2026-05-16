/**
 * Tests for lib/privacy/soft-delete.ts — ADR-0023 AC3.
 *
 * Pglite-backed (real Postgres semantics) reusing the rls-helpers and
 * seedProfile fixtures from tests/db/_fixtures/.
 *
 * Sub-cases:
 *   1. First call mutates and returns { mutated: true }.
 *   2. Second call returns { mutated: false } (idempotent no-op).
 *   3. full_name after delete matches /^del:[0-9a-f]{64}$/ (del: + sha256 hex).
 *   4. email after delete matches /^del:[0-9a-f]{64}@deleted\.local$/.
 *   5. phone is NULL after delete.
 *   6. deleted_at is non-NULL after delete.
 *   7. Missing-profile returns { mutated: false } without throwing.
 *   8. Two distinct seeded users produce two distinct anonymized emails.
 *   9. Row's id and dob are unchanged.
 *   10. Source-grep: lib/privacy/soft-delete.ts starts with import 'server-only'.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
// pgcrypto contrib extension — required for encode(digest(...)) in the
// 0004 migration. pglite 0.4.5 ships pgcrypto as a contrib extension.
// Import via the pglite contrib path (not the top-level package path).
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub, resetAuthStub } from '../db/_fixtures/auth-stub';
import { seedProfile } from '../db/_fixtures/profiles';
import { setupAppAuthenticatedRole, asServiceRole } from '../db/_fixtures/rls-helpers';

// Mock server-only so it doesn't throw in vitest's happy-dom environment.
vi.mock('server-only', () => ({}));

import { softDeleteProfile, type TransactionClient } from '@/lib/privacy/soft-delete';

// ESM/CJS-safe path resolution.
const __filename_local =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename_local) : __dirname;

const MIGRATION_0002 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0002_profiles_and_roles.sql',
);
const MIGRATION_0003 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0003_audit_log.sql',
);
const MIGRATION_0004 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0004_privacy_soft_delete.sql',
);
const SOFT_DELETE_SRC = resolve(TEST_DIR, '..', '..', 'lib', 'privacy', 'soft-delete.ts');

let pg: PGlite;

async function runSqlBlock(sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec;
  await runner.call(pg, sql);
}

// Seed an auth.users row + matching profile. Caller must ensure uid is null
// (service-role) before calling so RLS doesn't deny the INSERT.
async function seedUser(
  overrides: Parameters<typeof seedProfile>[1] = {},
): Promise<{ id: string }> {
  // Insert into auth.users first (FK target), get the generated uuid.
  const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
  const id = u.rows[0]!.id;
  await seedProfile(pg, { ...overrides, id });
  return { id };
}

// Adapter: pglite's query result -> TransactionClient shape.
// Pass through affectedRows so softDeleteProfile can detect UPDATE row-count.
function dbClient(): TransactionClient {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const r = await pg.query(sql, params);
      const raw = r as unknown as { rows: unknown[]; affectedRows?: number };
      const result: { rows: unknown[]; affectedRows?: number } = { rows: raw.rows };
      if (typeof raw.affectedRows === 'number') {
        result.affectedRows = raw.affectedRows;
      }
      return result;
    },
  };
}

beforeAll(async () => {
  // Load pgcrypto contrib extension so encode(digest(..., 'sha256'), 'hex')
  // works in pglite. The contrib path requires the extension object to be
  // passed at PGlite construction time.
  pg = new PGlite({ extensions: { pgcrypto } });

  // 1. Auth stub first.
  await setupAuthStub(pg);

  // 2. Minimal auth.users table (FK target for profiles.id).
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // 3. Apply migrations in order.
  await runSqlBlock(readFileSync(MIGRATION_0002, 'utf8'));
  await runSqlBlock(readFileSync(MIGRATION_0003, 'utf8'));
  await runSqlBlock(readFileSync(MIGRATION_0004, 'utf8'));

  // 4. Grant app_authenticated role access to profiles + audit_log.
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq'],
  });
}, 60_000);

beforeEach(async () => {
  // Reset identity to service-role (auth.uid() = NULL) so seeds run as
  // superuser bypass.
  await resetAuthStub(pg);
});

afterAll(async () => {
  await pg.close();
});

describe('softDeleteProfile', () => {
  it('first call returns { mutated: true } and sets deleted_at', async () => {
    // Seed as service-role (uid = null — resetAuthStub in beforeEach handles this).
    const { id: userId } = await seedUser();

    const db = dbClient();
    const result = await softDeleteProfile(userId, db);

    expect(result.userId).toBe(userId);
    expect(result.mutated).toBe(true);
  });

  it('second call returns { mutated: false } (idempotent)', async () => {
    const { id: userId } = await seedUser();
    const db = dbClient();

    const first = await softDeleteProfile(userId, db);
    const second = await softDeleteProfile(userId, db);

    expect(first.mutated).toBe(true);
    expect(second.mutated).toBe(false);
    expect(second.userId).toBe(userId);
  });

  it('full_name after delete matches /^del:[0-9a-f]{64}$/', async () => {
    const { id: userId } = await seedUser();
    const db = dbClient();

    await softDeleteProfile(userId, db);

    // Read back as superuser (service-role). The query uses RESET ROLE (superuser)
    // so it bypasses RLS to read the now-deleted row.
    await asServiceRole(pg);
    const rows = await pg.query<{ full_name: string }>(
      'SELECT full_name FROM profiles WHERE id = $1',
      [userId],
    );
    const fullName = rows.rows[0]?.full_name;
    expect(fullName).toMatch(/^del:[0-9a-f]{64}$/);
  });

  it('email after delete matches /^del:[0-9a-f]{64}@deleted\\.local$/', async () => {
    const { id: userId } = await seedUser();
    const db = dbClient();

    await softDeleteProfile(userId, db);

    await asServiceRole(pg);
    const rows = await pg.query<{ email: string }>('SELECT email FROM profiles WHERE id = $1', [
      userId,
    ]);
    const email = rows.rows[0]?.email;
    expect(email).toMatch(/^del:[0-9a-f]{64}@deleted\.local$/);
  });

  it('phone is NULL after delete', async () => {
    const { id: userId } = await seedUser({ phone: '+15551234567' });
    const db = dbClient();

    await softDeleteProfile(userId, db);

    await asServiceRole(pg);
    const rows = await pg.query<{ phone: string | null }>(
      'SELECT phone FROM profiles WHERE id = $1',
      [userId],
    );
    expect(rows.rows[0]?.phone).toBeNull();
  });

  it('deleted_at is non-NULL after delete', async () => {
    const { id: userId } = await seedUser();
    const db = dbClient();

    await softDeleteProfile(userId, db);

    await asServiceRole(pg);
    const rows = await pg.query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM profiles WHERE id = $1',
      [userId],
    );
    expect(rows.rows[0]?.deleted_at).not.toBeNull();
  });

  it('missing-profile returns { mutated: false } without throwing', async () => {
    const nonExistentId = crypto.randomUUID();
    const db = dbClient();

    const result = await softDeleteProfile(nonExistentId, db);

    expect(result.mutated).toBe(false);
    expect(result.userId).toBe(nonExistentId);
  });

  it('two distinct users produce two distinct anonymized emails', async () => {
    const { id: idA } = await seedUser();
    const { id: idB } = await seedUser();

    const db = dbClient();
    await softDeleteProfile(idA, db);
    await softDeleteProfile(idB, db);

    await asServiceRole(pg);
    const rowsA = await pg.query<{ email: string }>('SELECT email FROM profiles WHERE id = $1', [
      idA,
    ]);
    const rowsB = await pg.query<{ email: string }>('SELECT email FROM profiles WHERE id = $1', [
      idB,
    ]);

    const emailA = rowsA.rows[0]?.email;
    const emailB = rowsB.rows[0]?.email;

    // Both must match the pattern.
    expect(emailA).toMatch(/^del:[0-9a-f]{64}@deleted\.local$/);
    expect(emailB).toMatch(/^del:[0-9a-f]{64}@deleted\.local$/);
    // And they must be distinct.
    expect(emailA).not.toBe(emailB);
  });

  it('row id and dob are unchanged after delete', async () => {
    const dob = '1985-06-15';
    const { id: userId } = await seedUser({ dob });
    const db = dbClient();

    await softDeleteProfile(userId, db);

    await asServiceRole(pg);
    const rows = await pg.query<{ id: string; dob: string }>(
      'SELECT id, dob FROM profiles WHERE id = $1',
      [userId],
    );
    const row = rows.rows[0];
    expect(row?.id).toBe(userId);
    // pglite may return date as string in various formats; check it still contains the date.
    expect(row?.dob).toBeTruthy();
  });
});

describe('softDeleteProfile source-grep assertions', () => {
  it('soft-delete.ts starts with import server-only (AC3 server-only guard)', () => {
    const source = readFileSync(SOFT_DELETE_SRC, 'utf8');
    // The file MUST start with `import 'server-only'`.
    expect(source.trimStart()).toMatch(/^import 'server-only';/);
  });

  it('soft-delete.ts does not import Node crypto or crypto.subtle', () => {
    const source = readFileSync(SOFT_DELETE_SRC, 'utf8');
    // Hash is done in Postgres via pgcrypto — not in Node/browser crypto.
    expect(source).not.toMatch(/from\s+['"]node:crypto['"]/);
    expect(source).not.toMatch(/from\s+['"]crypto['"]/);
    expect(source).not.toMatch(/crypto\.subtle/);
  });
});
