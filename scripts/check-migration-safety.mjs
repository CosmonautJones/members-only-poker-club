#!/usr/bin/env node
/**
 * Migration safety scanner — ADR-0018 implementation.
 *
 * Scans `.sql` files under `supabase/migrations/` for risky patterns the
 * MIGRATION-REVIEW checklist forbids without explicit acknowledgement, and
 * for naming-convention violations. Designed to run in CI on every PR.
 *
 * Usage:
 *   node scripts/check-migration-safety.mjs                # scan working tree
 *   node scripts/check-migration-safety.mjs --against-base # CI: compare PR
 *                                                         # head against base
 *                                                         # ref
 *   node scripts/check-migration-safety.mjs --self-test    # run fixture suite
 *
 * Exit codes:
 *   0 — no findings (or all findings have been explicitly acknowledged)
 *   1 — risky patterns found OR naming convention violated
 *   2 — usage error
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

/**
 * Naming convention: either Supabase CLI timestamp `YYYYMMDDHHMMSS_<name>.sql`
 * or ADR-documented sequential `NNNN_<name>.sql`.
 */
export const FILENAME_PATTERN = /^(\d{14}|\d{4})_[a-z0-9_-]+\.sql$/;

/**
 * Risky-pattern catalog.
 *
 * Each rule has:
 *   - id        — short identifier surfaced in the report
 *   - description — human reasoning for the finding
 *   - test(sql, opts) — predicate; returns truthy when violation found
 *   - acknowledge — comment marker that suppresses this rule for the file
 */
export const RISK_RULES = [
  {
    id: 'drop-table',
    description: 'DROP TABLE is forward-only-incompatible without owner approval',
    pattern: /\bDROP\s+TABLE\b/i,
    acknowledge: '-- migration-review: drop-table-approved',
  },
  {
    id: 'drop-column',
    description: 'DROP COLUMN must follow a deprecation window (ADR-0018)',
    pattern: /\bDROP\s+COLUMN\b/i,
    acknowledge: '-- migration-review: drop-column-approved',
  },
  {
    id: 'alter-type',
    description:
      'ALTER COLUMN ... TYPE rewrites the column under lock; use new-column + migrate + drop',
    pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    acknowledge: '-- migration-review: alter-type-approved',
  },
  {
    id: 'create-index-blocking',
    description:
      'CREATE INDEX without CONCURRENTLY locks the table; use CONCURRENTLY for hot tables',
    test: (sql) => {
      const re = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i;
      return re.test(sql);
    },
    acknowledge: '-- migration-review: blocking-index-approved',
  },
  {
    id: 'cents-non-integer',
    description: 'Money columns named *_cents must be INTEGER per ADR-0004',
    pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*_cents\s+(decimal|numeric|float|real|double\s+precision)\b/i,
    acknowledge: null,
  },
  {
    id: 'set-not-null-without-backfill-note',
    description:
      'SET NOT NULL on existing column requires a prior backfill migration; add a -- migration-review: backfilled-by:NNNN comment',
    test: (sql) => {
      const setNotNull = /\bSET\s+NOT\s+NULL\b/i.test(sql);
      const hasBackfillNote = /-- migration-review: backfilled-by:/i.test(sql);
      const hasFreshColumnAdd = /\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b/is.test(sql);
      return setNotNull && !hasBackfillNote && !hasFreshColumnAdd;
    },
    acknowledge: '-- migration-review: backfilled-by:',
  },
];

function listMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ name: f, path: join(MIGRATIONS_DIR, f) }));
}

/**
 * Returns the migration files changed in the current branch vs `baseRef`.
 * Uses execFileSync (no shell) to avoid command-injection surface even though
 * the input is sourced from CI env variables.
 */
function listChangedMigrationsAgainstBase(baseRef) {
  const out = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=AMR', `${baseRef}...HEAD`, '--', 'supabase/migrations'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((p) => p.endsWith('.sql'))
    .map((p) => ({ name: p.split('/').pop(), path: join(REPO_ROOT, p) }))
    .filter((f) => existsSync(f.path));
}

/**
 * @param {string} sql
 * @returns {string[]} list of finding IDs (rule.id) matched against this SQL
 */
export function scanMigrationContent(sql) {
  const findings = [];
  for (const rule of RISK_RULES) {
    const violated = rule.test ? rule.test(sql) : rule.pattern.test(sql);
    if (!violated) continue;
    if (rule.acknowledge && sql.includes(rule.acknowledge)) continue;
    findings.push(rule.id);
  }
  return findings;
}

/**
 * @param {string} name
 */
export function isValidMigrationName(name) {
  return FILENAME_PATTERN.test(name);
}

function scanFiles(files) {
  const report = { naming: [], risks: [] };
  for (const file of files) {
    if (!isValidMigrationName(file.name)) {
      report.naming.push(file.name);
      continue;
    }
    const sql = readFileSync(file.path, 'utf8');
    const findings = scanMigrationContent(sql);
    if (findings.length > 0) {
      report.risks.push({ name: file.name, findings });
    }
  }
  return report;
}

function printReport(report) {
  let bad = false;
  if (report.naming.length > 0) {
    bad = true;
    console.error('Naming-convention violations:');
    for (const n of report.naming) {
      console.error(`  - ${n} (expected: NNNN_<name>.sql or YYYYMMDDHHMMSS_<name>.sql)`);
    }
  }
  if (report.risks.length > 0) {
    bad = true;
    console.error('Migration-safety findings (see ADR-0018):');
    for (const r of report.risks) {
      console.error(`  - ${r.name}:`);
      for (const id of r.findings) {
        const rule = RISK_RULES.find((x) => x.id === id);
        console.error(`      ${id} — ${rule?.description}`);
        if (rule?.acknowledge) {
          console.error(`      acknowledge with: \`${rule.acknowledge}\``);
        } else {
          console.error('      (this rule cannot be acknowledged; fix the migration)');
        }
      }
    }
  }
  return bad;
}

/* ----------------------------- self-test fixtures ----------------------------- */

const SELF_TEST_FIXTURES = [
  { name: 'drops a table', sql: 'DROP TABLE old_payments;', expect: ['drop-table'] },
  {
    name: 'drops a column',
    sql: 'ALTER TABLE profiles DROP COLUMN legacy_id;',
    expect: ['drop-column'],
  },
  {
    name: 'alters column type',
    sql: 'ALTER TABLE profiles ALTER COLUMN dob TYPE TIMESTAMP;',
    expect: ['alter-type'],
  },
  {
    name: 'create index without CONCURRENTLY',
    sql: 'CREATE INDEX idx_profiles_email ON profiles(email);',
    expect: ['create-index-blocking'],
  },
  {
    name: 'create unique index without CONCURRENTLY',
    sql: 'CREATE UNIQUE INDEX uniq_profiles_email ON profiles(email);',
    expect: ['create-index-blocking'],
  },
  {
    name: 'cents column with NUMERIC',
    sql: 'ALTER TABLE payments ADD COLUMN amount_cents NUMERIC(12,2);',
    expect: ['cents-non-integer'],
  },
  {
    name: 'cents column with float',
    sql: 'ALTER TABLE wallets ADD COLUMN balance_cents float;',
    expect: ['cents-non-integer'],
  },
  {
    name: 'SET NOT NULL without backfill comment',
    sql: 'ALTER TABLE memberships ALTER COLUMN tier SET NOT NULL;',
    expect: ['set-not-null-without-backfill-note'],
  },
  {
    name: 'drop-table with acknowledgement',
    sql: '-- migration-review: drop-table-approved\nDROP TABLE legacy_table;',
    expect: [],
  },
  {
    name: 'create index CONCURRENTLY',
    sql: 'CREATE INDEX CONCURRENTLY idx_profiles_email ON profiles(email);',
    expect: [],
  },
  {
    name: 'cents column with INTEGER',
    sql: 'ALTER TABLE payments ADD COLUMN amount_cents INTEGER NOT NULL;',
    expect: [],
  },
  {
    name: 'fresh ADD COLUMN ... NOT NULL is fine',
    sql: 'ALTER TABLE memberships ADD COLUMN flag boolean NOT NULL DEFAULT false;',
    expect: [],
  },
  {
    name: 'SET NOT NULL with backfill comment',
    sql: '-- migration-review: backfilled-by:0007\nALTER TABLE memberships ALTER COLUMN tier SET NOT NULL;',
    expect: [],
  },
  {
    name: 'CREATE TABLE is fine',
    sql: 'CREATE TABLE profiles (id UUID PRIMARY KEY, email TEXT NOT NULL);',
    expect: [],
  },
  {
    name: 'ALTER TYPE on a TYPE (enum), not a column, is fine',
    sql: "ALTER TYPE membership_kind ADD VALUE 'family';",
    expect: [],
  },
];

const NAMING_FIXTURES = [
  { name: '0001_initial_schema.sql', valid: true },
  { name: '0042_add_profiles.sql', valid: true },
  { name: '20260509120000_add_profiles.sql', valid: true },
  { name: '20260509120000_add-profiles.sql', valid: true },
  { name: 'initial_schema.sql', valid: false },
  { name: '1_short_prefix.sql', valid: false },
  { name: '0001_UPPERCASE.sql', valid: false },
  { name: '0001_with spaces.sql', valid: false },
  { name: '0001_no_extension', valid: false },
];

function runSelfTest() {
  let failed = 0;
  for (const fixture of SELF_TEST_FIXTURES) {
    const findings = scanMigrationContent(fixture.sql).sort();
    const expected = [...fixture.expect].sort();
    const ok = JSON.stringify(findings) === JSON.stringify(expected);
    if (!ok) {
      failed++;
      console.error(`FAIL [content]: ${fixture.name}`);
      console.error(`  expected: ${JSON.stringify(expected)}`);
      console.error(`  got:      ${JSON.stringify(findings)}`);
    }
  }
  for (const fixture of NAMING_FIXTURES) {
    const got = isValidMigrationName(fixture.name);
    if (got !== fixture.valid) {
      failed++;
      console.error(
        `FAIL [naming]: ${fixture.name} — expected valid=${fixture.valid}, got valid=${got}`,
      );
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} self-test fixture(s) failed.`);
    return false;
  }
  console.log(
    `Self-test passed: ${SELF_TEST_FIXTURES.length} content fixtures + ${NAMING_FIXTURES.length} naming fixtures.`,
  );
  return true;
}

/* ----------------------------- entry point ----------------------------- */

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--self-test')) {
    return runSelfTest() ? 0 : 1;
  }
  let files;
  if (args.includes('--against-base')) {
    const baseRef = process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/main';
    try {
      files = listChangedMigrationsAgainstBase(baseRef);
    } catch (err) {
      console.error(`failed to compute diff against ${baseRef}: ${err.message}`);
      return 2;
    }
    if (files.length === 0) {
      console.log('No migration files changed in this PR.');
      return 0;
    }
    console.log(`Scanning ${files.length} changed migration(s) against ${baseRef}…`);
  } else {
    files = listMigrationFiles();
    if (files.length === 0) {
      console.log('No migration files yet (supabase/migrations/ is empty).');
      return 0;
    }
    console.log(`Scanning ${files.length} migration file(s)…`);
  }
  const report = scanFiles(files);
  const bad = printReport(report);
  if (bad) {
    console.error('\nMigration safety check FAILED. See ADR-0018 for the rules.');
    return 1;
  }
  console.log('All migrations passed safety + naming checks.');
  return 0;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMainModule) {
  process.exit(main(process.argv));
}
