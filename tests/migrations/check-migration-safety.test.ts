import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  scanMigrationContent,
  isValidMigrationName,
  RISK_RULES,
  FILENAME_PATTERN,
  // @ts-expect-error — .mjs source, types resolved at runtime
} from '../../scripts/check-migration-safety.mjs';

describe('check-migration-safety / RISK_RULES exhaustive cases', () => {
  it('catches DROP TABLE without acknowledgement', () => {
    expect(scanMigrationContent('DROP TABLE foo;')).toContain('drop-table');
  });

  it('suppresses DROP TABLE finding when acknowledged', () => {
    expect(
      scanMigrationContent('-- migration-review: drop-table-approved\nDROP TABLE foo;'),
    ).not.toContain('drop-table');
  });

  it('catches DROP COLUMN without acknowledgement', () => {
    expect(scanMigrationContent('ALTER TABLE foo DROP COLUMN bar;')).toContain('drop-column');
  });

  it('catches ALTER COLUMN ... TYPE', () => {
    expect(scanMigrationContent('ALTER TABLE foo ALTER COLUMN bar TYPE INTEGER;')).toContain(
      'alter-type',
    );
  });

  it('catches ALTER COLUMN ... SET DATA TYPE form', () => {
    expect(
      scanMigrationContent('ALTER TABLE foo ALTER COLUMN bar SET DATA TYPE INTEGER;'),
    ).toContain('alter-type');
  });

  it('does NOT flag ALTER TYPE on an enum (different syntax)', () => {
    expect(scanMigrationContent("ALTER TYPE k ADD VALUE 'new';")).not.toContain('alter-type');
  });

  it('catches CREATE INDEX without CONCURRENTLY', () => {
    expect(scanMigrationContent('CREATE INDEX idx_x ON foo(bar);')).toContain(
      'create-index-blocking',
    );
  });

  it('does NOT flag CREATE INDEX CONCURRENTLY', () => {
    expect(scanMigrationContent('CREATE INDEX CONCURRENTLY idx_x ON foo(bar);')).not.toContain(
      'create-index-blocking',
    );
  });

  it('catches *_cents columns with NUMERIC', () => {
    expect(scanMigrationContent('amount_cents NUMERIC(12,2)')).toContain('cents-non-integer');
  });

  it('catches *_cents columns with float, real, double precision', () => {
    expect(scanMigrationContent('total_cents float')).toContain('cents-non-integer');
    expect(scanMigrationContent('balance_cents real')).toContain('cents-non-integer');
    expect(scanMigrationContent('fee_cents double precision')).toContain('cents-non-integer');
  });

  it('does NOT flag *_cents columns with INTEGER (the correct type)', () => {
    expect(scanMigrationContent('amount_cents INTEGER NOT NULL')).not.toContain(
      'cents-non-integer',
    );
  });

  it('catches SET NOT NULL without backfill comment', () => {
    expect(scanMigrationContent('ALTER TABLE foo ALTER COLUMN bar SET NOT NULL;')).toContain(
      'set-not-null-without-backfill-note',
    );
  });

  it('does NOT flag SET NOT NULL when backfill comment is present', () => {
    expect(
      scanMigrationContent(
        '-- migration-review: backfilled-by:0007\nALTER TABLE foo ALTER COLUMN bar SET NOT NULL;',
      ),
    ).not.toContain('set-not-null-without-backfill-note');
  });

  it('does NOT flag fresh ADD COLUMN ... NOT NULL DEFAULT (no backfill needed)', () => {
    expect(
      scanMigrationContent('ALTER TABLE foo ADD COLUMN flag boolean NOT NULL DEFAULT false;'),
    ).not.toContain('set-not-null-without-backfill-note');
  });

  it('cents-non-integer rule cannot be acknowledged (ADR-0004 is non-negotiable)', () => {
    const rule = RISK_RULES.find((r: { id: string }) => r.id === 'cents-non-integer');
    expect(rule?.acknowledge).toBeNull();
  });

  it('every rule except cents-non-integer has a non-empty acknowledgement marker', () => {
    for (const rule of RISK_RULES as Array<{ id: string; acknowledge: string | null }>) {
      if (rule.id === 'cents-non-integer') continue;
      expect(rule.acknowledge, `${rule.id} should be acknowledgeable`).toBeTruthy();
    }
  });
});

describe('check-migration-safety / filename validator', () => {
  it('accepts NNNN_<name>.sql', () => {
    expect(isValidMigrationName('0001_initial.sql')).toBe(true);
    expect(isValidMigrationName('0042_add_profiles_table.sql')).toBe(true);
  });

  it('accepts Supabase CLI YYYYMMDDHHMMSS_<name>.sql', () => {
    expect(isValidMigrationName('20260509120000_add_profiles.sql')).toBe(true);
  });

  it('accepts kebab-case in the name part', () => {
    expect(isValidMigrationName('0001_add-profiles-table.sql')).toBe(true);
  });

  it('rejects missing prefix', () => {
    expect(isValidMigrationName('initial_schema.sql')).toBe(false);
  });

  it('rejects wrong prefix length', () => {
    expect(isValidMigrationName('1_short.sql')).toBe(false);
    expect(isValidMigrationName('00001_too_long.sql')).toBe(false);
  });

  it('rejects uppercase in name', () => {
    expect(isValidMigrationName('0001_BAD.sql')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidMigrationName('0001_with spaces.sql')).toBe(false);
  });

  it('rejects missing .sql extension', () => {
    expect(isValidMigrationName('0001_no_extension')).toBe(false);
    expect(isValidMigrationName('0001_wrong.txt')).toBe(false);
  });

  it('FILENAME_PATTERN matches both prefix forms', () => {
    expect('0001_x.sql').toMatch(FILENAME_PATTERN);
    expect('20260509120000_x.sql').toMatch(FILENAME_PATTERN);
  });
});

describe('check-migration-safety / --self-test (subprocess)', () => {
  it('exits 0 when fixtures match expected outcomes', () => {
    const scriptPath = resolve(__dirname, '..', '..', 'scripts', 'check-migration-safety.mjs');
    const output = execFileSync('node', [scriptPath, '--self-test'], { encoding: 'utf8' });
    expect(output).toMatch(/Self-test passed/);
  });
});
